import { centralWallTimeToUtc, parseCentralWallTime } from './datetime'

describe('centralWallTimeToUtc', () => {
  const iso = (s: string) => centralWallTimeToUtc(s)?.toISOString()

  test('CDT (summer, UTC-5): 5:30 PM Sep 3 → 22:30 UTC', () => {
    expect(iso('2026-09-03 17:30:00')).toBe('2026-09-03T22:30:00.000Z')
  })

  test('CST (winter, UTC-6): 6:00 PM Nov 20 → next-day 00:00 UTC (DST boundary handled)', () => {
    expect(iso('2026-11-20 18:00:00')).toBe('2026-11-21T00:00:00.000Z')
  })

  test('morning CDT: 10:00 AM Sep 5 → 15:00 UTC', () => {
    expect(iso('2026-09-05 10:00:00')).toBe('2026-09-05T15:00:00.000Z')
  })

  test('accepts a T separator and missing seconds', () => {
    expect(iso('2026-09-05T10:00')).toBe('2026-09-05T15:00:00.000Z')
  })

  test('round-trips back to the same Central wall time', () => {
    const d = centralWallTimeToUtc('2026-09-03 17:30:00')!
    const back = d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit' })
    expect(back).toBe('17:30')
  })

  test('invalid input → null', () => {
    expect(centralWallTimeToUtc('')).toBeNull()
    expect(centralWallTimeToUtc('not a date')).toBeNull()
  })
})

// The regression these guard: ingest used a bare `new Date(str)` on offset-less source strings,
// which resolves in the RUNTIME's timezone — correct on a Central dev machine, 5–6h early on the
// UTC GitHub Actions runner that does the nightly ingest. Prod showed 5:00 AM story times.
// Each case below is a VERBATIM string from the source it names.
describe('parseCentralWallTime — real source formats, resolved as America/Chicago', () => {
  const iso = (s: string) => parseCentralWallTime(s)?.toISOString()

  test('Frisco Library card date+time ("August 14, 2026 10:00 AM") → 15:00 UTC, not 10:00', () => {
    expect(iso('August 14, 2026 10:00 AM')).toBe('2026-08-14T15:00:00.000Z')
  })

  test('Frisco Library abbreviated month ("Aug 18, 2026 11:00 AM")', () => {
    expect(iso('Aug 18, 2026 11:00 AM')).toBe('2026-08-18T16:00:00.000Z')
  })

  test('Plano RSS pubDate — the bogus +0000 offset is ignored, time read as local', () => {
    // Feed publishes a 9:30 AM storytime as "09:30:00 +0000". Trusting that offset would put
    // the event at 4:30 AM Central.
    expect(iso('Mon, 17 Aug 2026 09:30:00 +0000')).toBe('2026-08-17T14:30:00.000Z')
  })

  test('Play Frisco CivicPlus itemprop startDate ("2026-08-15T08:00:00")', () => {
    expect(iso('2026-08-15T08:00:00')).toBe('2026-08-15T13:00:00.000Z')
  })

  test('12-hour edge cases: noon stays 12, midnight wraps to 00', () => {
    expect(iso('August 14, 2026 12:00 PM')).toBe('2026-08-14T17:00:00.000Z')
    expect(iso('August 14, 2026 12:30 AM')).toBe('2026-08-14T05:30:00.000Z')
  })

  test('CST (winter) events shift by 6h, not 5h', () => {
    expect(iso('December 5, 2026 10:00 AM')).toBe('2026-12-05T16:00:00.000Z')
    expect(iso('Sat, 05 Dec 2026 10:00:00 +0000')).toBe('2026-12-05T16:00:00.000Z')
  })

  test('date with no time → midnight Central', () => {
    expect(iso('August 14, 2026')).toBe('2026-08-14T05:00:00.000Z')
    expect(iso('2026-08-14')).toBe('2026-08-14T05:00:00.000Z')
  })

  test('unparseable input → null (event is skipped, never stored at a guessed time)', () => {
    expect(parseCentralWallTime('')).toBeNull()
    expect(parseCentralWallTime('TBD')).toBeNull()
    expect(parseCentralWallTime('Smarch 40, 2026')).toBeNull()
  })

  test('result is independent of the machine timezone (the actual bug)', () => {
    // Same assertion the UTC runner must satisfy: a 10 AM Central event is 15:00Z, full stop.
    const d = parseCentralWallTime('August 14, 2026 10:00 AM')!
    expect(d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit' }))
      .toBe('10:00')
  })
})
