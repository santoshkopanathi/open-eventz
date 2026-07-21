import {
  computeFunnel,
  weeklyActiveDiscoverers,
  returnVisitRate,
  referral,
  topEvents,
  weekKey,
} from './measurement'
import { MEASUREMENT_FIXTURE, WEEK1, WEEK2 } from './__fixtures__/measurement-fixtures'

// ---------------------------------------------------------------------------
// weekKey — Monday-anchored bucketing
// ---------------------------------------------------------------------------
describe('weekKey', () => {
  test('anchors to the week Monday (UTC)', () => {
    expect(weekKey(Date.UTC(2026, 0, 5, 12))).toBe('2026-01-05') // Monday
    expect(weekKey(Date.UTC(2026, 0, 8, 12))).toBe('2026-01-05') // Thursday, same week
    expect(weekKey(Date.UTC(2026, 0, 11, 23))).toBe('2026-01-05') // Sunday, same week
    expect(weekKey(Date.UTC(2026, 0, 12, 0))).toBe('2026-01-12') // next Monday
  })
})

// ---------------------------------------------------------------------------
// Conversion funnel — cumulative "most advanced step reached"
// ---------------------------------------------------------------------------
describe('computeFunnel', () => {
  const f = computeFunnel(MEASUREMENT_FIXTURE)

  test('cumulative step counts', () => {
    expect(f.sessions).toBe(7)
    expect(f.engaged).toBe(5)
    expect(f.intent).toBe(4)
    expect(f.converted).toBe(3)
  })

  test('convert-without-intent (s4) still counts as converted, and cumulatively as intent', () => {
    // s4 converts via attending_tap with no detail_view/directions — must count anyway
    expect(f.converted).toBe(3)
    expect(f.intent).toBeGreaterThanOrEqual(f.converted)
  })

  test('step-to-step rates', () => {
    expect(f.engagedRate).toBeCloseTo(5 / 7)
    expect(f.intentRate).toBeCloseTo(4 / 5)
    expect(f.conversionRate).toBeCloseTo(3 / 4)
  })

  test('sub-metrics (session-level, % of the step)', () => {
    expect(f.subMetrics.detailView).toEqual({ count: 3, pctOfIntent: 3 / 4 })
    expect(f.subMetrics.directions).toEqual({ count: 1, pctOfIntent: 1 / 4 })
    expect(f.subMetrics.calendarAdd).toEqual({ count: 2, pctOfConverted: 2 / 3 })
    expect(f.subMetrics.attending).toEqual({ count: 1, pctOfConverted: 1 / 3 })
  })

  test('empty input → all zeros, no divide-by-zero', () => {
    const z = computeFunnel([])
    expect(z).toMatchObject({ sessions: 0, engaged: 0, intent: 0, converted: 0, engagedRate: 0, intentRate: 0, conversionRate: 0 })
  })
})

describe('computeFunnel — channel segmentation', () => {
  test('scoped to organic sessions only', () => {
    // organic sessions: s1(converted), s3(intent), s4(converted), s6(session-only)
    expect(computeFunnel(MEASUREMENT_FIXTURE, 'organic'))
      .toMatchObject({ sessions: 4, engaged: 3, intent: 3, converted: 2 })
  })
})

// ---------------------------------------------------------------------------
// North Star — Weekly Active Discoverers
// ---------------------------------------------------------------------------
describe('weeklyActiveDiscoverers', () => {
  test('unique converting visitors per week, once per visitor', () => {
    expect(weeklyActiveDiscoverers(MEASUREMENT_FIXTURE)).toEqual([
      { week: WEEK1, wad: 2 }, // v1 (calendar_add) + v4 (attending_tap)
      { week: WEEK2, wad: 1 }, // v6 (calendar_add)
    ])
  })
})

// ---------------------------------------------------------------------------
// Return visit rate
// ---------------------------------------------------------------------------
describe('returnVisitRate', () => {
  test('week-1 converters returning in week 2', () => {
    // converters W1 = {v1, v4}; active W2 = {v1, v6}; only v1 returned → 1/2
    expect(returnVisitRate(MEASUREMENT_FIXTURE, WEEK1)).toBeCloseTo(0.5)
  })
})

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------
describe('referral', () => {
  test('weekly share taps + % of converted sessions that also shared', () => {
    const r = referral(MEASUREMENT_FIXTURE)
    expect(r.weeklyShareTaps).toEqual([{ week: WEEK1, count: 1 }])
    // converted sessions = s1, s4, s7; only s4 shared → 1/3
    expect(r.pctOfConvertedSessionsShared).toBeCloseTo(1 / 3)
  })
})

// ---------------------------------------------------------------------------
// Top Events
// ---------------------------------------------------------------------------
describe('topEvents', () => {
  test('per-event tallies, sorted by attending desc', () => {
    expect(topEvents(MEASUREMENT_FIXTURE)).toEqual([
      { event_id: 'e1', attending: 1, calendarAdds: 1, directions: 1, shares: 1 },
      { event_id: 'e2', attending: 0, calendarAdds: 1, directions: 0, shares: 0 },
    ])
  })
})
