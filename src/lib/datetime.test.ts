import { centralWallTimeToUtc } from './datetime'

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
