export type EventSource = 'frisco-library' | 'plano-library' | 'play-frisco' | 'kaleidoscope-park'
export type EventCategory = 'library' | 'parks-rec' | 'arts' | 'stem' | 'sports' | 'music'

export interface Event {
  id: string
  source: EventSource
  title: string
  description: string | null
  start_datetime: string
  end_datetime: string | null
  location_name: string | null
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  // Derived display price (v1.2): true = free, false = paid, null = unknown/no badge.
  // These are DERIVED from price_class via priceClassToFields() and stored so the events
  // API can still filter on is_free. The source of truth is price_class below.
  is_free: boolean | null
  price_text: string | null
  age_min: number | null
  age_max: number | null
  age_label: string | null
  /** This occurrence s DATE was inferred from a stated cadence, not published. See migration 008. */
  date_inferred?: boolean
  is_recurring: boolean
  recurrence_label: string | null
  thumbnail_url: string | null
  event_url: string
  category: EventCategory | null
  registration_required: boolean
  // Play Frisco LLM age inference (null for structured library sources)
  kid_relevant: boolean | null
  // Null on rows classified before migration 007 — treated as "not low", so the visibility
  // gate does not fire. See supabase/migrations/007_kid_confidence_and_age_basis.sql.
  kid_confidence: AgeConfidence | null
  age_buckets: AgeBucket[] | null
  // Null on pre-007 rows — treated as 'assumed', which is the previous behaviour.
  age_basis: AgeBasis | null
  age_confidence: AgeConfidence | null
  age_reasoning: string | null
  // Play Frisco price inference (v1.2). Raw source of truth for the free-by-default policy;
  // null for structured library sources (which are hardcoded is_free = true).
  // price_confidence: 'confirmed' = explicit signal in text; 'inferred' = free-by-default.
  price_class: PriceClass | null
  price_confidence: PriceConfidence | null
  // price_decided_by: WHICH LAYER settled the price. Null on rows written before the column
  // existed — honest, since the provenance of those is genuinely unknown. See migration 009:
  // an 'unknown' from the model and an 'unknown' our own rules imposed need opposite fixes.
  price_decided_by?: PriceDecider | null
  price_reasoning: string | null
  ingested_at: string
  created_at: string
}

export type AgeBucket = 'toddler' | 'kids' | 'teen' | 'family'
export type AgeConfidence = 'high' | 'medium' | 'low'

// Did the source STATE an age, or did the model work it out? Drives the estimated ✦ marker.
// Previously inferred from the source (every Play Frisco age was assumed inferred), which
// wrongly marked "Open to ages 5 and up" as an estimate.
export type AgeBasis = 'stated' | 'assumed'
export type PriceClass = 'free' | 'paid' | 'unknown'
// 'confirmed' = an explicit price signal was found in the text (paid, or an explicit
// free statement). 'inferred' = free-by-default (no signal) — rendered as "Free ✦".
export type PriceConfidence = 'confirmed' | 'inferred'

/**
 * WHICH LAYER SETTLED AN EVENT'S PRICE.
 *
 * Stored because `price_class = 'unknown'` is a terminal state reachable two ways that need
 * opposite fixes: the model declining to commit (a prompt concern) and our own deterministic
 * rules overriding a model answer (a threshold concern). Before this existed, telling them
 * apart meant reading the model's prose reasoning and noticing it disagreed with the stored
 * class — which worked, because the reasoning is written before the rules run, but is a
 * forensic exercise rather than a query.
 *
 * It separates the FREE values too, and that matters as much: a free from a library's
 * institutional default, a free the source published in machine-readable form, a free read
 * from a structured Cost field, and a free the model assumed because the text said nothing
 * are four different claims that otherwise look identical in the table.
 */
export type PriceDecider =
  /** A structured price field on the source page. Authoritative. */
  | 'source-cost-field'
  /** The source's own machine-readable "this is free" statement (Kaleidoscope JSON-LD). */
  | 'source-declared'
  /** Free because of what the venue is — library programming. No judgment involved. */
  | 'source-institution'
  /** The model's judgment stood unchanged. */
  | 'model'
  /** Layer 2 overrode an inferred free: the text names a fee-associated activity. */
  | 'rule-keyword'
  /** Layer 3 overrode an inferred free: the event requires registration. */
  | 'rule-registration'


export interface AgeInference {
  kid_relevant: boolean
  // How sure the model is that a parent would choose this for their child. GATES VISIBILITY.
  kid_confidence: AgeConfidence
  age_buckets: AgeBucket[]
  age_basis: AgeBasis
  // How precisely the age is known. Decides the age badge ONLY — never whether the event exists.
  confidence: AgeConfidence
  reasoning: string
}

// Combined Play Frisco inference — age relevance + price classification from a
// single Claude call (v1.2). Price rides the existing age-inference request.
// `price`/`price_confidence` here are the LLM's raw judgment BEFORE the deterministic
// Layer 2/3 overrides in resolvePriceClass().
export interface PlayFriscoInference extends AgeInference {
  price: PriceClass
  price_confidence: PriceConfidence
  price_reasoning: string
}

export interface Venue {
  location_name: string
  location_address: string | null
  location_lat: number
  location_lng: number
  source: EventSource
}

export interface SupervisionPolicy {
  source: EventSource
  tier: 1 | 2 | 3
  unattended_age_min: number | null
  display_text: string
  policy_url: string | null
  verified_date: string | null
  notes: string | null
}

export interface EventFilters {
  source?: EventSource
  is_free?: boolean
  age?: number
  date_from?: string
  date_to?: string
}
