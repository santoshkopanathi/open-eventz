import type { Event } from './types'
import { dominantAgeBucketShare, adultTitleLeaks, ageFilterNarrowShare, friscoAgeChecks } from './data-quality'

function ev(over: Partial<Event>): Event {
  return {
    id: 'x', source: 'frisco-library', title: 'Event', description: null,
    start_datetime: '2026-08-14T15:00:00Z', end_datetime: null,
    location_name: null, location_address: null, location_lat: null, location_lng: null,
    is_free: true, price_text: 'Free', age_min: 0, age_max: 5, age_label: null,
    is_recurring: false, recurrence_label: null, thumbnail_url: null, event_url: 'https://x',
    category: 'library', registration_required: false,
    kid_relevant: null, age_buckets: null, age_confidence: null, age_reasoning: null,
    price_class: null, price_confidence: null, price_reasoning: null,
    ingested_at: '', created_at: '',
    ...over,
  } as Event
}

// A healthy Frisco set: varied ages, no adult leaks, toddler filter narrows.
const HEALTHY: Event[] = [
  ...Array.from({ length: 20 }, (_, i) => ev({ id: `t${i}`, title: 'Story Time', age_min: 0, age_max: 5 })),
  ...Array.from({ length: 15 }, (_, i) => ev({ id: `k${i}`, title: 'Kids Craft', age_min: 6, age_max: 12 })),
  ...Array.from({ length: 10 }, (_, i) => ev({ id: `n${i}`, title: 'Teen Coding', age_min: 13, age_max: 17 })),
  ...Array.from({ length: 8 }, (_, i) => ev({ id: `a${i}`, title: 'Adult Book Club', age_min: 18, age_max: 99 })),
]

// The incident: every event collapsed to 0–17, adult titles stored kid-visible.
const BROKEN: Event[] = Array.from({ length: 50 }, (_, i) =>
  ev({ id: `b${i}`, title: i === 0 ? 'D&D for Adults' : 'Family Story Time', age_min: 0, age_max: 17 }))

describe('dominantAgeBucketShare', () => {
  test('broken set → ~1.0 in the 0-17 bucket', () => {
    const r = dominantAgeBucketShare(BROKEN)
    expect(r.bucket).toBe('0-17')
    expect(r.share).toBeCloseTo(1, 1)
  })
  test('healthy set → no single bucket dominates', () => {
    expect(dominantAgeBucketShare(HEALTHY).share).toBeLessThan(0.85)
  })
})

describe('adultTitleLeaks', () => {
  test('flags "D&D for Adults" stored as 0–17', () => {
    const leaks = adultTitleLeaks(BROKEN)
    expect(leaks.length).toBe(1)
    expect(leaks[0].title).toBe('D&D for Adults')
  })
  test('does not flag adult events correctly stored 18+', () => {
    expect(adultTitleLeaks(HEALTHY)).toHaveLength(0)
  })
})

describe('ageFilterNarrowShare', () => {
  test('broken set → Toddlers matches ~everything (no-op)', () => {
    expect(ageFilterNarrowShare(BROKEN)).toBeGreaterThan(0.9)
  })
  test('healthy set → Toddlers matches a minority', () => {
    expect(ageFilterNarrowShare(HEALTHY)).toBeLessThan(0.9)
  })
})

describe('friscoAgeChecks', () => {
  test('healthy data → all checks pass', () => {
    expect(friscoAgeChecks(HEALTHY).every(c => c.pass)).toBe(true)
  })
  test('the incident → variety, leak, and narrow checks all fail', () => {
    const checks = friscoAgeChecks(BROKEN)
    const byName = Object.fromEntries(checks.map(c => [c.name, c.pass]))
    expect(byName['frisco: age variety']).toBe(false)
    expect(byName['frisco: no adult-title leaks']).toBe(false)
    expect(byName['frisco: toddler filter narrows']).toBe(false)
  })
})
