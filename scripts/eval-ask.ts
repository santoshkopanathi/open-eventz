/*
 * ASK EVAL — run the 20 questions through the real Ask pipeline on the frozen catalog.
 *
 *   npm run eval:ask                       normal run, scored against the OWNER's labels
 *   npm run eval:ask -- --broken           the deliberately broken prompt: must FAIL
 *   npm run eval:ask -- --labels claude    score against Claude's provisional labels (history)
 *   npm run eval:ask -- --out run-3.json   also save the run under that name
 *
 * Picks come from eval/ask/labels-owner.json (owner, blind, 2026-11-19). Parse expectations
 * (dates, city, free, age) come from labels.json; the owner accepted that reading. Scoring is
 * deterministic code. Exit code 1 when a blocking gate fails.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync, writeFileSync } from 'node:fs'
import type { Event } from '../src/lib/types'
import { ask, type AskResult } from '../src/lib/ask/ask'
import { parseQuestion, selectEvents, emptyUsage, ASK_MODEL, type Usage } from '../src/lib/ask/llm'
import { factTokens, isFree, type City } from '../src/lib/ask/core'
import { cityOf } from '../src/lib/catalog'

interface Q { id: string; category: 'answerable' | 'no_match' | 'tricky' | 'off_topic'; tab: City; question: string }
interface ClaudeL { id: string; expect: Record<string, unknown>; acceptable: string[]; forbidden?: string[]; first_city?: City }
interface OwnerL {
  id: string; acceptable: string[]; secondary?: string[]; not_good?: string[]; forbidden?: string[]
  duplicate_group?: string[]; first_city?: City; expect_price_note?: boolean; expect_redirect?: boolean; expected_behaviour?: string
}

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined }
const broken = process.argv.includes('--broken')
const useClaude = arg('--labels') === 'claude'
const snap = JSON.parse(readFileSync('eval/ask/catalog-snapshot.json', 'utf8')) as { as_of: string; events: Event[] }
const questions = (JSON.parse(readFileSync('eval/ask/questions.json', 'utf8')) as { questions: Q[] }).questions
const claude = new Map((JSON.parse(readFileSync('eval/ask/labels.json', 'utf8')) as { labels: ClaudeL[] }).labels.map(l => [l.id, l]))
const ownerFile = JSON.parse(readFileSync('eval/ask/labels-owner.json', 'utf8')) as { labels: OwnerL[]; forbidden_everywhere?: { refs: string[]; titles: string[] } }
const owner = new Map(ownerFile.labels.map(l => [l.id, l]))
const refToId = new Map(snap.events.map((e, i) => [`E${String(i + 1).padStart(3, '0')}`, e.id]))
const idToRef = new Map([...refToId].map(([r, id]) => [id, r]))
const byId = new Map(snap.events.map(e => [e.id, e]))
const today = snap.as_of
const forbiddenTitles = (ownerFile.forbidden_everywhere?.titles ?? []).map(t => t.toLowerCase())

const eqAge = (a: unknown, b: [number, number] | null) =>
  (a == null && b == null) || (Array.isArray(a) && b != null && a[0] === b[0] && a[1] === b[1])

/** The picks to score against, in one shape, whichever label set is in use. */
function picks(id: string): OwnerL {
  if (useClaude) { const c = claude.get(id)!; return { id, acceptable: c.acceptable, forbidden: c.forbidden, first_city: c.first_city, expect_price_note: c.expect.price_note === true } }
  return owner.get(id)!
}

/**
 * Duplicate groups (owner rule): copies of one program count once. A group is an explicit
 * duplicate_group, or events with the same title. Returns a group key per event id.
 */
function groupKey(l: OwnerL, id: string): string {
  const ref = idToRef.get(id)!
  if (l.duplicate_group?.includes(ref)) return `grp:${l.duplicate_group.join(',')}`
  return `title:${(byId.get(id)?.title ?? id).trim().toLowerCase()}`
}

const fallbackCards = (r: AskResult): Event[] => r.fallback?.cards ?? []

async function main() {
  const total = emptyUsage()
  const rows: Record<string, unknown>[] = []
  const gate = { cited_not_retrieved: 0, raw_answer_fact_tokens: 0, shown_answer_fact_tokens: 0, free_only_non_free: 0,
    no_match_returned_events: 0, off_topic_not_redirected: 0, city_rule_broken: 0, forbidden_shown: 0, errors: 0 }
  const parseField = { dates: [0, 0], city: [0, 0], free_only: [0, 0], age: [0, 0], scope: [0, 0], price_note: [0, 0] }
  let recallSum = 0, recallN = 0, precHit = 0, precN = 0, cardsOnly = 0, answered = 0, dupCardsShown = 0
  const recallBy: Record<string, string> = {}

  for (const q of questions) {
    const c = claude.get(q.id)!
    const l = picks(q.id)
    const u: Usage = emptyUsage()
    let r: AskResult
    try {
      r = await ask(q.question, q.tab, today, snap.events, {
        parse: parseQuestion,
        select: (qq, intent, ev, uu, o) => selectEvents(qq, intent, ev, uu, { ...(o ?? {}), brokenPrompt: broken }),
      }, u)
    } catch (e) {
      gate.errors++; rows.push({ id: q.id, error: String((e as Error).message ?? e) }); console.log(`${q.id} ERROR ${(e as Error).message}`); continue
    }
    for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += u[k]

    const fb = fallbackCards(r)
    const shownCards = [...r.cards, ...fb]
    const cardIds = shownCards.map(e => e.id)
    const cardRefs = cardIds.map(id => idToRef.get(id) ?? id)
    const sel = r.debug.selection
    const rawTokens = sel ? factTokens(sel.answer, sel.cited.map(id => byId.get(id)?.title ?? '')) : []
    gate.cited_not_retrieved += r.debug.check?.uncited.length ?? 0
    if (rawTokens.length) gate.raw_answer_fact_tokens++
    if (r.answer && factTokens(r.answer, r.cards.map(e => e.title)).length) gate.shown_answer_fact_tokens++
    if (r.debug.filters?.free_only && r.cards.some(e => !isFree(e))) gate.free_only_non_free++

    // No-match: nothing in the answer. A labelled fallback (uncovered city) may show tab-city
    // cards only under the "covers Frisco and Plano only" line — never as a silent swap.
    const expectsFallback = l.expected_behaviour === 'unsupported_city_fallback_to_tab'
    if (q.category === 'no_match' && (r.cards.length || r.answer || (fb.length && !expectsFallback))) gate.no_match_returned_events++
    if ((q.category === 'off_topic') !== (r.kind === 'off_topic')) gate.off_topic_not_redirected++

    const forbiddenIds = new Set([...(l.forbidden ?? []), ...(useClaude ? [] : ownerFile.forbidden_everywhere?.refs ?? [])].map(ref => refToId.get(ref)))
    if (shownCards.some(e => forbiddenIds.has(e.id) || forbiddenTitles.some(t => e.title.toLowerCase().includes(t)))) gate.forbidden_shown++

    // City rule. A fallback for an uncovered city must be the tab's city.
    const expCity = c.expect.city as string | undefined
    if (expCity) {
      const allowed = expCity === 'both' ? ['frisco', 'plano'] : expCity === 'unsupported' ? [] : [expCity]
      let ok = r.cards.every(e => allowed.includes(cityOf(e))) && fb.every(e => cityOf(e) === q.tab)
      if (expCity === 'both' && r.cards.length) {
        const cs = r.cards.map(cityOf), first = l.first_city ?? q.tab
        const firstOther = cs.findIndex(x => x !== first)
        if (firstOther !== -1 && cs.slice(firstOther).includes(first)) ok = false
      }
      if (!ok) gate.city_rule_broken++
    }

    // Advisory: parse accuracy (expectations from labels.json; owner accepted them).
    const f = r.debug.filters, exp = c.expect
    parseField.scope[1]++
    if ((q.category === 'off_topic') === (r.kind === 'off_topic')) parseField.scope[0]++
    if (q.category !== 'off_topic' && f) {
      parseField.dates[1]++; if (f.date_from === exp.date_from && f.date_to === exp.date_to) parseField.dates[0]++
      parseField.city[1]++
      if ((f.unsupported_city ? 'unsupported' : f.cities.length === 2 ? 'both' : f.cities[0]) === exp.city) parseField.city[0]++
      parseField.free_only[1]++; if (f.free_only === exp.free_only) parseField.free_only[0]++
      parseField.age[1]++; if (eqAge(exp.age, f.age)) parseField.age[0]++
      parseField.price_note[1]++
      if (f.notes.some(n => n.includes("'free' or 'paid'")) === (l.expect_price_note === true || exp.price_note === true)) parseField.price_note[0]++
    }

    // Advisory: recall@5 over duplicate groups; precision over acceptable + secondary.
    if (l.acceptable.length) {
      const accIds = l.acceptable.map(ref => refToId.get(ref)!)
      const groups = new Set(accIds.map(id => groupKey(l, id)))
      const hit = new Set(cardIds.filter(id => accIds.includes(id)).map(id => groupKey(l, id)))
      recallSum += hit.size / Math.min(5, groups.size); recallN++
      recallBy[q.id] = `${hit.size}/${Math.min(5, groups.size)}`
      const okIds = new Set([...accIds, ...(l.secondary ?? []).map(ref => refToId.get(ref)!)])
      precHit += cardIds.filter(id => okIds.has(id)).length; precN += cardIds.length
    }
    const titles = shownCards.map(e => e.title.trim().toLowerCase())
    dupCardsShown += titles.length - new Set(titles).size
    if (r.kind === 'cards') cardsOnly++
    if (r.kind === 'answer') answered++

    rows.push({ id: q.id, tab: q.tab, question: q.question, kind: r.kind, showing: r.showing, notes: r.notes,
      answer_shown: r.answer, raw_answer: sel?.answer ?? null, raw_fact_tokens: rawTokens, cards: cardRefs,
      fallback: fb.map(e => idToRef.get(e.id)), acceptable: l.acceptable, recall: recallBy[q.id] ?? null,
      retrieved: r.debug.retrievedIds.length, retrieved_refs: r.debug.retrievedIds.map(id => idToRef.get(id)), filters: f, usage: u })
    console.log(`${q.id} ${r.kind.padEnd(9)} ${String(r.showing ?? '').padEnd(62)} cards=${cardRefs.join(',') || '-'}${recallBy[q.id] ? ` recall=${recallBy[q.id]}` : ''}${rawTokens.length ? `  TOKENS:${rawTokens.join(',')}` : ''}`)
  }

  const blocking = Object.values(gate).reduce((a, b) => a + b, 0)
  const pct = ([a, b]: number[]) => (b ? `${a}/${b}` : '-')
  const summary = {
    run_at: new Date().toISOString(), model: ASK_MODEL, catalog_as_of: today, broken_prompt: broken,
    labels: useClaude ? 'Claude, provisional (labels.json)' : 'Owner, blind (labels-owner.json)',
    gates_pass: blocking === 0, gates: gate,
    parse_accuracy: Object.fromEntries(Object.entries(parseField).map(([k, v]) => [k, pct(v)])),
    recall_at_5: recallN ? +(recallSum / recallN).toFixed(2) : null, recall_by_question: recallBy,
    precision: precN ? +(precHit / precN).toFixed(2) : null,
    duplicate_cards_shown: dupCardsShown, shown_with_answer: answered, cards_only_fallback: cardsOnly,
    cost: { calls: total.calls, input_tokens: total.input, output_tokens: total.output, cache_read: total.cacheRead,
      usd: +total.usd.toFixed(4), usd_per_question: +(total.usd / questions.length).toFixed(4) },
  }
  const out = { summary, rows }
  writeFileSync(broken ? 'eval/ask/run-broken.json' : 'eval/ask/run-latest.json', JSON.stringify(out, null, 2) + '\n')
  const named = arg('--out'); if (named) writeFileSync(`eval/ask/${named}`, JSON.stringify(out, null, 2) + '\n')
  console.log('\n' + JSON.stringify(summary, null, 2))
  console.log(blocking === 0 ? '\nGATES PASS' : `\nGATES FAIL (${blocking} blocking)`)
  if (blocking) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
