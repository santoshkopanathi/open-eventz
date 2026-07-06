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
  is_free: boolean
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
  ingested_at: string
  created_at: string
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
