// Measurement framework (v1.2 analytics spec, Part 1 — Functional dashboard).
// Pure functions that compute the north-star, funnel, KPIs, referral and top-events
// metrics from a stream of GA4-shaped event rows. No I/O — the live dashboard maps GA4
// (or its BigQuery export) into AnalyticsRow[] and calls these; the tests feed fixtures.

export interface AnalyticsRow {
  visitor_id: string   // GA4 user pseudo id (cookie-based)
  session_id: string   // GA4 ga_session_id (unique per visitor per session)
  event_name: string   // 'session_start' | one of the 7 custom events | anything else
  timestamp: number    // epoch ms — used for weekly bucketing
  channel?: string     // acquisition channel (organic/direct/referral/social), from session_start
  event_id?: string    // the Open Eventz event the action targeted — for the Top Events table
}

// Funnel step level for each event. share_tap is intentionally ABSENT — Referral is tracked
// outside the funnel. Sessions=0, Engaged=1, Intent=2, Converted=3.
const STEP_LEVEL: Record<string, number> = {
  session_start: 0,
  filter_applied: 1,
  event_card_click: 1,
  detail_view: 2,
  directions_tap: 2,
  calendar_add: 3,
  attending_tap: 3,
}
const CONVERSION_EVENTS = new Set(['calendar_add', 'attending_tap'])

const pct = (num: number, den: number): number => (den === 0 ? 0 : num / den)

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

// The most-advanced funnel step a session reached, by ANY path (spec: "most advanced step
// reached, not a strict linear path"). A session that converts without an explicit intent
// event still returns 3 — and therefore also counts toward the Engaged/Intent cumulative buckets.
function sessionMaxStep(rows: AnalyticsRow[]): number {
  let max = 0
  for (const r of rows) {
    const lvl = STEP_LEVEL[r.event_name]
    if (lvl !== undefined && lvl > max) max = lvl
  }
  return max
}

// Monday-anchored week key ('YYYY-MM-DD' of that week's Monday, UTC). Deterministic.
export function weekKey(ts: number): string {
  const d = new Date(ts)
  const mondayOffset = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset)
  return new Date(monday).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// North Star — Weekly Active Discoverers: unique visitors per week with >=1 conversion
// action (calendar_add OR attending_tap), counted once per visitor per week.
// ---------------------------------------------------------------------------
export function weeklyActiveDiscoverers(rows: AnalyticsRow[]): { week: string; wad: number }[] {
  const perWeek = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!CONVERSION_EVENTS.has(r.event_name)) continue
    const wk = weekKey(r.timestamp)
    const set = perWeek.get(wk) ?? new Set<string>()
    set.add(r.visitor_id)
    perWeek.set(wk, set)
  }
  return [...perWeek.entries()]
    .map(([week, set]) => ({ week, wad: set.size }))
    .sort((a, b) => a.week.localeCompare(b.week))
}

// ---------------------------------------------------------------------------
// Conversion funnel — counts per step (cumulative: # sessions that reached AT LEAST that
// step), the step-to-step rates, and the sub-metric breakdowns. Optionally scoped to one
// acquisition channel so the funnel is segmentable.
// ---------------------------------------------------------------------------
export interface FunnelResult {
  sessions: number
  engaged: number
  intent: number
  converted: number
  engagedRate: number      // engaged / sessions
  intentRate: number       // intent / engaged
  conversionRate: number   // converted / intent
  subMetrics: {
    detailView: { count: number; pctOfIntent: number }
    directions: { count: number; pctOfIntent: number }
    calendarAdd: { count: number; pctOfConverted: number }
    attending: { count: number; pctOfConverted: number }
  }
}

export function computeFunnel(rows: AnalyticsRow[], channel?: string): FunnelResult {
  const scoped = channel ? rows.filter(r => r.channel === channel) : rows
  const bySession = groupBy(scoped, r => r.session_id)

  let sessions = 0, engaged = 0, intent = 0, converted = 0
  let dvSessions = 0, dirSessions = 0, calSessions = 0, attSessions = 0

  for (const [, srows] of bySession) {
    sessions++
    const maxStep = sessionMaxStep(srows)
    if (maxStep >= 1) engaged++
    if (maxStep >= 2) intent++
    if (maxStep >= 3) converted++

    const names = new Set(srows.map(r => r.event_name))
    if (maxStep >= 2) {
      if (names.has('detail_view')) dvSessions++
      if (names.has('directions_tap')) dirSessions++
    }
    if (maxStep >= 3) {
      if (names.has('calendar_add')) calSessions++
      if (names.has('attending_tap')) attSessions++
    }
  }

  return {
    sessions, engaged, intent, converted,
    engagedRate: pct(engaged, sessions),
    intentRate: pct(intent, engaged),
    conversionRate: pct(converted, intent),
    subMetrics: {
      detailView: { count: dvSessions, pctOfIntent: pct(dvSessions, intent) },
      directions: { count: dirSessions, pctOfIntent: pct(dirSessions, intent) },
      calendarAdd: { count: calSessions, pctOfConverted: pct(calSessions, converted) },
      attending: { count: attSessions, pctOfConverted: pct(attSessions, converted) },
    },
  }
}

// ---------------------------------------------------------------------------
// Return visit rate — % of a week's converters who return (any session) the next week.
// Cookie-based GA4 proxy (documented limitation). `week` is a Monday key from weekKey().
// ---------------------------------------------------------------------------
export function returnVisitRate(rows: AnalyticsRow[], week: string): number {
  const nextWeek = weekKey(Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000)
  const convertersW1 = new Set<string>()
  const activeW2 = new Set<string>()
  for (const r of rows) {
    const wk = weekKey(r.timestamp)
    if (wk === week && CONVERSION_EVENTS.has(r.event_name)) convertersW1.add(r.visitor_id)
    if (wk === nextWeek) activeW2.add(r.visitor_id)
  }
  if (convertersW1.size === 0) return 0
  let returned = 0
  for (const v of convertersW1) if (activeW2.has(v)) returned++
  return returned / convertersW1.size
}

// ---------------------------------------------------------------------------
// Referral — weekly share_tap totals + % of converted sessions that also shared.
// ---------------------------------------------------------------------------
export function referral(rows: AnalyticsRow[]): {
  weeklyShareTaps: { week: string; count: number }[]
  pctOfConvertedSessionsShared: number
} {
  const perWeek = new Map<string, number>()
  for (const r of rows) {
    if (r.event_name !== 'share_tap') continue
    const wk = weekKey(r.timestamp)
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1)
  }
  const bySession = groupBy(rows, r => r.session_id)
  let converted = 0, convertedAndShared = 0
  for (const [, srows] of bySession) {
    if (sessionMaxStep(srows) < 3) continue
    converted++
    if (srows.some(r => r.event_name === 'share_tap')) convertedAndShared++
  }
  return {
    weeklyShareTaps: [...perWeek.entries()]
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week)),
    pctOfConvertedSessionsShared: pct(convertedAndShared, converted),
  }
}

// ---------------------------------------------------------------------------
// Top Events — per Open Eventz event: attending, calendar adds, directions, shares.
// Sorted by attending count desc; top `limit` (spec: 10).
// ---------------------------------------------------------------------------
export interface TopEventRow {
  event_id: string
  attending: number
  calendarAdds: number
  directions: number
  shares: number
}

export function topEvents(rows: AnalyticsRow[], limit = 10): TopEventRow[] {
  const m = new Map<string, TopEventRow>()
  const get = (id: string): TopEventRow => {
    let r = m.get(id)
    if (!r) { r = { event_id: id, attending: 0, calendarAdds: 0, directions: 0, shares: 0 }; m.set(id, r) }
    return r
  }
  for (const r of rows) {
    if (!r.event_id) continue
    if (r.event_name === 'attending_tap') get(r.event_id).attending++
    else if (r.event_name === 'calendar_add') get(r.event_id).calendarAdds++
    else if (r.event_name === 'directions_tap') get(r.event_id).directions++
    else if (r.event_name === 'share_tap') get(r.event_id).shares++
  }
  return [...m.values()].sort((a, b) => b.attending - a.attending).slice(0, limit)
}
