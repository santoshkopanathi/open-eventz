import type { AnalyticsRow } from '../measurement'

// Fabricated GA4-shaped event stream for the measurement framework (the analytics equivalent
// of the price calibration set). Every expectation derived from it is asserted in
// measurement.test.ts. Channel is stamped on EVERY row (as GA4/BigQuery export does), so
// channel-segmented funnels don't drop a session's non-session_start events.

const W1 = Date.UTC(2026, 0, 5, 12, 0, 0)  // Monday 2026-01-05 (week 1)
const W2 = Date.UTC(2026, 0, 12, 12, 0, 0) // Monday 2026-01-12 (week 2)
export const WEEK1 = '2026-01-05'
export const WEEK2 = '2026-01-12'

function r(
  visitor_id: string,
  session_id: string,
  event_name: string,
  timestamp: number,
  channel: string,
  event_id?: string,
  extra?: Partial<AnalyticsRow>
): AnalyticsRow {
  return { visitor_id, session_id, event_name, timestamp, channel, event_id, ...extra }
}

export const MEASUREMENT_FIXTURE: AnalyticsRow[] = [
  // s1 (v1, organic, W1) — converted via calendar_add (full path)
  r('v1', 's1', 'session_start', W1, 'organic'),
  r('v1', 's1', 'event_card_click', W1, 'organic', 'e1'),
  r('v1', 's1', 'detail_view', W1, 'organic', 'e1'),
  r('v1', 's1', 'calendar_add', W1, 'organic', 'e1', { method: 'google' }),
  // s2 (v2, direct, W1) — engaged only (filter)
  r('v2', 's2', 'session_start', W1, 'direct'),
  r('v2', 's2', 'filter_applied', W1, 'direct', undefined, { city: 'frisco', filter_fields: 'ages' }),
  // s3 (v3, organic, W1) — intent (directions), not converted
  r('v3', 's3', 'session_start', W1, 'organic'),
  r('v3', 's3', 'event_card_click', W1, 'organic', 'e1'),
  r('v3', 's3', 'detail_view', W1, 'organic', 'e1'),
  r('v3', 's3', 'directions_tap', W1, 'organic', 'e1'),
  // s4 (v4, organic, W1) — converted via attending WITHOUT an intent event; also shared
  r('v4', 's4', 'session_start', W1, 'organic'),
  r('v4', 's4', 'event_card_click', W1, 'organic', 'e1'),
  r('v4', 's4', 'attending_tap', W1, 'organic', 'e1'),
  r('v4', 's4', 'share_tap', W1, 'organic', 'e1'),
  // s5 (v5, referral, W1) — session only, bounced
  r('v5', 's5', 'session_start', W1, 'referral'),
  // s6 (v1, organic, W2) — v1 RETURNS the next week (converted in W1)
  r('v1', 's6', 'session_start', W2, 'organic'),
  // s7 (v6, direct, W2) — new visitor, converted via calendar_add
  r('v6', 's7', 'session_start', W2, 'direct'),
  r('v6', 's7', 'event_card_click', W2, 'direct', 'e2'),
  r('v6', 's7', 'detail_view', W2, 'direct', 'e2'),
  r('v6', 's7', 'calendar_add', W2, 'direct', 'e2', { method: 'ics' }),
]
