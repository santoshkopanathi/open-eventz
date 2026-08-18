import { buildEventJsonLd } from './event-jsonld'
import { eventUrl } from './site'
import type { Event } from './types'

// Minimal Event factory — overrides on top of a free Frisco Library event.
function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1',
    source: 'frisco-library',
    title: 'Toddler Storytime',
    description: 'Songs and stories for little ones.',
    start_datetime: '2026-08-01T15:00:00Z',
    end_datetime: '2026-08-01T16:00:00Z',
    location_name: 'Frisco Public Library',
    location_address: '6101 Frisco Square Blvd, Frisco, TX 75034',
    location_lat: 33.15,
    location_lng: -96.82,
    is_free: true,
    price_text: 'Free',
    age_min: 0,
    age_max: 5,
    age_label: 'Ages 0–5',
    is_recurring: false,
    recurrence_label: null,
    thumbnail_url: null,
    event_url: 'https://www.friscolibrary.com/event/evt-1',
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

describe('buildEventJsonLd — core shape', () => {
  const jsonLd = buildEventJsonLd(makeEvent())

  test('is a schema.org Event', () => {
    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd['@type']).toBe('Event')
    expect(jsonLd.name).toBe('Toddler Storytime')
  })

  test('carries start/end and offline in-person status', () => {
    expect(jsonLd.startDate).toBe('2026-08-01T15:00:00Z')
    expect(jsonLd.endDate).toBe('2026-08-01T16:00:00Z')
    expect(jsonLd.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode')
    expect(jsonLd.eventStatus).toBe('https://schema.org/EventScheduled')
  })

  test('canonical url points at the event page, not the source', () => {
    expect(jsonLd.url).toBe(eventUrl('evt-1'))
  })

  test('location includes place, address and geo', () => {
    expect(jsonLd.location).toMatchObject({
      '@type': 'Place',
      name: 'Frisco Public Library',
      geo: { '@type': 'GeoCoordinates', latitude: 33.15, longitude: -96.82 },
    })
  })

  test('organizer reflects the source', () => {
    expect(jsonLd.organizer).toMatchObject({ '@type': 'Organization', name: 'Frisco Public Library' })
  })
})

describe('buildEventJsonLd — price policy (2026-07-23 decision)', () => {
  test('confirmed-free (library) → isAccessibleForFree true + $0 offer', () => {
    const jsonLd = buildEventJsonLd(makeEvent({ is_free: true }))
    expect(jsonLd.isAccessibleForFree).toBe(true)
    expect(jsonLd.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'USD' })
  })

  test('INFERRED-free (Play Frisco "Free ✦") still asserts free — the product decision', () => {
    const jsonLd = buildEventJsonLd(
      makeEvent({ source: 'play-frisco', is_free: true, price_class: 'free', price_confidence: 'inferred' })
    )
    expect(jsonLd.isAccessibleForFree).toBe(true)
    expect(jsonLd.offers).toMatchObject({ price: '0' })
  })

  test('paid → isAccessibleForFree false, no offers (no numeric price in our data)', () => {
    const jsonLd = buildEventJsonLd(makeEvent({ is_free: false, price_text: 'Paid' }))
    expect(jsonLd.isAccessibleForFree).toBe(false)
    expect(jsonLd.offers).toBeUndefined()
  })

  test('unknown price → omit price fields entirely', () => {
    const jsonLd = buildEventJsonLd(makeEvent({ is_free: null, price_text: null }))
    expect(jsonLd).not.toHaveProperty('isAccessibleForFree')
    expect(jsonLd).not.toHaveProperty('offers')
  })
})

describe('buildEventJsonLd — optional fields', () => {
  test('omits location when there is no place name', () => {
    const jsonLd = buildEventJsonLd(makeEvent({ location_name: null }))
    expect(jsonLd).not.toHaveProperty('location')
  })

  test('strips HTML from description', () => {
    const jsonLd = buildEventJsonLd(makeEvent({ description: '<p>Songs &amp; <b>stories</b></p>' }))
    expect(jsonLd.description).toBe('Songs &amp; stories')
  })

  test('typicalAgeRange from structured ages', () => {
    expect(buildEventJsonLd(makeEvent({ age_min: 0, age_max: 5 })).typicalAgeRange).toBe('0-5')
  })

  test('typicalAgeRange from inferred buckets when structured ages are absent', () => {
    const jsonLd = buildEventJsonLd(
      makeEvent({ source: 'play-frisco', age_min: null, age_max: null, age_buckets: ['toddler', 'kids'] })
    )
    expect(jsonLd.typicalAgeRange).toBe('0-12')
  })

  test('includes image when a thumbnail exists', () => {
    const jsonLd = buildEventJsonLd(makeEvent({ thumbnail_url: 'https://img.example/e.jpg' }))
    expect(jsonLd.image).toEqual(['https://img.example/e.jpg'])
  })
})
