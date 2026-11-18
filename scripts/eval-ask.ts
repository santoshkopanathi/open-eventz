/*
 * ASK EVAL — run the 20 questions through the real Ask pipeline on the frozen catalog.
 *
 *   npm run eval:ask              normal run (real model calls, ~$0.40)
 *   npm run eval:ask -- --broken  the deliberately broken prompt (told to state dates): must FAIL
 *
 * Scores the spec's gates deterministically in code. Writes eval/ask/run-latest.json (or
 * run-broken.json) and prints a summary. Exit code 1 when a blocking gate fails.
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
interface L { id: string; expect: Record<string, unknown>; acceptable: string[]; forbidden?: string[]; first_city?: City }

const broken = process.argv.includes('--broken')
const snap = JSON.parse(readFileSync('eval/ask/catalog-snapshot.json', 'utf8')) as { as_of: string; events: Event[] }
const questions = (JSON.parse(readFileSync('eval/ask/questions.json', 'utf8')) as { questions: Q[] }).questions
const labels = new Map((JSON.parse(readFileSync('eval/ask/labels.json', 'utf8')) as { labels: L[] }).labels.map(l => [l.id, l]))
const refToId = new Map(snap.events.map((e, i) => [`E${String(i + 1).padStart(3, '0')}`, e.id]))
const idToRef = new Map([...refToId].map(([r, id]) => [id, r]))
const today = snap.as_of

const eqAge = (a: unknown, b: [number, number] | null) =>
  (a == null && b == null) || (Array.isArray(a) && b != null && a[0] === b[0] && a[1] === b[1])

async function main() {
  const total = emptyUsage()
  const rows: Record<string, unknown>[] = []
  const gate = { cited_not_retrieved: 0, raw_answer_fact_tokens: 0, shown_answer_fact_tokens: 0, free_only_non_free: 0,
    no_match_returned_events: 0, off_topic_not_redirected: 0, city_rule_broken: 0, forbidden_shown: 0, errors: 0 }
  const parseField = { dates: [0, 0], city: [0, 0], free_only: [0, 0], age: [0, 0], scope: [0, 0], price_note: [0, 0] }
  let recallSum = 0, recallN = 0, precHit = 0, precN = 0, cardsOnly = 0, answered = 0

  for (const q of questions) {
    const l = labels.get(q.id)!
    const u: Usage = emptyUsage()
    let r: AskResult
    try {
      r = await ask(q.question, q.tab, today, snap.events, {
        parse: parseQuestion,
        select: (qq, intent, ev, uu) => selectEvents(qq, intent, ev, uu, { brokenPrompt: broken }),
      }, u)
    } catch (e) {
      gate.errors++; rows.push({ id: q.id, error: String((e as Error).message ?? e) }); console.log(`${q.id} ERROR ${(e as Error).message}`); continue
    }
    for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += u[k]

    const cardIds = r.cards.map(e => e.id)
    const cardRefs = cardIds.map(id => idToRef.get(id) ?? id)
    const sel = r.debug.selection
    const rawTokens = sel ? factTokens(sel.answer, sel.cited.map(id => snap.events.find(e => e.id === id)?.title ?? '')) : []
    const uncited = r.debug.check?.uncited ?? []
    gate.cited_not_retrieved += uncited.length
    if (rawTokens.length) gate.raw_answer_fact_tokens++
    if (r.answer && factTokens(r.answer, r.cards.map(c => c.title)).length) gate.shown_answer_fact_tokens++
    if (r.debug.filters?.free_only && r.cards.some(e => !isFree(e))) gate.free_only_non_free++
    if (q.category === 'no_match' && (r.cards.length || r.answer)) gate.no_match_returned_events++
    const isRedirect = r.kind === 'off_topic'
    if ((q.category === 'off_topic') !== isRedirect) gate.off_topic_not_redirected++
    const forbiddenIds = (l.forbidden ?? []).map(ref => refToId.get(ref))
    if (cardIds.some(id => forbiddenIds.includes(id))) gate.forbidden_shown++

    // City rule: cards only from the expected cities; both-cities answers put the tab city first.
    const expCity = l.expect.city as string | undefined
    if (expCity) {
      const allowed = expCity === 'both' ? ['frisco', 'plano'] : expCity === 'unsupported' ? [] : [expCity]
      const cityOk = r.cards.every(e => allowed.includes(cityOf(e)))
      let orderOk = true
      if (expCity === 'both' && r.cards.length) {
        const cs = r.cards.map(cityOf); const first = l.first_city ?? q.tab
        const firstOther = cs.findIndex(c => c !== first)
        orderOk = cs[0] === first || !cs.includes(first)
        if (firstOther !== -1 && cs.slice(firstOther).includes(first)) orderOk = false
      }
      if (!cityOk || !orderOk) gate.city_rule_broken++
    }

    // Non-blocking: parse accuracy against the labels.
    const f = r.debug.filters
    const exp = l.expect
    if (q.category === 'off_topic' || 'out_of_scope' in exp) { parseField.scope[1]++; if (r.kind === 'off_topic') parseField.scope[0]++ }
    else {
      parseField.scope[1]++; if (r.kind !== 'off_topic') parseField.scope[0]++
      if (f) {
        parseField.dates[1]++; if (f.date_from === exp.date_from && f.date_to === exp.date_to) parseField.dates[0]++
        parseField.city[1]++
        const gotCity = f.unsupported_city ? 'unsupported' : f.cities.length === 2 ? 'both' : f.cities[0]
        if (gotCity === exp.city) parseField.city[0]++
        parseField.free_only[1]++; if (f.free_only === exp.free_only) parseField.free_only[0]++
        parseField.age[1]++; if (eqAge(exp.age, f.age)) parseField.age[0]++
        parseField.price_note[1]++; if (f.notes.some(n => n.includes("'free' or 'paid'")) === (exp.price_note === true)) parseField.price_note[0]++
      }
    }

    // Non-blocking: recall@5 and precision against the acceptable set (answerable + tricky).
    if (l.acceptable.length) {
      const acc = new Set(l.acceptable.map(ref => refToId.get(ref)))
      const hit = cardIds.filter(id => acc.has(id)).length
      recallSum += hit / Math.min(5, acc.size); recallN++
      precHit += hit; precN += cardIds.length
    }
    if (r.kind === 'cards') cardsOnly++
    if (r.kind === 'answer') answered++

    const row = { id: q.id, tab: q.tab, question: q.question, kind: r.kind, showing: r.showing, notes: r.notes,
      answer_shown: r.answer, raw_answer: sel?.answer ?? null, raw_fact_tokens: rawTokens, cards: cardRefs,
      acceptable: l.acceptable, retrieved: r.debug.retrievedIds.length, filters: f, usage: u }
    rows.push(row)
    console.log(`${q.id} ${r.kind.padEnd(9)} ${String(r.showing ?? '').padEnd(62)} cards=${cardRefs.join(',') || '-'}${rawTokens.length ? `  TOKENS:${rawTokens.join(',')}` : ''}`)
  }

  const blocking = gate.cited_not_retrieved + gate.raw_answer_fact_tokens + gate.shown_answer_fact_tokens + gate.free_only_non_free +
    gate.no_match_returned_events + gate.off_topic_not_redirected + gate.city_rule_broken + gate.forbidden_shown + gate.errors
  const pct = ([a, b]: number[]) => (b ? `${a}/${b}` : '-')
  const summary = {
    run_at: new Date().toISOString(), model: ASK_MODEL, catalog_as_of: today, broken_prompt: broken,
    labels: 'PROVISIONAL — Claude-labelled 2026-11-18, not blind human labels',
    gates_pass: blocking === 0, gates: gate,
    parse_accuracy: Object.fromEntries(Object.entries(parseField).map(([k, v]) => [k, pct(v)])),
    recall_at_5: recallN ? +(recallSum / recallN).toFixed(2) : null,
    precision: precN ? +(precHit / precN).toFixed(2) : null,
    shown_with_answer: answered, cards_only_fallback: cardsOnly,
    cost: { calls: total.calls, input_tokens: total.input, output_tokens: total.output, cache_read: total.cacheRead,
      usd: +total.usd.toFixed(4), usd_per_question: +(total.usd / questions.length).toFixed(4) },
  }
  writeFileSync(broken ? 'eval/ask/run-broken.json' : 'eval/ask/run-latest.json', JSON.stringify({ summary, rows }, null, 2) + '\n')
  console.log('\n' + JSON.stringify(summary, null, 2))
  console.log(blocking === 0 ? '\nGATES PASS' : `\nGATES FAIL (${blocking} blocking)`)
  if (blocking) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
