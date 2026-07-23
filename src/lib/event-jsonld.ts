import type { Event, AgeBucket } from './types'
import { eventUrl, sourceOrg } from './site'

// ===========================================================================
// schema.org/Event JSON-LD — the single highest-leverage SEO surface for this
// product. Google reads this to render Event rich results (date, place, price)
// directly in Search. Pure + typed so it is unit-testable and never diverges
// from what the event page visibly renders.
//
// Price policy (product decision, 2026-07-23): emit the free signal whenever the
// app treats the event as free — BOTH institutionally-confirmed free (libraries)
// AND inferred "Free ✦" (Play Frisco free-by-default), i.e. whenever is_free === true.
// The event page visibly shows that same "Free" badge, so the markup matches the
// visible page (Google's structured-data policy requirement). Paid events carry no
// numeric price in our data, so we assert isAccessibleForFree: false without an
// `offers` block (an Offer without a price is invalid). Unknown price → omit entirely.
// ===========================================================================

// Strip HTML/markup and collapse whitespace so `description` is clean plain text.
// (Descriptions are already mostly plain, but library feeds occasionally carry tags.)
function plainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const BUCKET_RANGE: Record<AgeBucket, [number, number]> = {
  toddler: [0, 5],
  kids: [6, 12],
  teen: [13, 17],
  family: [0, 17],
}

// schema.org `typicalAgeRange` is a free-text hint ("0-12", "13-"). Derive from
// structured ages when present, else from inferred age buckets.
function typicalAgeRange(event: Event): string | null {
  if (event.age_min != null && event.age_max != null) {
    return `${event.age_min}-${event.age_max}`
  }
  const buckets = event.age_buckets ?? []
  const ranges = buckets.map(b => BUCKET_RANGE[b]).filter(Boolean)
  if (ranges.length === 0) return null
  const min = Math.min(...ranges.map(r => r[0]))
  const max = Math.max(...ranges.map(r => r[1]))
  return `${min}-${max}`
}

export type JsonLd = Record<string, unknown>

/**
 * Build the schema.org/Event JSON-LD object for an event. Returns a plain object
 * ready to `JSON.stringify` into a `<script type="application/ld+json">`.
 */
export function buildEventJsonLd(event: Event): JsonLd {
  const url = eventUrl(event.id)
  const org = sourceOrg(event.source)

  const jsonLd: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: event.start_datetime,
    // All ingested events are in-person, on-schedule library / parks programs.
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    url,
    organizer: {
      '@type': 'Organization',
      name: org.name,
      url: org.url,
    },
  }

  if (event.end_datetime) jsonLd.endDate = event.end_datetime

  if (event.description) {
    const desc = plainText(event.description)
    if (desc) jsonLd.description = desc
  }

  if (event.thumbnail_url) jsonLd.image = [event.thumbnail_url]

  // location — required for Event rich results. Emit only when we have a place name.
  if (event.location_name) {
    const place: JsonLd = {
      '@type': 'Place',
      name: event.location_name,
      address: event.location_address ?? event.location_name,
    }
    if (event.location_lat != null && event.location_lng != null) {
      place.geo = {
        '@type': 'GeoCoordinates',
        latitude: event.location_lat,
        longitude: event.location_lng,
      }
    }
    jsonLd.location = place
  }

  // Price — see the policy note at the top of the file.
  if (event.is_free === true) {
    jsonLd.isAccessibleForFree = true
    jsonLd.offers = {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url,
    }
  } else if (event.is_free === false) {
    jsonLd.isAccessibleForFree = false
  }

  const ageRange = typicalAgeRange(event)
  if (ageRange) jsonLd.typicalAgeRange = ageRange

  return jsonLd
}
