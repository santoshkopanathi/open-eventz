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
    kid_relevant: null, age_buckets: null, age_confidence: null, age_reasoning: null,
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

  test('low confidence excluded even if buckets match', () => {
    expect(passesAgeFilter(ev({ ...family, age_confidence: 'low' }), [TODDLER])).toBe(false)
  })

  test('not kid-relevant excluded', () => {
    expect(passesAgeFilter(ev({ source: 'play-frisco', kid_relevant: false, age_confidence: 'high', age_buckets: [] }), [KIDS])).toBe(false)
  })

  test('no buckets excluded', () => {
    expect(passesAgeFilter(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'high', age_buckets: [] }), [KIDS])).toBe(false)
  })
})
