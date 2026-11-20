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
import { visibleText } from '../source-text'

export type City = 'frisco' | 'plano'
export const TZ = 'America/Chicago'
export const MAX_RETRIEVED_PER_CITY = 25
export const MAX_CITED = 5
export const MAX_DAYS_AHEAD = 183 // "can't be more than 6 months out"

// ── Screen copy (approved 2026-11-18, spec "Screen copy") ──────────────────────────────────
export const COPY = {
  disclosure: 'Answers come only from events listed on Open Eventz. Check details with the venue.',
  offTopic: "'Ask' only answers questions about events listed on Open Eventz. Try something like “things to do in Plano this Saturday”.",
  // Owner revision 2026-11-19.
  priceNote: "Open Eventz only shows whether an event is 'free' or 'paid'. It does not determine if something is cheap or pricey.",
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

// ── City typos ──────────────────────────────────────────────────────────────────────────────
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/**
 * A near-spelling of Frisco or Plano in the question ("Friso", "Fricso", "Plno"), or null.
 * Found 2026-11-18 in the first hands-on test: "…in Friso for my 10 year old…" parsed as an
 * uncovered city and returned "Nothing matched". Decided in code, not left to the prompt: the
 * eval showed prompt instructions don't reliably change model behaviour. Exact matches are left
 * to the parse; this only rescues a typo, and the screen says so.
 */
export function misspelledCity(question: string): { city: City; word: string } | null {
  // Real words one or two letters from a city name. "piano lessons" must never become Plano.
  const LOOKALIKES = new Set(['piano', 'pianos', 'plan', 'plans', 'plane', 'planes', 'plant', 'disco', 'fresco', 'risco'])
  for (const word of question.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (word.length < 4 || LOOKALIKES.has(word)) continue
    for (const city of ['frisco', 'plano'] as const) {
      if (word !== city && editDistance(word, city) <= (city === 'plano' ? 1 : 2)) return { city, word }
    }
  }
  return null
}
export const typoNote = (word: string, city: City) => `We read “${word}” as ${city === 'frisco' ? 'Frisco' : 'Plano'}.`

/** "Free" means what the card shows as Free or Free ✦. Unknown and paid never count. */
export const isFree = (e: Event) => getPriceBadge(e)?.kind.startsWith('free') === true

/** Does an event (single- or multi-day) touch the [from, to] Central date window? */
function inWindow(e: Event, from: string, to: string): boolean {
  const s = centralDate(e.start_datetime)
  const end = e.end_datetime ? centralDate(e.end_datetime) : s
  return s <= to && end >= from
}

/**
 * Not an event at all: a closure notice the library publishes on its event feed. Owner rule
 * 2026-11-19: never shown by Ask. (The same rows still appear in the list view; that is the
 * deferred ingest fix in OPEN-ITEMS.md.)
 */
export const isNonEvent = (e: Pick<Event, 'title'>) => /\blibrary closed\b/i.test(e.title)

// Words in an intent that say nothing about the topic. Time-of-day words are left to the model.
const NON_TOPIC = new Set(['things', 'thing', 'stuff', 'events', 'event', 'activities', 'activity', 'fun', 'kids', 'kid',
  'family', 'class', 'classes', 'lessons', 'lesson', 'program', 'programs', 'something', 'anything', 'ideas',
  'morning', 'afternoon', 'evening', 'night', 'tonight', 'weekend', 'indoor', 'outdoor', 'near', 'with', 'for', 'and'])

/** Topic words from the parse's intent ("science or space" → science, space). */
export function topicWords(intent: string | null): string[] {
  return (intent ?? '').toLowerCase().match(/[a-z&]+/g)?.filter(w => w.length >= 4 && !NON_TOPIC.has(w)) ?? []
}

/** Does an event's title or description mention a topic word (whole word, or plural)? */
export function mentionsTopic(e: Pick<Event, 'title' | 'description'>, words: string[]): boolean {
  if (!words.length) return false
  const text = `${e.title} ${visibleText(e.description)}`.toLowerCase()
  return words.some(w => new RegExp(`\\b${w.replace(/[^a-z]/g, '')}(s|es)?\\b`).test(text))
}

/**
 * Step 3 — retrieve. The same visible catalog the list serves, then the hard filters, in code.
 * Returns up to 25 per city, cities in display order.
 *
 * TOPIC FIRST (fix A, 2026-11-19). An undated question ("where can my kid play chess?") matches
 * hundreds of events, and the first 25 by start time are mostly storytimes, so a later chess
 * meet-up never reached the model. Events whose title or description mention the topic now go
 * first, then the rest, each in start-time order. Same cap, same cost; only the order changes.
 */
export function retrieve(catalog: Event[], f: Filters, today: string): Event[] {
  const from = f.date_from ?? today
  const to = f.date_to ?? addDays(today, MAX_DAYS_AHEAD)
  const words = topicWords(f.intent)
  const base = catalog.filter(e =>
    isCatalogVisible(e) &&
    !isNonEvent(e) &&
    inWindow(e, from, to) &&
    (!f.free_only || isFree(e)) &&
    (!f.age || passesAgeFilter(e, [f.age])),
  ).sort((a, b) => a.start_datetime.localeCompare(b.start_datetime) || a.id.localeCompare(b.id))
  const ranked = words.length ? [...base.filter(e => mentionsTopic(e, words)), ...base.filter(e => !mentionsTopic(e, words))] : base
  return f.cities.flatMap(c => ranked.filter(e => cityOf(e) === c).slice(0, MAX_RETRIEVED_PER_CITY))
}

/**
 * One card per program (owner rule 2026-11-19): the same title twice is the same program at
 * another time or branch. Keep the first. Exception: when the parent asked for that very thing
 * ("chess", "storytime"), more sessions of it are the answer, so copies stay.
 */
export function onePerProgram(cards: Event[], intent: string | null): Event[] {
  const words = topicWords(intent)
  const seen = new Set<string>()
  return cards.filter(e => {
    const key = e.title.trim().toLowerCase()
    if (!seen.has(key)) { seen.add(key); return true }
    return mentionsTopic({ title: e.title, description: null }, words)
  })
}

/** "Here are a few events in Plano on Saturday, Nov 21:" — the uncovered-city fallback heading. */
export function fallbackHeading(city: City, f: Filters): string {
  const name = city === 'frisco' ? 'Frisco' : 'Plano'
  if (f.date_from && f.date_to && f.date_from === f.date_to) return `Here are a few events in ${name} on ${weekdayName(f.date_from)}, ${shortDay(f.date_from).split(' ').slice(1).join(' ')}:`
  if (f.date_from && f.date_to) return `Here are a few events in ${name} from ${shortDay(f.date_from)} to ${shortDay(f.date_to)}:`
  return `Here are a few events coming up in ${name}:`
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
