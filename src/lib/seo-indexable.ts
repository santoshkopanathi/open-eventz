import type { Event } from './types'
import type { CitySlug } from './site'

// ===========================================================================
// Pure "is this event indexable / which city does it belong to" logic. Kept free
// of any I/O (no supabase import) so it is unit-testable and safe to import from
// both server data code and the sitemap. Mirrors the app's list gates so the
// crawlable surfaces never disagree with what the app shows.
// ===========================================================================

// Frisco Library children feeds occasionally mislabel adult programs; these are
// excluded from the app list (see api/events) and must not be indexed either.
const FRISCO_ADULT_KEYWORDS = [
  'book club', 'write club', 'figure club', "reader's choice",
  "entrepreneur's workshop", 'esl book',
]

// Which city each source belongs to. Declared source-first, not city-first, and typed as a
// complete Record: **adding a source without giving it a city is a type error.**
//
// It used to be the other way round — a city→sources map — and `kaleidoscope-park` was added to
// the pipeline on 2026-10-20 without being added here. Nobody noticed for three weeks, because
// the failure was invisible from every direction: the app lists Kaleidoscope under Frisco (its
// own filter has the source), and the sitemap lists its events (it applies no city filter), so
// only `/frisco` — the page built to rank for "free kids events in frisco" and to link them —
// quietly omitted all ten. A city→sources list cannot be checked for completeness; this can.
const SOURCE_CITY: Record<Event['source'], CitySlug> = {
  'frisco-library': 'frisco',
  'play-frisco': 'frisco',
  'kaleidoscope-park': 'frisco',
  'plano-library': 'plano',
}

export const CITY_SOURCES: Record<CitySlug, Event['source'][]> = {
  frisco: (Object.keys(SOURCE_CITY) as Event['source'][]).filter(s => SOURCE_CITY[s] === 'frisco'),
  plano: (Object.keys(SOURCE_CITY) as Event['source'][]).filter(s => SOURCE_CITY[s] === 'plano'),
}

/** The city a source's events belong to. */
export function cityForSource(source: Event['source']): CitySlug {
  return SOURCE_CITY[source]
}

/** Start of "today" in Central Time, as a UTC ISO string (midnight CT). */
export function startOfTodayCtIso(now: Date = new Date()): string {
  const todayCT = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  todayCT.setUTCHours(5, 0, 0, 0) // midnight CDT (UTC-5)
  if (now.getUTCHours() < 5) todayCT.setUTCDate(todayCT.getUTCDate() - 1)
  return todayCT.toISOString()
}

/**
 * Whether an event should be publicly indexed (listed in the sitemap, marked
 * indexable on its page). Mirrors the app's list gates: not-kid-relevant Play
 * Frisco events, adult programs, mislabeled Frisco adult programs, and past
 * one-off events are all excluded.
 */
export function isIndexableEvent(event: Event, todayIso: string): boolean {
  // Play Frisco events explicitly judged not kid-relevant are never shown.
  if (event.source === 'play-frisco' && event.kid_relevant === false) return false
  // Adults-only programs (Frisco Library marks these age_min >= 18).
  if (event.age_min != null && event.age_min >= 18) return false
  // Mislabeled Frisco adult programs surfaced under children feeds.
  if (event.source === 'frisco-library') {
    const t = event.title.toLowerCase()
    if (FRISCO_ADULT_KEYWORDS.some(kw => t.includes(kw))) return false
  }
  // Dates we inferred rather than read: shown in the app, never published to Google. We
  // cannot put an event in a sitemap or emit Event rich data for a date nobody announced.
  if (event.date_inferred === true) return false
  // Past events: a one-off that already started (and, if multi-day, already ended).
  const ended = event.end_datetime ? event.end_datetime < todayIso : event.start_datetime < todayIso
  if (ended) return false
  return true
}
