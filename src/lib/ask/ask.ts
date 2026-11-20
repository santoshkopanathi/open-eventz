/**
 * Ask Open Eventz — the five steps, one check (spec "MVP flow"). Max 2 model calls a question.
 * The model functions are injected so tests run without the network and the eval runs the
 * same orchestration as production.
 */
import type { Event } from '../types'
import {
  validateParse, retrieve, checkAnswer, showingLine, nothingMatched, orderCards, onePerProgram, fallbackHeading,
  COPY, misspelledCity, typoNote,
  type City, type Filters, type RawParse, type CheckResult,
} from './core'
import type { Selection, SelectOptions, Usage } from './llm'

export type AskKind = 'answer' | 'cards' | 'nothing' | 'off_topic' | 'error'

export interface AskResult {
  kind: AskKind
  showing: string | null
  notes: string[]
  answer: string | null // shown only when the check passed
  cards: Event[]
  nothing: ReturnType<typeof nothingMatched> | null
  // Uncovered city only (owner decision 2026-11-19): after "Nothing matched. Open Eventz covers
  // Frisco and Plano only.", a clearly headed set of the tab city's events. Never a silent swap.
  fallback: { heading: string; cards: Event[] } | null
  disclosure: string | null
  offTopic: string | null
  debug: { raw: RawParse | null; filters: Filters | null; retrievedIds: string[]; selection: Selection | null; check: CheckResult | null }
}

export interface AskDeps {
  parse: (question: string, today: string, usage: Usage) => Promise<RawParse | null>
  select: (question: string, intent: string | null, events: Event[], usage: Usage, opts?: SelectOptions) => Promise<Selection | null>
}

export async function ask(question: string, tab: City, today: string, catalog: Event[], deps: AskDeps, usage: Usage): Promise<AskResult> {
  const base: AskResult = { kind: 'error', showing: null, notes: [], answer: null, cards: [], nothing: null, fallback: null, disclosure: null, offTopic: null,
    debug: { raw: null, filters: null, retrievedIds: [], selection: null, check: null } }

  const raw = await deps.parse(question, today, usage)
  base.debug.raw = raw
  // A parse failure fails closed to the plain list: no guessing at filters.
  if (!raw) return base
  if (raw.out_of_scope) return { ...base, kind: 'off_topic', offTopic: COPY.offTopic }

  // A typo of a covered city ("Friso") must not become "outside Frisco and Plano". Only when the
  // model thinks a place was named: with no place named, the tab already decides.
  const typo = raw.city === 'unsupported' ? misspelledCity(question) : null
  const f = validateParse(typo ? { ...raw, city: typo.city } : raw, tab, today)
  if (typo) f.notes.unshift(typoNote(typo.word, typo.city))
  base.debug.filters = f
  const showing = showingLine(f)
  const nothing = { ...base, kind: 'nothing' as const, showing, notes: f.notes, nothing: nothingMatched(f) }

  if (f.unsupported_city) return { ...nothing, fallback: await uncoveredCityFallback(question, tab, today, catalog, f, deps, usage, base) }

  const retrieved = retrieve(catalog, f, today)
  base.debug.retrievedIds = retrieved.map(e => e.id)
  if (retrieved.length === 0) return nothing

  const sel = await deps.select(question, f.intent, retrieved, usage)
  base.debug.selection = sel
  if (!sel) return nothing

  const check = checkAnswer(sel.answer, sel.cited, retrieved)
  base.debug.check = check
  const byId = new Map(retrieved.map(e => [e.id, e]))
  const cited = sel.cited.map(id => byId.get(id)).filter((e): e is Event => !!e)
  // The model judged that nothing retrieved actually fits: same screen as nothing retrieved.
  if (cited.length === 0) return nothing

  // One card per program, guaranteed in code (the prompt asks too, but the eval showed prompts
  // don't reliably hold a rule).
  const cards = orderCards(onePerProgram(cited, f.intent), f.cities)
  // Fail closed: if either check fails, the cards show alone. A cited id that wasn't retrieved
  // never becomes a card (it isn't in byId), so an invented event can't reach the screen.
  const passed = check.passed && sel.answer.length > 0
  return { ...base, kind: passed ? 'answer' : 'cards', showing, notes: f.notes, answer: passed ? sel.answer : null, cards, disclosure: COPY.disclosure }
}

/**
 * The parent named a city we don't cover. Search the tab's city on the same dates and let the
 * model pick a varied mix (still one model call for selection, so still max 2 a question). The
 * model's sentence is not shown here: a fixed heading frames the cards, so nothing can imply the
 * events are in the place the parent named.
 */
async function uncoveredCityFallback(question: string, tab: City, today: string, catalog: Event[], f: Filters, deps: AskDeps, usage: Usage, base: AskResult): Promise<AskResult['fallback']> {
  const tf: Filters = { ...f, cities: [tab], unsupported_city: false }
  const retrieved = retrieve(catalog, tf, today)
  base.debug.retrievedIds = retrieved.map(e => e.id)
  if (!retrieved.length) return null
  const sel = await deps.select(question, f.intent, retrieved, usage, { mode: 'fallback' })
  base.debug.selection = sel
  const byId = new Map(retrieved.map(e => [e.id, e]))
  const picked = (sel?.cited ?? []).map(id => byId.get(id)).filter((e): e is Event => !!e)
  const cards = onePerProgram(picked, null).slice(0, 5)
  return cards.length ? { heading: fallbackHeading(tab, tf), cards } : null
}
