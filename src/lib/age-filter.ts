import type { Event, AgeBucket } from './types'

// Numeric age ranges for each inferred bucket (Play Frisco LLM inference)
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
 * Decides whether an event passes an active age filter — the selection is one or more ranges
 * (multi-select, OR logic; spec §5.4). An event passes if it overlaps ANY selected range.
 * - Library events (structured age_min/age_max): overlap match; events with no age data are excluded.
 * - Play Frisco events (LLM-inferred): kid_relevant + high/medium confidence + a bucket that
 *   overlaps any selection ("family" overlaps all). Low-confidence / no-bucket / not-kid-relevant
 *   Play Frisco events are excluded when an age chip is active (spec §3, §5).
 *
 * Pure function — no DB access — so it is unit-testable independent of the events route.
 */
export function passesAgeFilter(e: Event, ranges: [number, number][]): boolean {
  if (e.source === 'play-frisco') {
    if (e.kid_relevant !== true) return false
    if (e.age_confidence !== 'high' && e.age_confidence !== 'medium') return false
    const buckets = e.age_buckets ?? []
    return buckets.some(b => {
      const r = BUCKET_RANGE[b]
      return r ? ranges.some(([lo, hi]) => rangesOverlap(r[0], r[1], lo, hi)) : false
    })
  }
  // Structured library sources — event passes if it overlaps ANY selected age range (OR logic)
  if (e.age_min == null || e.age_max == null) return false
  return ranges.some(([lo, hi]) => e.age_min! <= hi && e.age_max! >= lo)
}
