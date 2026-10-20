import { parseEventJsonLd, parseCadence, parseListedDates, weeklyOccurrences, centralDateTimeToUtc } from './kaleidoscope-parse'
import { saturyay, liveAfter5, concertSeries, shopLocal, oneOff, notAnEvent } from './__fixtures__/kaleidoscope-pages'

const ct = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })

describe('parseEventJsonLd', () => {
  test('reads the confirmed occurrence off a real page', () => {
    const e = parseEventJsonLd(saturyay)!
    expect(e.name).toBe('SaturYAY! Presented by Atmos Energy')
    expect(e.startIso).toBe('2026-10-24T15:00:00.000Z')
    expect(e.isFree).toBe(true)
    expect(e.locationName).toMatch(/Performance Lawn/)
    expect(e.address).toMatch(/6635 Warren Parkway/)
  })

  // The rebuilt site publishes TRUE UTC. The old WordPress did not (its timezone was
  // misconfigured as UTC+5), which is why the old connector read wall-clock time. Reading
  // this instant that way would move every event 5 hours.
  test('the instant is taken as given — 15:00Z is 10 AM Central, not 10 AM UTC', () => {
    expect(ct(parseEventJsonLd(saturyay)!.startIso)).toMatch(/10:00 AM/)
    expect(ct(parseEventJsonLd(liveAfter5)!.startIso)).toMatch(/5:30 PM/)
  })

  test('a page that is not an event has no Event JSON-LD', () => {
    expect(parseEventJsonLd(notAnEvent)).toBeNull()
  })
})

describe('parseCadence', () => {
  test.each([
    [saturyay, 'Every Saturday'],
    [liveAfter5, 'Every Thursday'],
    [concertSeries, 'First Saturday of every month'],
    [shopLocal, 'Select dates'],
  ])('reads the cadence sentence', (html, expected) => {
    expect(parseCadence(html as string)).toBe(expected)
  })
})

describe('centralDateTimeToUtc — the DST rule', () => {
  // 5:30 PM Central is a different instant either side of 1 November 2026. Copying the
  // confirmed occurrence's instant forward would publish November dates an hour early.
  test('the same wall time maps to different instants across the DST boundary', () => {
    expect(centralDateTimeToUtc(2026, 10, 22, 17, 30).toISOString()).toBe('2026-10-22T22:30:00.000Z')
    expect(centralDateTimeToUtc(2026, 11, 5, 17, 30).toISOString()).toBe('2026-11-05T23:30:00.000Z')
  })
})

describe('parseListedDates — transcribing published dates', () => {
  test('Live After 5: the performer lineup yields every Thursday in the run', () => {
    const e = parseEventJsonLd(liveAfter5)!
    const { dates, rejected } = parseListedDates(liveAfter5, e.startIso)
    expect(rejected).toBeUndefined()
    expect(dates.length).toBeGreaterThanOrEqual(4)
    // every transcribed date is a Thursday at 5:30 PM Central — including after the DST change
    for (const d of dates) expect(ct(d)).toMatch(/5:30 PM/)
    expect(dates.some(d => d.startsWith('2026-11'))).toBe(true)
    expect(dates).not.toContain(e.startIso)
  })

  test('the concert series list skips July and August — a cadence rule would have invented them', () => {
    const e = parseEventJsonLd(concertSeries)!
    const { dates } = parseListedDates(concertSeries, e.startIso)
    const months = new Set([...dates, e.startIso].map(d => d.slice(5, 7)))
    expect(months.has('07')).toBe(false)
    expect(months.has('08')).toBe(false)
  })

  test('Shop Local publishes explicit dates despite a "Select dates" cadence', () => {
    const e = parseEventJsonLd(shopLocal)!
    expect(parseListedDates(shopLocal, e.startIso).rejected).toBeUndefined()
  })

  test('a one-off page yields no extra dates', () => {
    const e = parseEventJsonLd(oneOff)!
    expect(parseListedDates(oneOff, e.startIso).dates).toEqual([])
  })

  // The checksum: the confirmed date must appear in whatever we read out of the prose.
  test('a list that omits the confirmed occurrence is rejected whole', () => {
    const e = parseEventJsonLd(liveAfter5)!
    const reformatted = liveAfter5.replace(/October 22/g, 'Octobre 22')
    const { dates, rejected } = parseListedDates(reformatted, e.startIso)
    expect(dates).toEqual([])
    expect(rejected).toMatch(/did not include the confirmed occurrence/)
  })

  // A date that falls on no candidate year's series weekday is not an occurrence — copy
  // mentioning an unrelated day should be skipped, not published.
  test('a date that is not on the series weekday is skipped, and the rest still parse', () => {
    const e = parseEventJsonLd(liveAfter5)!
    const tampered = liveAfter5.replace('September 10:', 'September 11:') // a Friday
    const { dates, rejected } = parseListedDates(tampered, e.startIso)
    expect(rejected).toBeUndefined()
    expect(dates.length).toBeGreaterThanOrEqual(4)
  })
})

describe('weeklyOccurrences — inferred, for a page with a rule and no list', () => {
  const e = () => parseEventJsonLd(saturyay)!

  test('SaturYAY: eight Saturdays at 10 AM Central, none of them the confirmed one', () => {
    const occ = weeklyOccurrences(e().startIso, parseCadence(saturyay))
    expect(occ).toHaveLength(8)
    expect(occ).not.toContain(e().startIso)
    for (const d of occ) expect(ct(d)).toMatch(/10:00 AM/)
  })

  test('the DST boundary is crossed without drifting an hour', () => {
    const occ = weeklyOccurrences(e().startIso, 'Every Saturday', 4) // Oct 31, Nov 7, 14, 21
    expect(occ[0]).toBe('2026-10-31T15:00:00.000Z') // CDT
    expect(occ[1]).toBe('2026-11-07T16:00:00.000Z') // CST — same 10 AM, different instant
  })

  test('a non-weekly cadence infers nothing', () => {
    expect(weeklyOccurrences(e().startIso, 'First Saturday of every month')).toEqual([])
    expect(weeklyOccurrences(e().startIso, 'Select dates')).toEqual([])
    expect(weeklyOccurrences(e().startIso, null)).toEqual([])
  })
})
