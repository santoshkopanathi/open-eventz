import { isIndexableEvent, startOfTodayCtIso } from './seo-indexable'
import type { Event } from './types'

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1',
    source: 'frisco-library',
    title: 'Toddler Storytime',
    description: null,
    start_datetime: '2026-08-01T15:00:00Z',
    end_datetime: null,
    location_name: 'Frisco Public Library',
    location_address: null,
    location_lat: null,
    location_lng: null,
    is_free: true,
    price_text: 'Free',
    age_min: 0,
    age_max: 5,
    age_label: null,
    is_recurring: false,
    recurrence_label: null,
    thumbnail_url: null,
    event_url: 'https://example.com/e',
    category: 'library',
    registration_required: false,
    kid_relevant: null,
    age_buckets: null,
    age_confidence: null,
    age_reasoning: null,
    price_class: null,
    price_confidence: null,
    price_reasoning: null,
    ingested_at: '2026-07-20T00:00:00Z',
    created_at: '2026-07-20T00:00:00Z',
    ...overrides,
  }
}

// A fixed "today" so the past/future checks are deterministic.
const TODAY = '2026-07-25T05:00:00.000Z'

describe('isIndexableEvent', () => {
  test('upcoming kid event is indexable', () => {
    expect(isIndexableEvent(makeEvent({ start_datetime: '2026-08-01T15:00:00Z' }), TODAY)).toBe(true)
  })

  test('past one-off event is not indexable', () => {
    expect(isIndexableEvent(makeEvent({ start_datetime: '2026-07-01T15:00:00Z', end_datetime: null }), TODAY)).toBe(false)
  })

  test('multi-day event still running is indexable', () => {
    expect(
      isIndexableEvent(makeEvent({ start_datetime: '2026-07-01T15:00:00Z', end_datetime: '2026-08-10T00:00:00Z' }), TODAY)
    ).toBe(true)
  })

  test('Play Frisco event judged not kid-relevant is excluded', () => {
    expect(isIndexableEvent(makeEvent({ source: 'play-frisco', kid_relevant: false }), TODAY)).toBe(false)
  })

  test('adults-only program (age_min >= 18) is excluded', () => {
    expect(isIndexableEvent(makeEvent({ age_min: 18, age_max: 99 }), TODAY)).toBe(false)
  })

  test('mislabeled Frisco adult program (book club) is excluded', () => {
    expect(isIndexableEvent(makeEvent({ title: 'Evening Book Club' }), TODAY)).toBe(false)
  })

  test('Play Frisco with no kid_relevant flag set is not blocked by the adult-keyword rule', () => {
    // The book-club keyword rule is Frisco-Library-only.
    expect(isIndexableEvent(makeEvent({ source: 'play-frisco', title: 'Family Book Club', kid_relevant: true }), TODAY)).toBe(true)
  })
})

describe('startOfTodayCtIso', () => {
  test('returns midnight CT (05:00 UTC) for an afternoon-UTC now', () => {
    expect(startOfTodayCtIso(new Date('2026-07-25T18:00:00Z'))).toBe('2026-07-25T05:00:00.000Z')
  })

  test('rolls back a day before 05:00 UTC (still previous CT day)', () => {
    expect(startOfTodayCtIso(new Date('2026-07-25T02:00:00Z'))).toBe('2026-07-24T05:00:00.000Z')
  })
})
