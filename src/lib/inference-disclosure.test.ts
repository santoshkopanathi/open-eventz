import type { Event, AgeBucket } from './types'
import { inferenceDisclosure } from './inference-disclosure'

// Event factory — fills every required field; override what a test cares about.
function ev(p: Partial<Event>): Event {
  return {
    id: 'e1', source: 'play-frisco', title: 'Event', description: null,
    start_datetime: '2026-08-01T15:00:00Z', end_datetime: null,
    location_name: null, location_address: null, location_lat: null, location_lng: null,
    is_free: null, price_text: null, age_min: null, age_max: null, age_label: null,
    is_recurring: false, recurrence_label: null, thumbnail_url: null, event_url: '',
    category: null, registration_required: false,
    kid_relevant: null, kid_confidence: null, age_buckets: null, age_basis: null, age_confidence: null, age_reasoning: null,
    price_class: null, price_confidence: null, price_reasoning: null,
    ingested_at: '', created_at: '',
    ...p,
  }
}

// Play Frisco helpers — inferred age (family/specific) and inferred price (free/paid)
const familyAge = { kid_relevant: true, age_confidence: 'high' as const, age_buckets: ['family'] as AgeBucket[] }
const specificAge = { kid_relevant: true, age_confidence: 'high' as const, age_buckets: ['teen'] as AgeBucket[] }
const freePrice = { price_class: 'free' as const, is_free: true }
const paidPrice = { price_class: 'paid' as const, is_free: false }

describe('inferenceDisclosure — the 8 combined scenarios (Definition A)', () => {
  test('Age range inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...specificAge })))
      .toBe('Age suitability estimated from event description')
  })
  test('Family inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...familyAge })))
      .toBe('Family suitability estimated from event description')
  })
  test('Free inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...freePrice })))
      .toBe("'Free' admission status estimated from event description")
  })
  test('Paid inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...paidPrice })))
      .toBe("'Paid' admission status estimated from event description")
  })
  test('Age + Free inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...specificAge, ...freePrice })))
      .toBe("Age suitability and 'Free' admission status estimated from event description")
  })
  test('Age + Paid inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...specificAge, ...paidPrice })))
      .toBe("Age suitability and 'Paid' admission status estimated from event description")
  })
  test('Family + Free inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...familyAge, ...freePrice })))
      .toBe("Family suitability and 'Free' admission status estimated from event description")
  })
  test('Family + Paid inferred', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', ...familyAge, ...paidPrice })))
      .toBe("Family suitability and 'Paid' admission status estimated from event description")
  })
})

describe('inferenceDisclosure — nothing to disclose → null', () => {
  test('library event (confirmed age + institutional free) → null', () => {
    expect(inferenceDisclosure(ev({ source: 'frisco-library', age_min: 0, age_max: 5, is_free: true }))).toBeNull()
  })
  test('Play Frisco with price unknown and no age badge → null', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', price_class: 'unknown' }))).toBeNull()
  })
  test('Play Frisco stated age + unknown price → null (nothing was estimated)', () => {
    expect(inferenceDisclosure(ev({ source: 'play-frisco', kid_relevant: true, age_basis: 'stated', age_confidence: 'high', age_buckets: ['teen'], price_class: 'unknown' }))).toBeNull()
  })

  test('v1.3: a low-confidence age now DOES disclose — it falls back to Family, which is an estimate', () => {
    // Previously this returned null because low confidence produced no badge at all. The event
    // was usually already deleted upstream by the same score. Now it stays, shows Family ✦, and
    // says so.
    expect(inferenceDisclosure(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'low', age_buckets: ['family'], price_class: 'unknown' })))
      .toBe('Family suitability estimated from event description')
  })
})
