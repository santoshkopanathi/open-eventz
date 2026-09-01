import type { Event, AgeBucket, EventSource } from './types'

// Sources whose age comes from the LLM as buckets, not from a structured age_min/age_max.
// Previously this was a bare `source === 'play-frisco'` check, which silently excluded every
// Kaleidoscope event: it fell through to the structured branch, which requires age_min/age_max,
// and Kaleidoscope has neither — so applying ANY age filter hid all 106 of them.
export const LLM_CLASSIFIED_SOURCES: EventSource[] = ['play-frisco', 'kaleidoscope-park']

// Numeric age ranges for each inferred bucket
export const BUCKET_RANGE: Record<AgeBucket, [number, number]> = {
  toddler: [0, 5],
  kids: [6, 12],
  teen: [13, 17],
  family: [0, 17], // family overlaps every age chip (spec §5)
}

export function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin <= bMax && aMax >= bMin
}

/**
 * The age buckets an event should be filtered by — the model's answer, with one fallback.
 *
 * When the age is unclear (low confidence, or no bucket returned) the event falls back to
 * `family`, so it appears under every age chip rather than vanishing. That is deliberate:
 * uncertainty about WHICH ages should cost the age claim, never the event itself. Visibility
 * is gated separately, on kid-relevance confidence, in the ingest.
 *
 * Exported so the badge and the filter cannot drift apart — a card that says "Family" must
 * appear under the toddler chip, and one that says "Ages 13–17" must not.
 */
export function effectiveAgeBuckets(e: Pick<Event, 'age_buckets' | 'age_confidence'>): AgeBucket[] {
  const buckets = e.age_buckets ?? []
  if (buckets.length === 0 || e.age_confidence === 'low') return ['family']
  return buckets
}

/**
 * Decides whether an event passes an active age filter — the selection is one or more ranges
 * (multi-select, OR logic; spec §5.4). An event passes if it overlaps ANY selected range.
 * - LLM-classified sources: must be kid-relevant, then match on `effectiveAgeBuckets`
 *   ("family" overlaps all). Not-kid-relevant events are excluded when a chip is active.
 * - Structured library sources: overlap on age_min/age_max; no age data means excluded.
 *
 * Pure function — no DB access — so it is unit-testable independent of the events route.
 */
export function passesAgeFilter(e: Event, ranges: [number, number][]): boolean {
  if (LLM_CLASSIFIED_SOURCES.includes(e.source)) {
    if (e.kid_relevant !== true) return false
    return effectiveAgeBuckets(e).some(b => {
      const r = BUCKET_RANGE[b]
      return r ? ranges.some(([lo, hi]) => rangesOverlap(r[0], r[1], lo, hi)) : false
    })
  }
  // Structured library sources — event passes if it overlaps ANY selected age range (OR logic)
  if (e.age_min == null || e.age_max == null) return false
  return ranges.some(([lo, hi]) => e.age_min! <= hi && e.age_max! >= lo)
}
