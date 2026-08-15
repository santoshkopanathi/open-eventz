import type { Event } from './types'
import { hasImplausibleStart, detectUniformShift, screenBatch, DEFAULT_GUARD } from './ingest-guard'

function ev(over: Partial<Event>): Event {
  return {
    id: 'x', source: 'frisco-library', title: 'Family Story Time', description: null,
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

// A healthy stored set: 40 morning story times at 10:00 AM CDT (15:00Z).
const STORED = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, start_datetime: '2026-08-14T15:00:00Z' }))
const HEALTHY = Array.from({ length: 40 }, (_, i) => ev({ id: `e${i}`, start_datetime: '2026-08-14T15:00:00Z' }))

describe('hasImplausibleStart', () => {
  test('normal daytime event → publishable', () => {
    expect(hasImplausibleStart(ev({ start_datetime: '2026-08-14T15:00:00Z' }))).toBe(false) // 10 AM CT
  })
  test('evening event → publishable', () => {
    expect(hasImplausibleStart(ev({ start_datetime: '2026-11-21T00:00:00Z' }))).toBe(false) // 6 PM CST
  })
  test('5:00 AM CT (the incident) → NOT publishable', () => {
    expect(hasImplausibleStart(ev({ start_datetime: '2026-08-14T10:00:00Z' }))).toBe(true)
  })
  test('exact midnight = all-day marker → publishable', () => {
    expect(hasImplausibleStart(ev({ start_datetime: '2026-10-19T05:00:00Z' }))).toBe(false)
  })
  test('unparseable timestamp → NOT publishable (never guess)', () => {
    expect(hasImplausibleStart(ev({ start_datetime: 'not-a-date' }))).toBe(true)
  })
})

describe('detectUniformShift', () => {
  test('nothing moved → not systemic', () => {
    const v = detectUniformShift(HEALTHY, STORED)
    expect(v.moved).toBe(0)
    expect(v.systemic).toBe(false)
  })

  test('THE INCIDENT: every event moves by exactly -300 min → systemic', () => {
    // What the first UTC-runner nightly did: 10:00 AM CDT (15:00Z) stored as 10:00Z.
    const shifted = HEALTHY.map(e => ev({ ...e, start_datetime: '2026-08-14T10:00:00Z' }))
    const v = detectUniformShift(shifted, STORED)
    expect(v.dominantOffsetMin).toBe(-300)
    expect(v.agreement).toBe(1)
    expect(v.systemic).toBe(true)
  })

  test('a DST-sized 1-hour shift is caught too (not just the 5h one we hit)', () => {
    const shifted = HEALTHY.map(e => ev({ ...e, start_datetime: '2026-08-14T16:00:00Z' }))
    expect(detectUniformShift(shifted, STORED).systemic).toBe(true)
  })

  test('a few genuine reschedules are NOT systemic', () => {
    const rescheduled = HEALTHY.map((e, i) =>
      i < 5 ? ev({ ...e, start_datetime: '2026-08-14T18:00:00Z' }) : e)
    const v = detectUniformShift(rescheduled, STORED)
    expect(v.moved).toBe(5)
    expect(v.systemic).toBe(false) // 5/40 agreement is well under 80%
  })

  test('small clock jitter under the minimum is ignored', () => {
    const jittered = HEALTHY.map(e => ev({ ...e, start_datetime: '2026-08-14T15:10:00Z' }))
    expect(detectUniformShift(jittered, STORED).systemic).toBe(false) // 10 min < 30 min floor
  })

  test('too little overlap to judge → not systemic (a brand-new source)', () => {
    const v = detectUniformShift(HEALTHY.slice(0, 3), STORED.slice(0, 3))
    expect(v.overlap).toBe(3)
    expect(v.systemic).toBe(false)
  })
})

describe('screenBatch — the pre-write decision', () => {
  test('healthy batch → everything written', () => {
    const d = screenBatch(HEALTHY, STORED)
    expect(d.abort).toBe(false)
    expect(d.write).toHaveLength(40)
    expect(d.dropped).toHaveLength(0)
  })

  test('THE INCIDENT: whole batch rejected, stored rows survive', () => {
    const shifted = HEALTHY.map(e => ev({ ...e, start_datetime: '2026-08-14T10:00:00Z' }))
    const d = screenBatch(shifted, STORED)
    expect(d.abort).toBe(true)
    expect(d.write).toHaveLength(0) // nothing written → the good rows stay
    expect(d.reasons.join(' ')).toMatch(/ABORT/)
  })

  test('a shifted batch that still lands at plausible hours is ALSO rejected', () => {
    // 10 AM → 3 PM. Every time looks reasonable; only the uniform shift betrays it.
    const shifted = HEALTHY.map(e => ev({ ...e, start_datetime: '2026-08-14T20:00:00Z' }))
    const d = screenBatch(shifted, STORED)
    expect(d.abort).toBe(true)
    expect(d.reasons.join(' ')).toMatch(/clock\/timezone bug/)
  })

  test('a few bad events are dropped, the good ones still publish', () => {
    const mixed = [
      ...HEALTHY,
      ev({ id: 'bad1', title: 'Broken Time', start_datetime: '2026-08-14T10:00:00Z' }), // 5 AM CT
    ]
    const d = screenBatch(mixed, STORED)
    expect(d.abort).toBe(false)
    expect(d.dropped).toHaveLength(1)
    expect(d.write).toHaveLength(40)
    expect(d.write.find(e => e.id === 'bad1')).toBeUndefined()
  })

  test('too many bad events → reject the batch rather than publish a fraction', () => {
    const mostlyBad = Array.from({ length: 40 }, (_, i) =>
      ev({ id: `e${i}`, start_datetime: i < 30 ? '2026-08-14T10:00:00Z' : '2026-08-14T15:00:00Z' }))
    const d = screenBatch(mostlyBad, STORED)
    expect(d.abort).toBe(true)
    expect(d.write).toHaveLength(0)
  })

  test('a partial scrape does not shrink the source', () => {
    const d = screenBatch(HEALTHY.slice(0, 5), STORED)
    expect(d.abort).toBe(true)
    expect(d.reasons.join(' ')).toMatch(/partial scrape/)
  })

  test('INGEST_ALLOW_TIME_SHIFT lets an INTENDED correction through', () => {
    // The re-ingest that fixes a timezone bug is supposed to move everything at once.
    // Without this hatch the guard would block its own repair.
    const corrected = HEALTHY.map(e => ev({ ...e, start_datetime: '2026-08-14T15:00:00Z' }))
    const stored5hEarly = STORED.map(s => ({ ...s, start_datetime: '2026-08-14T10:00:00Z' }))
    const blocked = screenBatch(corrected, stored5hEarly)
    expect(blocked.abort).toBe(true)

    const allowed = screenBatch(corrected, stored5hEarly, { allowTimeShift: true })
    expect(allowed.abort).toBe(false)
    expect(allowed.write).toHaveLength(40)
    expect(allowed.reasons.join(' ')).toMatch(/ALLOWED by INGEST_ALLOW_TIME_SHIFT/)
  })

  test('first run of a brand-new source writes normally (nothing stored yet)', () => {
    const d = screenBatch(HEALTHY, [])
    expect(d.abort).toBe(false)
    expect(d.write).toHaveLength(40)
  })

  test('an empty scrape against a populated source aborts — it is a total shrink', () => {
    // A source that returns nothing is a failed scrape, not "every event was cancelled".
    // Aborting keeps the stored rows; the runner also skips its purge step on abort.
    const d = screenBatch([], STORED)
    expect(d.write).toHaveLength(0)
    expect(d.abort).toBe(true)
    expect(d.reasons.join(' ')).toMatch(/partial scrape/)
  })

  test('thresholds are the documented defaults', () => {
    expect(DEFAULT_GUARD.minShiftAgreement).toBe(0.8)
    expect(DEFAULT_GUARD.minOverlapForShift).toBe(20)
  })
})
