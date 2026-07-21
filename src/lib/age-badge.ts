import type { Event, AgeBucket } from './types'

// The five badge "kinds" drive what the card vs. the detail view renders (spec §2 / §6).
export type AgeBadgeKind =
  | 'structured-specific'  // Frisco/Plano single age group — DETAIL only ("Ages 0–5")
  | 'structured-multi'     // Frisco/Plano multi-group, not family — DETAIL only (range "Ages 6–17")
  | 'confirmed-family'     // Plano explicit "Families (All Ages)" — CARD + detail ("Family", gold)
  | 'inferred-family'      // Play Frisco inferred family — CARD + detail ("~ Family ✦", indigo)
  | 'inferred-specific'    // Play Frisco inferred specific age — CARD ("✦") + detail ("~ Ages … ✦")

export interface AgeBadge {
  kind: AgeBadgeKind
  label: string       // canonical text: "Family" | "Ages 0–5" | "Ages 6–17" | "Teens"
  inferred: boolean   // true for inferred-* kinds → indigo + estimated marker
  bg: string
  text: string
}

// Single simplified hover tooltip shown on the ✦ marker on CARDS (list view, desktop). The
// full, scenario-specific disclosure lives only in the DETAIL view and is composed by
// inference-disclosure.ts (it combines age + price into one line). On mobile the ✦ has no
// tooltip — the HTML `title` attribute is hover-only, so this shows on desktop and nothing on
// mobile, where tapping the card opens the detail view instead.
export const ESTIMATED_TOOLTIP = 'Estimated from description'

// Structured / confirmed palette: muted gold
const STRUCTURED_BG = '#F5F0DE'
const STRUCTURED_TEXT = '#8A7840'
// Inferred palette: lighter indigo — visually distinct from confirmed badges
const INFERRED_BG = '#EEEDF5'
const INFERRED_TEXT = '#2D3561'

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

function inferredBadge(event: Event): AgeBadge | null {
  if (event.kid_relevant !== true) return null
  // Low confidence → omit entirely (spec §2 / §4 response handling)
  if (event.age_confidence !== 'high' && event.age_confidence !== 'medium') return null

  const buckets = event.age_buckets ?? []
  if (buckets.length === 0) return null

  if (buckets.includes('family')) {
    return { kind: 'inferred-family', label: 'Family', inferred: true, bg: INFERRED_BG, text: INFERRED_TEXT }
  }

  const ranges = buckets.map(b => BUCKET_RANGE[b]).filter(Boolean)
  if (ranges.length === 0) return null
  const min = Math.min(...ranges.map(r => r[0]))
  const max = Math.max(...ranges.map(r => r[1]))
  return { kind: 'inferred-specific', label: rangeLabel(min, max), inferred: true, bg: INFERRED_BG, text: INFERRED_TEXT }
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
 * Computes the age badge for an event, or null when there's no age badge to show.
 * The `kind` tells the card and detail views what to render (they render different subsets):
 * cards show only confirmed-family / inferred-family / inferred-specific; the detail view
 * shows all kinds. See spec §2 (cards) and §6 (detail).
 */
export function getAgeBadge(event: Event): AgeBadge | null {
  if (event.source === 'play-frisco') return inferredBadge(event)
  return structuredBadge(event)
}

export interface RenderedBadge {
  content: string    // the exact text to render, e.g. "Family", "~ Family ✦", "✦", "Ages 0–5"
  tooltip?: string
  bg: string
  color: string
}

/**
 * What the LIST CARD renders (spec §2): only Family (confirmed or inferred) and the bare
 * inferred marker. Structured age ranges are detail-only → null here. Pure so it's unit-testable.
 */
export function cardAgeBadge(event: Event): RenderedBadge | null {
  const b = getAgeBadge(event)
  if (!b) return null
  if (b.kind === 'confirmed-family') return { content: 'Family', bg: b.bg, color: b.text }
  // Inferred badges get the single simplified card tooltip; the full scenario-specific
  // disclosure is detail-only (composed in inference-disclosure.ts).
  if (b.kind === 'inferred-family') return { content: '~ Family ✦', tooltip: ESTIMATED_TOOLTIP, bg: b.bg, color: b.text }
  if (b.kind === 'inferred-specific') return { content: '✦', tooltip: ESTIMATED_TOOLTIP, bg: b.bg, color: b.text }
  return null // structured-specific / structured-multi
}

/**
 * What the DETAIL view renders (spec §6): every kind, with the "~ … ✦" wrapper for inferred
 * badges. The estimate DISCLOSURE line is no longer per-badge — it is composed once for the
 * whole event (age + price) by inference-disclosure.ts. Pure so it's unit-testable.
 */
export function detailAgeBadge(event: Event): RenderedBadge | null {
  const b = getAgeBadge(event)
  if (!b) return null
  const content = b.inferred ? `~ ${b.label} ✦` : b.label
  return { content, bg: b.bg, color: b.text }
}
