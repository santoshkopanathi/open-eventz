export type EventSource = 'frisco-library' | 'plano-library' | 'play-frisco'
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
  is_recurring: boolean
  recurrence_label: string | null
  thumbnail_url: string | null
  event_url: string
  category: EventCategory | null
  registration_required: boolean
  // Play Frisco LLM age inference (null for structured library sources)
  kid_relevant: boolean | null
  age_buckets: AgeBucket[] | null
  age_confidence: AgeConfidence | null
  age_reasoning: string | null
  // Play Frisco price inference (v1.2). Raw source of truth for the free-by-default policy;
  // null for structured library sources (which are hardcoded is_free = true).
  // price_confidence: 'confirmed' = explicit signal in text; 'inferred' = free-by-default.
  price_class: PriceClass | null
  price_confidence: PriceConfidence | null
  price_reasoning: string | null
  ingested_at: string
  created_at: string
}

export type AgeBucket = 'toddler' | 'kids' | 'teen' | 'family'
export type AgeConfidence = 'high' | 'medium' | 'low'
export type PriceClass = 'free' | 'paid' | 'unknown'
// 'confirmed' = an explicit price signal was found in the text (paid, or an explicit
// free statement). 'inferred' = free-by-default (no signal) — rendered as "Free ✦".
export type PriceConfidence = 'confirmed' | 'inferred'

export interface AgeInference {
  kid_relevant: boolean
  age_buckets: AgeBucket[]
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
