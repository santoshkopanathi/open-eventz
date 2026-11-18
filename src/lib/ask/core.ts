/**
 * Ask Open Eventz — the deterministic half: validate a parse, retrieve, check an answer, frame
 * the screen. No model calls and no I/O here, so all of it is unit-tested and the eval runs the
 * exact production code against the frozen catalog. Spec: 02-product/Ask Open Eventz Grounded
 * Q&A Spec v2.md.
 */
import type { Event } from '../types'
import { passesAgeFilter } from '../age-filter'
import { getPriceBadge } from '../price'
import { cityOf, isCatalogVisible } from '../catalog'

export type City = 'frisco' | 'plano'
export const TZ = 'America/Chicago'
export const MAX_RETRIEVED_PER_CITY = 25
export const MAX_CITED = 5
export const MAX_DAYS_AHEAD = 183 // "can't be more than 6 months out"

// ── Screen copy (approved 2026-11-18, spec "Screen copy") ──────────────────────────────────
export const COPY = {
  disclosure: 'Answers come only from events listed on Open Eventz. Check details with the venue.',
  offTopic: "'Ask' only answers questions about events listed on Open Eventz. Try something like “things to do in Plano this Saturday”.",
  priceNote: "Open Eventz only knows whether an event is 'free' or 'paid'. Please look at the details view.",
  datesDropped: "We couldn't use those dates, so this shows all upcoming dates.",
  unsupportedCity: 'Open Eventz covers Frisco and Plano only.',
}

/** What the parse step returns, before validation. Anything unparsed is null, never guessed. */
export interface RawParse {
  out_of_scope: boolean
  date_from: string | null // YYYY-MM-DD, Central
  date_to: string | null
  city: 'frisco' | 'plano' | 'both' | 'unsupported' | null
  free_only: boolean
  price_word: boolean // a price word other than "free" ("cheap", "under $10")
  age_min: number | null
  age_max: number | null
  intent: string | null
}

export interface Filters {
  date_from: string | null
  date_to: string | null
  cities: City[] // in display order: the parent's tab first
  unsupported_city: boolean
  free_only: boolean
  age: [number, number] | null
  intent: string | null
  notes: string[] // screen notes, e.g. the price note
}

// ── Dates, all as Central calendar strings. No `new Date(<string>)` on wall times. ─────────
const DAY_MS = 86_400_000
const ymdToUtcNoon = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d, 12) }
export const addDays = (ymd: string, n: number) => new Date(ymdToUtcNoon(ymd) + n * DAY_MS).toISOString().slice(0, 10)
export const centralDate = (instantIso: string) => new Date(instantIso).toLocaleDateString('en-CA', { timeZone: TZ })
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ymdToUtcNoon(s))
export function weekdayName(ymd: string): string {
  return new Date(ymdToUtcNoon(ymd)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}
export function shortDay(ymd: string): string {
  return new Date(ymdToUtcNoon(ymd)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '')
}

/** A 21-day calendar for the parse prompt, so the model never computes a weekday itself. */
export function calendarFor(today: string, days = 21): string {
  return Array.from({ length: days }, (_, i) => { const d = addDays(today, i); return `${weekdayName(d)} ${d}` }).join('\n')
}

/**
 * Step 2 — validate the parse in code. Never silently widen: a dropped constraint is said out
 * loud in `notes`. The parent's tab decides the city when none was named.
 */
export function validateParse(raw: RawParse, tab: City, today: string): Filters {
  const notes: string[] = []
  let date_from = isYmd(raw.date_from) ? raw.date_from : null
  let date_to = isYmd(raw.date_to) ? raw.date_to : null
  if (date_from && !date_to) date_to = date_from
  if (!date_from && date_to) date_from = today
  if (date_from && date_to) {
    const horizon = addDays(today, MAX_DAYS_AHEAD)
    if (date_to < today || date_from > date_to || date_from > horizon || date_to > horizon) {
      date_from = null; date_to = null; notes.push(COPY.datesDropped)
    } else if (date_from < today) {
      date_from = today // "this week" asked on a Wednesday: the past part of the week is gone
    }
  }

  let age: [number, number] | null = null
  const lo = Number.isInteger(raw.age_min) ? raw.age_min! : null
  const hi = Number.isInteger(raw.age_max) ? raw.age_max! : lo
  if (lo != null && hi != null && lo >= 0 && hi <= 17 && lo <= hi) age = [lo, hi]

  const other: City = tab === 'frisco' ? 'plano' : 'frisco'
  let cities: City[] = [tab]
  let unsupported_city = false
  if (raw.city === 'frisco' || raw.city === 'plano') cities = [raw.city]
  else if (raw.city === 'both') cities = [tab, other]
  else if (raw.city === 'unsupported') { cities = []; unsupported_city = true }

  const free_only = raw.free_only === true && raw.price_word !== true
  if (raw.price_word === true) notes.push(COPY.priceNote)

  return { date_from, date_to, cities, unsupported_city, free_only, age, intent: raw.intent ?? null, notes }
}

/** "Free" means what the card shows as Free or Free ✦. Unknown and paid never count. */
export const isFree = (e: Event) => getPriceBadge(e)?.kind.startsWith('free') === true

/** Does an event (single- or multi-day) touch the [from, to] Central date window? */
function inWindow(e: Event, from: string, to: string): boolean {
  const s = centralDate(e.start_datetime)
  const end = e.end_datetime ? centralDate(e.end_datetime) : s
  return s <= to && end >= from
}

/**
 * Step 3 — retrieve. The same visible catalog the list serves, then the hard filters, in code.
 * Returns up to 25 per city, each in start-time order, cities in display order.
 */
export function retrieve(catalog: Event[], f: Filters, today: string): Event[] {
  const from = f.date_from ?? today
  const to = f.date_to ?? addDays(today, MAX_DAYS_AHEAD)
  const base = catalog.filter(e =>
    isCatalogVisible(e) &&
    inWindow(e, from, to) &&
    (!f.free_only || isFree(e)) &&
    (!f.age || passesAgeFilter(e, [f.age])),
  ).sort((a, b) => a.start_datetime.localeCompare(b.start_datetime) || a.id.localeCompare(b.id))
  return f.cities.flatMap(c => base.filter(e => cityOf(e) === c).slice(0, MAX_RETRIEVED_PER_CITY))
}

// ── Step 5 — the check ──────────────────────────────────────────────────────────────────────
const MONTHS = ['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
// "May" is left out on purpose: as a word it is mostly the verb ("you may like"). Known gap.
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const FACT_WORDS = [
  'free', 'paid', 'cost', 'costs', 'ticket', 'tickets', 'price', 'priced',
  ...WEEKDAYS, ...WEEKDAYS.map(w => w + 's'), ...MONTHS,
  'today', 'tonight', 'tomorrow', 'weekend', 'weekends', 'morning', 'mornings', 'evening', 'evenings', 'afternoon',
  'drop', 'dropoff', 'age', 'ages', 'aged',
  'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants', 'preschool', 'preschooler', 'preschoolers',
  'teen', 'teens', 'teenager', 'teenagers', 'tween', 'tweens', 'adult', 'adults',
]
const FACT_WORD_RE = new RegExp(`\\b(${FACT_WORDS.join('|')})\\b`, 'gi')

/**
 * Fact-shaped tokens in the answer text. Exact event titles are removed first: a title comes
 * from the stored record, not from the model, so "Saturday Music Series" or "Teen Anime Club"
 * is not the model stating a fact. Anything else matching is.
 */
export function factTokens(answer: string, citedTitles: string[]): string[] {
  let text = answer
  for (const t of [...citedTitles].sort((a, b) => b.length - a.length)) if (t) text = text.split(t).join(' ')
  const found: string[] = []
  for (const m of text.matchAll(/\d|\$/g)) found.push(m[0])
  for (const m of text.matchAll(FACT_WORD_RE)) found.push(m[0].toLowerCase())
  return found
}

export interface CheckResult { citedOk: boolean; uncited: string[]; tokens: string[]; passed: boolean }
export function checkAnswer(answer: string, citedIds: string[], retrieved: Event[]): CheckResult {
  const byId = new Map(retrieved.map(e => [e.id, e]))
  const uncited = citedIds.filter(id => !byId.has(id))
  const tokens = factTokens(answer, citedIds.map(id => byId.get(id)?.title ?? ''))
  return { citedOk: uncited.length === 0, uncited, tokens, passed: uncited.length === 0 && tokens.length === 0 }
}

// ── Framing the screen ──────────────────────────────────────────────────────────────────────
const cityLabel = (c: City) => (c === 'frisco' ? 'Frisco' : 'Plano')

export function showingLine(f: Filters): string {
  const parts: string[] = []
  if (f.date_from && f.date_to) parts.push(f.date_from === f.date_to ? shortDay(f.date_from) : `${shortDay(f.date_from)} – ${shortDay(f.date_to)}`)
  else parts.push('All upcoming dates')
  parts.push(f.unsupported_city ? 'outside Frisco and Plano' : f.cities.map(cityLabel).join(' + '))
  parts.push(f.free_only ? 'free' : 'any price')
  if (f.age) parts.push(f.age[0] === f.age[1] ? `age ${f.age[0]}` : `ages ${f.age[0]}–${f.age[1]}`)
  if (f.intent) parts.push(f.intent)
  return `Showing: ${parts.join(' · ')}`
}

/** "Nothing matched. See all Saturday events in Plano", plus the filter view it links to. */
export function nothingMatched(f: Filters): { text: string; linkText: string; link: { city: City; date_from: string | null; date_to: string | null } | null } {
  if (f.unsupported_city) return { text: `Nothing matched. ${COPY.unsupportedCity}`, linkText: '', link: null }
  const city = f.cities[0]
  const when = f.date_from && f.date_from === f.date_to ? `${weekdayName(f.date_from)} ` : ''
  const range = f.date_from && f.date_to && f.date_from !== f.date_to ? ' for those dates' : ''
  const where = f.cities.length > 1 ? 'Frisco and Plano' : cityLabel(city)
  return { text: 'Nothing matched.', linkText: `See all ${when}events in ${where}${range}`, link: { city, date_from: f.date_from, date_to: f.date_to } }
}

/** Cards in the model's order, then grouped so the parent's tab city comes first. */
export function orderCards(cited: Event[], cities: City[]): Event[] {
  return cities.flatMap(c => cited.filter(e => cityOf(e) === c))
}
