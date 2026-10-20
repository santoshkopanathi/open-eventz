import type { Event } from './types'
import { hasImplausibleStart, detectUniformShift, screenBatch, upcomingStored, purgeCandidates, DEFAULT_GUARD } from './ingest-guard'

function ev(over: Partial<Event>): Event {
  return {
    id: 'x', source: 'frisco-library', title: 'Family Story Time', description: null,
    start_datetime: '2026-08-14T15:00:00Z', end_datetime: null,
    location_name: null, location_address: null, location_lat: null, location_lng: null,
    is_free: true, price_text: 'Free', age_min: 0, age_max: 5, age_label: null,
    is_recurring: false, recurrence_label: null, thumbnail_url: null, event_url: 'https://x',
    category: 'library', registration_required: false,
    kid_relevant: null, kid_confidence: null, age_buckets: null, age_basis: null, age_confidence: null, age_reasoning: null,
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

// ---------------------------------------------------------------------------
// upcomingStored — the 2026-10-17 outage: past events accumulating in the
// denominator until a healthy scrape looked like a partial one.
// ---------------------------------------------------------------------------
describe('upcomingStored', () => {
  const NOW = '2026-10-19T05:00:00Z'
  const PAST = Array.from({ length: 357 }, (_, i) => ({ id: `p${i}`, start_datetime: '2026-07-01T15:00:00Z' }))
  const FUTURE = Array.from({ length: 168 }, (_, i) => ({ id: `f${i}`, start_datetime: '2026-11-01T15:00:00Z' }))

  test('keeps upcoming rows and drops past ones', () => {
    expect(upcomingStored([...PAST, ...FUTURE], NOW)).toHaveLength(168)
  })

  test('keeps rows starting exactly at the cutoff', () => {
    expect(upcomingStored([{ id: 'a', start_datetime: NOW }], NOW)).toHaveLength(1)
  })

  test('keeps unparseable rows — they are not evidence of shrinkage', () => {
    expect(upcomingStored([{ id: 'a', start_datetime: 'not-a-date' }], NOW)).toHaveLength(1)
  })

  test('an unparseable cutoff falls back to comparing against everything', () => {
    expect(upcomingStored([...PAST, ...FUTURE], 'nonsense')).toHaveLength(525)
  })

  // The incident itself, reproduced end to end: Frisco's real numbers from the three
  // nights the nightly run went red.
  test('REGRESSION: a healthy 210-event Frisco batch no longer aborts', () => {
    const batch = Array.from({ length: 210 }, (_, i) => ev({ id: `f${i}`, start_datetime: '2026-11-01T15:00:00Z' }))
    const storedAll = [...PAST, ...FUTURE] // 525 rows, 357 of them past

    // What the guard used to be given — and why it aborted.
    const before = screenBatch(batch, storedAll)
    expect(before.abort).toBe(true)
    expect(before.reasons.join(' ')).toMatch(/partial scrape/)

    // What it is given now.
    const after = screenBatch(batch, upcomingStored(storedAll, NOW))
    expect(after.abort).toBe(false)
    expect(after.write).toHaveLength(210)
  })

  // The guard must still catch a genuinely partial scrape — the fix narrows the
  // comparison, it does not disable the rule.
  test('a real partial scrape still aborts when compared on upcoming rows only', () => {
    const half = Array.from({ length: 50 }, (_, i) => ev({ id: `f${i}`, start_datetime: '2026-11-01T15:00:00Z' }))
    const d = screenBatch(half, upcomingStored([...PAST, ...FUTURE], NOW))
    expect(d.abort).toBe(true)
    expect(d.reasons.join(' ')).toMatch(/partial scrape/)
  })
})

// ---------------------------------------------------------------------------
// purgeCandidates — catching cancellations. Before 2026-10-20 the library
// sources had no purge at all, so a cancelled event stayed forever.
// ---------------------------------------------------------------------------
describe('purgeCandidates', () => {
  const upcoming = (n: number, prefix = 'e') =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, start_datetime: '2026-11-01T15:00:00Z' }))
  const batchOf = (ids: string[]) => ids.map(id => ev({ id }))

  test('a batch that still lists everything purges nothing', () => {
    const stored = upcoming(40)
    const d = purgeCandidates(stored, batchOf(stored.map(s => s.id)))
    expect(d.remove).toEqual([])
    expect(d.skipped).toBe(false)
  })

  // The incident: three Frisco "Teen Anime Club" sessions stayed in our data after the
  // library stopped listing them, one of them four days out.
  test('REGRESSION: events the source stopped listing are removed', () => {
    const stored = [...upcoming(163), { id: 'anime1', start_datetime: '2026-10-24T21:00:00Z' },
      { id: 'anime2', start_datetime: '2026-11-24T22:00:00Z' }, { id: 'anime3', start_datetime: '2026-12-19T22:00:00Z' }]
    const d = purgeCandidates(stored, batchOf(upcoming(163).map(s => s.id)))
    expect(d.remove).toEqual(['anime1', 'anime2', 'anime3'])
    expect(d.skipped).toBe(false)
  })

  test('a mass disappearance is reported, not executed', () => {
    const stored = upcoming(100)
    const d = purgeCandidates(stored, batchOf(upcoming(50).map(s => s.id))) // half gone
    expect(d.remove).toEqual([])
    expect(d.skipped).toBe(true)
    expect(d.reason).toMatch(/PURGE SKIPPED/)
  })

  test('exactly at the cap still purges; one more skips', () => {
    const atCap = purgeCandidates(upcoming(100), batchOf(upcoming(75).map(s => s.id)))
    expect(atCap.skipped).toBe(false)
    expect(atCap.remove).toHaveLength(25)
    const overCap = purgeCandidates(upcoming(100), batchOf(upcoming(74).map(s => s.id)))
    expect(overCap.skipped).toBe(true)
  })

  // An event the guard dropped for a bad time still EXISTS at the source. Refusing to publish
  // this version of it is not grounds for deleting the copy we already have.
  test('an event dropped for an unpublishable time is not treated as cancelled', () => {
    const stored = upcoming(40)
    const incoming = [...batchOf(stored.slice(0, 39).map(s => s.id)),
      ev({ id: 'e39', start_datetime: '2026-11-01T10:00:00Z' })] // 5 AM CT — dropped, not absent
    expect(purgeCandidates(stored, incoming).remove).toEqual([])
  })

  test('nothing stored → nothing to purge', () => {
    expect(purgeCandidates([], batchOf(['a']))).toEqual({ remove: [], skipped: false })
  })
})

// The purge scope is chosen by the caller: rows still ahead of *now*, not of midnight.
// Dry-running the first purge caught this — two Frisco story times that had finished that
// morning were absent from the listing and would have been deleted as "cancelled", while
// the source still served both of them.
describe('purge scope — events that already happened today', () => {
  const NOW = '2026-10-20T18:00:00Z' // 1 PM CT
  // Enough still-ahead rows that removing one stays well under the purge cap — this test is
  // about which rows are in scope, not about the cap.
  const ahead = Array.from({ length: 19 }, (_, i) => ({ id: `ahead${i}`, start_datetime: '2026-10-27T15:00:00Z' }))
  const stored = [
    { id: 'this-morning', start_datetime: '2026-10-20T15:00:00Z' }, // 10 AM CT — finished
    ...ahead,
    { id: 'cancelled', start_datetime: '2026-10-25T15:00:00Z' },
  ]

  test('an event that already started today is not a purge candidate', () => {
    const scope = upcomingStored(stored, NOW)
    expect(scope.map(s => s.id)).not.toContain('this-morning')
    expect(scope).toHaveLength(20)

    // The source lists everything still ahead except the cancelled one. The finished morning
    // event is absent from the batch too — and must not be mistaken for a cancellation.
    const d = purgeCandidates(scope, ahead.map(a => ev({ id: a.id })))
    expect(d.remove).toEqual(['cancelled'])
    expect(d.remove).not.toContain('this-morning')
  })

  test("the guard still compares from the start of today — a batch holds today's events", () => {
    expect(upcomingStored(stored, '2026-10-20T05:00:00Z')).toHaveLength(21)
  })
})
