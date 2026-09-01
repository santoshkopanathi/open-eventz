import type { Event } from './types'
import { passesAgeFilter, rangesOverlap } from './age-filter'

function ev(p: Partial<Event>): Event {
  return {
    id: 'e1', source: 'frisco-library', title: 'Event', description: null,
    start_datetime: '2026-07-15T15:00:00Z', end_datetime: null,
    location_name: null, location_address: null, location_lat: null, location_lng: null,
    is_free: true, price_text: null, age_min: null, age_max: null, age_label: null,
    is_recurring: false, recurrence_label: null, thumbnail_url: null, event_url: '',
    category: null, registration_required: false,
    kid_relevant: null, kid_confidence: null, age_buckets: null, age_basis: null, age_confidence: null, age_reasoning: null,
    price_class: null, price_confidence: null, price_reasoning: null,
    ingested_at: '', created_at: '',
    ...p,
  }
}

const TODDLER: [number, number] = [0, 5]
const KIDS: [number, number] = [6, 12]
const TEEN: [number, number] = [13, 17]

describe('rangesOverlap', () => {
  test('overlapping and non-overlapping', () => {
    expect(rangesOverlap(6, 12, 0, 5)).toBe(false)
    expect(rangesOverlap(0, 17, 6, 12)).toBe(true)
    expect(rangesOverlap(13, 17, 13, 17)).toBe(true)
  })
})

describe('passesAgeFilter — library (structured overlap)', () => {
  test('kids event matches Kids chip, not Toddlers', () => {
    const e = ev({ source: 'plano-library', age_min: 6, age_max: 12 })
    expect(passesAgeFilter(e, [KIDS])).toBe(true)
    expect(passesAgeFilter(e, [TODDLER])).toBe(false)
  })

  test('all-ages (0–17) event matches every chip', () => {
    const e = ev({ source: 'plano-library', age_min: 0, age_max: 17 })
    expect(passesAgeFilter(e, [TODDLER])).toBe(true)
    expect(passesAgeFilter(e, [KIDS])).toBe(true)
    expect(passesAgeFilter(e, [TEEN])).toBe(true)
  })

  test('event with no age data is excluded', () => {
    expect(passesAgeFilter(ev({ source: 'frisco-library' }), [KIDS])).toBe(false)
  })

  test('multi-select OR: Toddlers + Teens includes 0–5 and 13–17, excludes kids-only 6–12', () => {
    const ranges = [TODDLER, TEEN]
    expect(passesAgeFilter(ev({ source: 'plano-library', age_min: 0, age_max: 5 }), ranges)).toBe(true)
    expect(passesAgeFilter(ev({ source: 'plano-library', age_min: 13, age_max: 17 }), ranges)).toBe(true)
    expect(passesAgeFilter(ev({ source: 'plano-library', age_min: 6, age_max: 12 }), ranges)).toBe(false)
  })
})

describe('passesAgeFilter — Play Frisco (inferred buckets)', () => {
  const family = { source: 'play-frisco' as const, kid_relevant: true, age_confidence: 'high' as const, age_buckets: ['family' as const] }
  const teen = { source: 'play-frisco' as const, kid_relevant: true, age_confidence: 'medium' as const, age_buckets: ['teen' as const] }

  test('family bucket matches every chip', () => {
    expect(passesAgeFilter(ev(family), [TODDLER])).toBe(true)
    expect(passesAgeFilter(ev(family), [KIDS])).toBe(true)
    expect(passesAgeFilter(ev(family), [TEEN])).toBe(true)
  })

  test('teen bucket matches Teens only', () => {
    expect(passesAgeFilter(ev(teen), [TEEN])).toBe(true)
    expect(passesAgeFilter(ev(teen), [TODDLER])).toBe(false)
  })

  test('low confidence falls back to family, so it matches every chip (v1.3)', () => {
    // Used to be excluded. Uncertainty about WHICH ages now costs the age claim, not the
    // event — the same fallback the badge uses (effectiveAgeBuckets), shared so they cannot
    // drift: a card reading "Family" must appear under the toddler chip.
    expect(passesAgeFilter(ev({ ...family, age_confidence: 'low' }), [TODDLER])).toBe(true)
    expect(passesAgeFilter(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'low', age_buckets: ['teen'] }), [TODDLER])).toBe(true)
  })

  test('not kid-relevant excluded', () => {
    expect(passesAgeFilter(ev({ source: 'play-frisco', kid_relevant: false, age_confidence: 'high', age_buckets: [] }), [KIDS])).toBe(false)
  })

  test('no buckets falls back to family rather than vanishing (v1.3)', () => {
    expect(passesAgeFilter(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'high', age_buckets: [] }), [KIDS])).toBe(true)
  })

  test('Kaleidoscope is LLM-classified — it must not fall through to the structured branch', () => {
    // It did. Kaleidoscope has no age_min/age_max, so the structured branch returned false and
    // EVERY Kaleidoscope event disappeared the moment any age chip was active — all 106 of them.
    const kal = { source: 'kaleidoscope-park' as const, kid_relevant: true, age_confidence: 'high' as const, age_buckets: ['family' as const] }
    expect(passesAgeFilter(ev(kal), [TODDLER])).toBe(true)
    expect(passesAgeFilter(ev(kal), [KIDS])).toBe(true)
  })

  test('a not-kid-relevant Kaleidoscope event is still excluded', () => {
    expect(passesAgeFilter(ev({ source: 'kaleidoscope-park', kid_relevant: false, age_confidence: 'high', age_buckets: ['family'] }), [KIDS])).toBe(false)
  })
})
