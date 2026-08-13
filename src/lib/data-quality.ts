import type { Event } from './types'
import { passesAgeFilter } from './age-filter'

// Pure data-quality checks run against REAL ingested events (post-ingest gate). These exist
// because the unit/E2E suites are logic-only (mocked) and never see real data — so an upstream
// source change (e.g. BiblioCommons going client-side-rendered → every Frisco age collapsed to
// 0–17) passed every test while corrupting production. See INGEST-DESIGN.md §Data-quality gate.

export interface QualityCheck {
  name: string
  pass: boolean
  detail: string
}

/**
 * Share of events collapsed into a single (age_min,age_max) bucket. A proxy for "age extraction
 * broke and everything fell to one value" (the 0–17 fallback). Healthy data has variety; a near-1
 * share is the fingerprint of the break we just fixed.
 */
export function dominantAgeBucketShare(events: Event[]): { share: number; bucket: string } {
  if (events.length === 0) return { share: 0, bucket: 'n/a' }
  const counts = new Map<string, number>()
  for (const e of events) {
    const k = `${e.age_min}-${e.age_max}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let bucket = '', top = 0
  for (const [k, v] of counts) if (v > top) { top = v; bucket = k }
  return { share: top / events.length, bucket }
}

// Titles that clearly target adults. Deliberately narrow (whole-word, explicit phrases) to avoid
// false positives like "Young Adult" fiction — this flags a stored-age bug, not a taxonomy call.
const ADULT_TITLE = /\bfor adults\b|\badult['’]?s?\b|\bseniors?\b|\b18\+\b/i

/**
 * Events whose title clearly targets adults but are stored kid-visible (age_min < 18). This is the
 * exact symptom of the age break — "D&D for Adults" stored as 0–17 leaks past the `age_min < 18`
 * gate into a kids app. Should be zero.
 */
export function adultTitleLeaks(events: Event[]): Event[] {
  return events.filter(e => ADULT_TITLE.test(e.title) && (e.age_min ?? 0) < 18)
}

/**
 * Fraction of events that pass the Toddlers (0–5) filter. A kid age-filter must actually NARROW —
 * if selecting Toddlers returns ~everything, the age data is meaningless (the filter-no-op bug).
 */
export function ageFilterNarrowShare(events: Event[]): number {
  if (events.length === 0) return 0
  return events.filter(e => passesAgeFilter(e, [[0, 5]])).length / events.length
}

export interface FriscoAgeThresholds {
  minCount: number
  maxDominantShare: number
  maxToddlerShare: number
}

export const DEFAULT_FRISCO_THRESHOLDS: FriscoAgeThresholds = {
  minCount: 30,        // a near-empty Frisco set means the listing scrape broke
  maxDominantShare: 0.85, // >85% in one age bucket ⇒ age extraction collapsed
  maxToddlerShare: 0.9,   // Toddlers(0–5) matching >90% of events ⇒ filter is a no-op
}

/**
 * The Frisco age-health checks — the ones that would have caught this incident. Pure over the
 * event set so it's unit-tested; the script wires it to the live DB and turns failures red.
 */
export function friscoAgeChecks(friscoEvents: Event[], t: FriscoAgeThresholds = DEFAULT_FRISCO_THRESHOLDS): QualityCheck[] {
  const dom = dominantAgeBucketShare(friscoEvents)
  const leaks = adultTitleLeaks(friscoEvents)
  const toddlerShare = ageFilterNarrowShare(friscoEvents)
  return [
    { name: 'frisco: non-empty', pass: friscoEvents.length >= t.minCount, detail: `${friscoEvents.length} events (min ${t.minCount})` },
    { name: 'frisco: age variety', pass: dom.share <= t.maxDominantShare, detail: `top bucket ${dom.bucket} = ${(dom.share * 100).toFixed(0)}% (max ${(t.maxDominantShare * 100).toFixed(0)}%)` },
    { name: 'frisco: no adult-title leaks', pass: leaks.length === 0, detail: leaks.length ? `${leaks.length} leaked, e.g. "${leaks[0].title}"` : 'none' },
    { name: 'frisco: toddler filter narrows', pass: toddlerShare <= t.maxToddlerShare, detail: `Toddlers(0–5) matches ${(toddlerShare * 100).toFixed(0)}% (max ${(t.maxToddlerShare * 100).toFixed(0)}%)` },
  ]
}
