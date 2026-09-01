import type { Event, AgeBucket } from './types'
import { LLM_CLASSIFIED_SOURCES, effectiveAgeBuckets } from './age-filter'

// The badge "kinds" drive what the card vs. the detail view renders (spec §2 / §6).
export type AgeBadgeKind =
  | 'structured-specific'  // library single age group — DETAIL only ("Ages 0–5")
  | 'structured-multi'     // library multi-group, not family — DETAIL only ("Ages 6–17")
  | 'confirmed-family'     // the source stated all-ages — CARD + detail ("Family")
  | 'inferred-family'      // we worked out family — CARD + detail ("Family ✦")
  | 'inferred-specific'    // we worked out a range — DETAIL only ("Ages 13–17 ✦")

export interface AgeBadge {
  kind: AgeBadgeKind
  label: string       // canonical text: "Family" | "Ages 0–5" | "Ages 6–17" | "Teens"
  inferred: boolean   // true → wears the ✦ and contributes to the estimate disclosure
  bg: string
  text: string
}

// Single simplified hover tooltip shown on the ✦ on CARDS (list view, desktop). The full,
// scenario-specific disclosure lives only in the DETAIL view and is composed by
// inference-disclosure.ts (it combines age + price into one line). On mobile the ✦ has no
// tooltip — `title` is hover-only — and tapping the card opens the detail view instead.
export const ESTIMATED_TOOLTIP = 'Estimated from description'

// Structured / confirmed palette: neutral fill-subtle chip (Weekend Paper)
const STRUCTURED_BG = '#F3EDE3'
const STRUCTURED_TEXT = '#6E675C'
// Inferred palette: rust accent-tint — signals an estimated (not confirmed) badge
const INFERRED_BG = '#F6E7DD'
const INFERRED_TEXT = '#8F4A2B'

const BUCKET_RANGE: Record<AgeBucket, [number, number]> = {
  toddler: [0, 5],
  kids: [6, 12],
  teen: [13, 17],
  family: [0, 17],
}

// The three visible age groups, for detecting single vs. multi-group structured events
const GROUPS: { min: number; max: number }[] = [
  { min: 0, max: 5 },
  { min: 6, max: 12 },
  { min: 13, max: 17 },
]

const rangeLabel = (min: number, max: number) => `Ages ${min}–${max}`

/**
 * Badge for an LLM-classified source (Play Frisco, Kaleidoscope Park).
 *
 * Two things changed here in v1.3, both because the marker used to be decided by SOURCE
 * rather than by evidence:
 *
 * 1. **`age_basis` drives the ✦, not the source.** Every Play Frisco age was treated as
 *    inferred, so a description reading "Open to ages 5 and up" still told the parent we had
 *    guessed. And Kaleidoscope was routed to the *structured* path entirely, so its
 *    LLM-guessed `family` showed as source-confirmed — the same error in the other direction,
 *    on every visible event from that source.
 *
 * 2. **Low age confidence no longer returns null.** It used to hide the badge, but the event
 *    had usually already been deleted upstream by the same score. Now the event stays, falls
 *    back to `family`, and says so with a ✦. Uncertainty about WHICH ages costs precision,
 *    never the event.
 */
function inferredBadge(event: Event): AgeBadge | null {
  if (event.kid_relevant !== true) return null

  // Same fallback the filter uses, imported rather than duplicated — a card reading "Family"
  // must appear under the toddler chip, and the two rules drifting apart is how that breaks.
  const buckets = effectiveAgeBuckets(event)

  // `age_basis` is null on rows classified before migration 007 → treat as assumed, which is
  // the previous behaviour. Over-disclosing an estimate is the safe direction.
  const stated = event.age_basis === 'stated'

  if (buckets.includes('family')) {
    return stated
      ? { kind: 'confirmed-family', label: 'Family', inferred: false, bg: STRUCTURED_BG, text: STRUCTURED_TEXT }
      : { kind: 'inferred-family', label: 'Family', inferred: true, bg: INFERRED_BG, text: INFERRED_TEXT }
  }

  const ranges = buckets.map(b => BUCKET_RANGE[b]).filter(Boolean)
  if (ranges.length === 0) return null
  const min = Math.min(...ranges.map(r => r[0]))
  const max = Math.max(...ranges.map(r => r[1]))
  return stated
    ? { kind: 'structured-specific', label: rangeLabel(min, max), inferred: false, bg: STRUCTURED_BG, text: STRUCTURED_TEXT }
    : { kind: 'inferred-specific', label: rangeLabel(min, max), inferred: true, bg: INFERRED_BG, text: INFERRED_TEXT }
}

function structuredBadge(event: Event): AgeBadge | null {
  // Plano explicit "Families (All Ages)" — carried as age_buckets=['family'] at ingest (spec §2/§3).
  // This is the ONLY structured "Family"; never derived from a numeric multi-group span.
  if ((event.age_buckets ?? []).includes('family')) {
    return { kind: 'confirmed-family', label: 'Family', inferred: false, bg: STRUCTURED_BG, text: STRUCTURED_TEXT }
  }

  if (event.age_min == null || event.age_max == null) return null

  const overlapped = GROUPS.filter(g => event.age_min! <= g.max && event.age_max! >= g.min)
  if (overlapped.length === 0) return null // adult-only or out of range

  if (overlapped.length > 1) {
    return { kind: 'structured-multi', label: rangeLabel(event.age_min, event.age_max), inferred: false, bg: STRUCTURED_BG, text: STRUCTURED_TEXT }
  }

  const g = overlapped[0]
  let label: string
  if (g.min === 0) label = 'Ages 0–5'
  else if (g.min === 6) label = 'Ages 6–12'
  else label = event.source === 'frisco-library' ? 'Teens' : 'Ages 13–17'
  return { kind: 'structured-specific', label, inferred: false, bg: STRUCTURED_BG, text: STRUCTURED_TEXT }
}

/**
 * Computes the age badge for an event, or null when there is no age badge to show.
 * Routing is by whether the source is LLM-classified — NOT by a single source name, which is
 * what left Kaleidoscope on the structured path with no age_min to read.
 */
export function getAgeBadge(event: Event): AgeBadge | null {
  return LLM_CLASSIFIED_SOURCES.includes(event.source) ? inferredBadge(event) : structuredBadge(event)
}

export interface RenderedBadge {
  content: string    // the exact text to render, e.g. "Family", "Family ✦", "Ages 0–5"
  tooltip?: string
  bg: string
  color: string
}

/**
 * What the LIST CARD renders (spec §2): **only Family**, confirmed or inferred.
 *
 * Specific age ranges are detail-only, and in v1.3 the bare "✦" that used to stand in for them
 * is gone too — a lone star with no text told a parent nothing. Net effect: a card shows an age
 * chip only when the answer is "Family". Every specific range, stated or inferred, is
 * detail-view only.
 */
export function cardAgeBadge(event: Event): RenderedBadge | null {
  const b = getAgeBadge(event)
  if (!b) return null
  if (b.kind === 'confirmed-family') return { content: 'Family', bg: b.bg, color: b.text }
  if (b.kind === 'inferred-family') return { content: 'Family ✦', tooltip: ESTIMATED_TOOLTIP, bg: b.bg, color: b.text }
  return null // specific ranges — detail only
}

/**
 * What the DETAIL view renders (spec §6): every kind, with a trailing ✦ on inferred badges.
 * The tilde prefix ("~ Family ✦") is gone as of v1.3 — price never had one, and the star
 * already carries the meaning. The estimate DISCLOSURE line is composed once for the whole
 * event (age + price) by inference-disclosure.ts.
 */
export function detailAgeBadge(event: Event): RenderedBadge | null {
  const b = getAgeBadge(event)
  if (!b) return null
  return { content: b.inferred ? `${b.label} ✦` : b.label, bg: b.bg, color: b.text }
}
