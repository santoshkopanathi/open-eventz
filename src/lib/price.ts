import type { Event, PriceClass, PriceConfidence } from './types'
import { ESTIMATED_TOOLTIP } from './age-badge'

// ===========================================================================
// Play Frisco price classification — free-by-default with six risk layers
// (v1.2 spec, Part 2). City parks & rec events are free in the overwhelming
// majority of cases, so "no paid signal" is itself a signal. The layers below
// keep the single failure mode — a paid event slipping through as free — rare.
// ===========================================================================

// ---------------------------------------------------------------------------
// Keyword signal detection (the fallback parser, used when the LLM call fails).
// Whole-word matching avoids the substring false-positives that motivated v1.2
// ("fee" in "feeling"/"coffee"/"feedback"; "cost" without a number in "costume").
// ---------------------------------------------------------------------------

export type PriceSignal = 'paid' | 'free' | 'ambiguous' | 'none'

// Explicit "this costs money" language.
function hasPaidSignal(text: string): boolean {
  const lower = text.toLowerCase()
  const costMatch = /cost[:\s]+\$?\d[\d,.]*/i.test(text) || /\$[\d,.]+/.test(text)
  return (
    costMatch ||
    lower.includes('buy tickets') ||
    lower.includes('buy ticket') ||
    lower.includes('purchased ticket') ||
    lower.includes('purchase a ticket') ||
    lower.includes('purchase tickets') ||
    lower.includes('tickets on sale') ||
    lower.includes('ticket required') ||
    lower.includes('tickets required') ||
    lower.includes('no refund') ||
    /\bfees?\b/.test(lower) ||
    /\bregister for \$?\d/.test(lower) ||
    /\bper (child|person|participant|family)\b/.test(lower) ||
    /\bmaterials fee\b/.test(lower) ||
    /\badmission[:\s]+\$?\d/.test(lower)
  )
}

// Explicit "this is free" language. Deliberately narrow — "free to members"
// is NOT an explicit free statement (a cost still applies to others), and paid
// detection runs first anyway.
function hasExplicitFreeSignal(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('free admission') ||
    lower.includes('free to attend') ||
    lower.includes('free of charge') ||
    lower.includes('no cost to attend') ||
    lower.includes('admission is free') ||
    /\bfree event\b/.test(lower) ||
    /\bno cost\b/.test(lower)
  )
}

// Signals that make "free" an unreliable assumption without stating a price —
// resolve these to unknown (no badge) rather than guessing either way.
function hasAmbiguousSignal(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('at the gate') ||
    lower.includes('members only') ||
    lower.includes('member only') ||
    lower.includes('reservation required') ||
    lower.includes('reservations required') ||
    lower.includes('donations welcome') ||
    lower.includes('suggested donation')
  )
}

/**
 * Keyword fallback classifier — used only when the LLM inference call fails.
 * Order matters: an explicit paid signal always wins (so "free to members ... $7"
 * reads as paid), then explicit free, then ambiguous, else nothing.
 */
export function detectPriceSignal(text: string): PriceSignal {
  if (hasPaidSignal(text)) return 'paid'
  if (hasExplicitFreeSignal(text)) return 'free'
  if (hasAmbiguousSignal(text)) return 'ambiguous'
  return 'none'
}

// ---------------------------------------------------------------------------
// Layer 2 — structurally-paid event types. Instructor-led, structured programs
// almost always cost money. If one of these keywords is present AND there is no
// explicit price signal, we refuse the free default and resolve to unknown.
// ---------------------------------------------------------------------------

export const STRUCTURALLY_PAID_KEYWORDS = [
  'camp', 'class', 'clinic', 'workshop', 'lessons', 'league',
  'academy', 'tournament', 'per child', 'per person', 'materials fee', 'deposit',
] as const

export function hasStructurallyPaidKeyword(text: string): boolean {
  const lower = text.toLowerCase()
  // Whole-word match so "classic"/"classroom" don't trip "class", etc.
  return STRUCTURALLY_PAID_KEYWORDS.some(kw =>
    new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)
  )
}

// ---------------------------------------------------------------------------
// The single decision point — applies Layers 2 & 3 to a raw price judgment
// (from either the LLM or the keyword fallback). Layers 2/3 can only DOWNGRADE
// an inferred (no-signal) free to unknown; they never touch an explicit signal.
// ---------------------------------------------------------------------------

export interface ResolvePriceInput {
  /** Raw class from the LLM, or mapped from detectPriceSignal on fallback. */
  price: PriceClass
  /** 'confirmed' if an explicit signal backed it, 'inferred' if free-by-default. */
  price_confidence: PriceConfidence
  title: string
  description: string
  registration_required: boolean
}

export interface ResolvedPrice {
  price_class: PriceClass
  price_confidence: PriceConfidence
}

export function resolvePriceClass(input: ResolvePriceInput): ResolvedPrice {
  const { price, price_confidence, title, description, registration_required } = input

  // Layers 2 & 3 only apply to an INFERRED free (no explicit signal). An explicit
  // free statement ("free summer camp") always overrides the keyword suspicion.
  const isInferredFree = price === 'free' && price_confidence === 'inferred'
  if (isInferredFree) {
    const text = `${title} ${description}`
    const structurallyPaid = hasStructurallyPaidKeyword(text) // Layer 2
    if (structurallyPaid || registration_required /* Layer 3 */) {
      return { price_class: 'unknown', price_confidence: 'inferred' }
    }
  }

  return { price_class: price, price_confidence }
}

/**
 * The full deterministic (no-LLM) price pipeline: detect a keyword signal across the
 * title + description, map it to a raw class, then apply Layers 2/3. This is the exact
 * fallback used at scrape time and when the LLM call fails, and it is what the calibration
 * fixtures assert against.
 */
export function fallbackPriceClass(input: {
  title: string
  description: string
  registration_required: boolean
}): ResolvedPrice {
  const raw = signalToRawPrice(detectPriceSignal(`${input.title}\n${input.description}`))
  return resolvePriceClass({
    price: raw.price,
    price_confidence: raw.price_confidence,
    title: input.title,
    description: input.description,
    registration_required: input.registration_required,
  })
}

/**
 * Maps a keyword PriceSignal to the raw (price, price_confidence) pair that feeds
 * resolvePriceClass — the fallback path when the LLM call fails.
 *   paid      -> paid, confirmed
 *   free      -> free, confirmed (explicit free statement)
 *   ambiguous -> unknown, inferred
 *   none      -> free, inferred (free-by-default; Layers 2/3 may still downgrade)
 */
export function signalToRawPrice(signal: PriceSignal): { price: PriceClass; price_confidence: PriceConfidence } {
  switch (signal) {
    case 'paid':
      return { price: 'paid', price_confidence: 'confirmed' }
    case 'free':
      return { price: 'free', price_confidence: 'confirmed' }
    case 'ambiguous':
      return { price: 'unknown', price_confidence: 'inferred' }
    case 'none':
    default:
      return { price: 'free', price_confidence: 'inferred' }
  }
}

// ---------------------------------------------------------------------------
// Structured `Cost:` field (CivicPlus `itemprop="price"`). When a Play Frisco event
// exposes this field it is AUTHORITATIVE — a source-confirmed price, not an LLM read —
// so it overrides the description pipeline (and gets no ✦; see getPriceBadge). Values
// seen in the wild: "Free", "$35", occasionally "Paid".
// ---------------------------------------------------------------------------
export function interpretCostField(raw: string | null | undefined): PriceClass | null {
  if (!raw) return null
  const s = raw.toLowerCase().trim()
  if (!s) return null
  // "Free" wins even if a "$0" tags along; a real price ($ + digit) or "paid" ⇒ paid.
  if (s.includes('free')) return 'free'
  if (/\$\s*\d/.test(s) || s.includes('paid') || /\bfees?\b/.test(s)) return 'paid'
  return null
}

// ---------------------------------------------------------------------------
// Layer 5 — derive the stored display fields from the resolved class. is_free is
// kept as a column so the events API can filter on it; price_class stays the
// source of truth so the policy can be re-derived without re-running the LLM.
// ---------------------------------------------------------------------------

export function priceClassToFields(price_class: PriceClass): { is_free: boolean | null; price_text: string | null } {
  switch (price_class) {
    case 'free':
      return { is_free: true, price_text: 'Free' }
    case 'paid':
      return { is_free: false, price_text: 'Paid' }
    case 'unknown':
    default:
      return { is_free: null, price_text: null }
  }
}

// ---------------------------------------------------------------------------
// Layer 4 — the price badge (Definition A). On Play Frisco, every price is an LLM
// read of the description (there is no structured fee field), so ALL Play Frisco
// price badges are inferred and carry the ✦ — free AND paid. Library sources are
// free by institutional default → confirmed, no ✦. The estimate DISCLOSURE text is
// composed separately (see inference-disclosure.ts), combining age + price into one
// line; this module only decides the badge chip.
// ---------------------------------------------------------------------------

export type PriceBadgeKind = 'free-confirmed' | 'free-inferred' | 'paid-confirmed' | 'paid-inferred'

export interface PriceBadge {
  kind: PriceBadgeKind
  label: 'Free' | 'Paid'
  inferred: boolean // true -> render with ✦; contributes to the estimate disclosure
  bg: string
  text: string
}

// Weekend Paper: "Free" is the only green in the system; "Paid" is a neutral chip.
const FREE_BG = '#E6EFE7'
const FREE_TEXT = '#3F6248'
const PAID_BG = '#F3EDE3'
const PAID_TEXT = '#6E675C'

/**
 * Resolves an event to its price badge, or null when nothing should show.
 *
 * Definition A (refined): on Play Frisco the price is usually an LLM read of the description
 * (`price_confidence = 'inferred'`) → it wears the ✦. BUT when the price came from the
 * structured `Cost:` field (`price_confidence = 'confirmed'`), it's a source-confirmed fact,
 * not an estimate → plain `Free`/`Paid`, NO ✦ (like library sources). `unknown` shows NO badge.
 * Library sources are institutionally free → confirmed, no ✦.
 */
export function getPriceBadge(event: Pick<Event, 'source' | 'price_class' | 'price_confidence' | 'is_free'>): PriceBadge | null {
  if (event.source === 'play-frisco') {
    const inferred = event.price_confidence !== 'confirmed' // confirmed (Cost field) ⇒ no ✦
    if (event.price_class === 'free') return { kind: inferred ? 'free-inferred' : 'free-confirmed', label: 'Free', inferred, bg: FREE_BG, text: FREE_TEXT }
    if (event.price_class === 'paid') return { kind: inferred ? 'paid-inferred' : 'paid-confirmed', label: 'Paid', inferred, bg: PAID_BG, text: PAID_TEXT }
    return null // unknown / not-yet-classified -> no badge
  }
  // Library / structured sources: confirmed by institutional default.
  if (event.is_free === true) return { kind: 'free-confirmed', label: 'Free', inferred: false, bg: FREE_BG, text: FREE_TEXT }
  if (event.is_free === false) return { kind: 'paid-confirmed', label: 'Paid', inferred: false, bg: PAID_BG, text: PAID_TEXT }
  return null
}

export interface RenderedPriceBadge {
  content: string // exact text: "Free" | "Free ✦" | "Paid" | "Paid ✦" | "Free admission"
  tooltip?: string
  bg: string
  color: string
}

/** What the LIST CARD renders: "Free ✦" / "Paid ✦" (inferred) or plain "Free" / "Paid" (confirmed). */
export function cardPriceBadge(event: Pick<Event, 'source' | 'price_class' | 'price_confidence' | 'is_free'>): RenderedPriceBadge | null {
  const b = getPriceBadge(event)
  if (!b) return null
  if (b.inferred) {
    return { content: `${b.label} ✦`, tooltip: ESTIMATED_TOOLTIP, bg: b.bg, color: b.text }
  }
  return { content: b.label, bg: b.bg, color: b.text }
}

/** What the DETAIL view renders: inferred → "Free ✦" / "Paid ✦"; confirmed free → "Free admission". */
export function detailPriceBadge(event: Pick<Event, 'source' | 'price_class' | 'price_confidence' | 'is_free'>): RenderedPriceBadge | null {
  const b = getPriceBadge(event)
  if (!b) return null
  if (b.inferred) {
    return { content: `${b.label} ✦`, bg: b.bg, color: b.text }
  }
  const content = b.kind === 'free-confirmed' ? 'Free admission' : 'Paid'
  return { content, bg: b.bg, color: b.text }
}
