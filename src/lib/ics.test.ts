import { buildIcs, icsFilename } from './ics'
import type { Event } from './types'

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'play-frisco-7348',
    source: 'play-frisco',
    title: 'Play For All Sensory Swim',
    description: 'Splash time for all abilities.',
    start_datetime: '2026-07-24T15:00:00Z',
    end_datetime: '2026-07-24T16:30:00Z',
    location_name: 'Frisco Athletic Center',
    location_address: '5828 Nancy Jane Ln, Frisco, TX',
    location_lat: null,
    location_lng: null,
    is_free: false,
    price_text: 'Paid',
    age_min: null,
    age_max: null,
    age_label: null,
    is_recurring: true,
    recurrence_label: null,
    thumbnail_url: null,
    event_url: 'https://www.friscotexas.gov/Calendar.aspx?EID=7348',
    category: 'sports',
    registration_required: true,
    kid_relevant: true,
    age_buckets: ['family'],
    age_confidence: 'high',
    age_reasoning: null,
    price_class: 'paid',
    price_confidence: 'inferred',
    price_reasoning: null,
    ingested_at: '2026-07-20T00:00:00Z',
    created_at: '2026-07-20T00:00:00Z',
    ...overrides,
  }
}

const DTSTAMP = '2026-07-23T00:00:00Z'

describe('buildIcs', () => {
  const ics = buildIcs(makeEvent(), { dtstamp: DTSTAMP })

  test('is a well-formed VCALENDAR/VEVENT with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
  })

  test('carries UID, DTSTAMP, DTSTART, DTEND in ICS UTC form', () => {
    expect(ics).toContain('UID:play-frisco-7348@openeventz')
    expect(ics).toContain('DTSTAMP:20260723T000000Z')
    expect(ics).toContain('DTSTART:20260724T150000Z')
    expect(ics).toContain('DTEND:20260724T163000Z')
  })

  test('escapes commas in TEXT values (title, location) per RFC 5545', () => {
    // Location "Frisco Athletic Center, ... Frisco, TX" must escape its commas so the
    // field is not split into parameters.
    expect(ics).toContain('LOCATION:Frisco Athletic Center\\, 5828 Nancy Jane Ln\\, Frisco\\, TX')
    expect(ics).toContain('SUMMARY:Play For All Sensory Swim')
  })

  test('appends the event URL into the description', () => {
    expect(ics).toContain('DESCRIPTION:Splash time for all abilities.\\n\\nMore info: https://www.friscotexas.gov/Calendar.aspx?EID=7348')
  })

  test('when there is no end time, DTEND falls back to DTSTART', () => {
    const noEnd = buildIcs(makeEvent({ end_datetime: null }), { dtstamp: DTSTAMP })
    expect(noEnd).toContain('DTSTART:20260724T150000Z')
    expect(noEnd).toContain('DTEND:20260724T150000Z')
  })

  test('escapes a comma/semicolon in the title', () => {
    const tricky = buildIcs(makeEvent({ title: 'Storytime: songs, rhymes; fun' }), { dtstamp: DTSTAMP })
    expect(tricky).toContain('SUMMARY:Storytime: songs\\, rhymes\\; fun')
  })
})

describe('icsFilename', () => {
  test('slugifies the title to a safe .ics filename', () => {
    expect(icsFilename({ title: 'Play For All Sensory Swim' })).toBe('Play-For-All-Sensory-Swim.ics')
  })

  test('falls back to event.ics when the title has no alphanumerics', () => {
    expect(icsFilename({ title: '!!!' })).toBe('event.ics')
  })
})
