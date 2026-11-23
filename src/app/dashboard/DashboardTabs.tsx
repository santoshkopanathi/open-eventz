'use client'

import { useState } from 'react'
import type { FunnelResult, TopEventRow } from '@/lib/measurement'
import type { AgeVisibility, PriceVisibility, IngestRun } from '@/lib/technical-metrics'

const ACCENT = '#C4B068', PRIMARY = 'var(--color-primary)', PERI = 'var(--color-periwinkle)'
const OK = '#16A34A', WARN = '#D97706', ERR = '#DC2626', NONE = '#E5E7EB'
const GREEN = '#065F46', AMBER = '#92400E', BLUE = '#1E40AF'
const STATUS: Record<string, string> = { ok: OK, warn: WARN, err: ERR, none: NONE }
const SRC: Record<string, string> = { 'frisco-library': 'Frisco Library', 'plano-library': 'Plano Libraries', 'play-frisco': 'Play Frisco', 'kaleidoscope-park': 'Kaleidoscope Park' }
const FILTER_LABEL: Record<string, string> = { ages: 'Age range', date_from: 'Date range', date_to: 'Date range', sources: 'Source / host', branches: 'Branch (Plano)' }
const pct = (x: number) => `${Math.round(x * 100)}%`
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

type Technical = {
  heartbeat: { source: string; ok: boolean; detail: string }[]
  heartbeatWindowHours: number
  lastIngest: IngestRun | null
  totalEvents: number
  counts: { bySource: { source: string; total: number }[]; free: number; paid: number; unknown: number }
  inferred: { source: string; label: string; confirmedLabel: string; ageVis: AgeVisibility; priceVis: PriceVisibility }[]
  history: { date: string; status: string }[]
  cost: { lastRunUsd: number; cumulativeUsd: number; totalCalls: number }
  runs: IngestRun[]
}
type Functional = {
  status: string
  message?: string
  rowCount: number
  wadSeries: { week: string; wad: number }[]
  funnel: FunnelResult
  returnRate: number | null
  referral: { weeklyShareTaps: { week: string; count: number }[]; pctOfConvertedSessionsShared: number }
  top: (TopEventRow & { title?: string; source?: string })[]
  actions: { googleCalendar: number; appleCalendar: number; attending: number }
  filters: { byField: Record<string, number>; byCity: Record<string, number>; total: number }
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border p-4 ${className}`} style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>{children}</div>
}
// A label with an explanation on hover or keyboard focus. Native `title` was not enough: it waits
// about a second, never shows on touch or focus, and gives no hint that there is anything to read.
function Tip({ label, text, align = 'left' }: { label: React.ReactNode; text: string; align?: 'left' | 'right' }) {
  return (
    <span className="relative inline-flex items-center gap-1 group cursor-help outline-none" tabIndex={0} aria-label={`${typeof label === 'string' ? label : ''}: ${text}`}>
      <span className="underline decoration-dotted underline-offset-2">{label}</span>
      <span aria-hidden className="text-[9px] opacity-70">ⓘ</span>
      <span role="tooltip" className={`pointer-events-none absolute top-full mt-1 z-20 w-64 rounded-md px-2.5 py-2 text-[11px] font-normal normal-case tracking-normal leading-snug text-left shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus:opacity-100 group-focus:visible transition-opacity ${align === 'right' ? 'right-0' : 'left-0'}`} style={{ background: '#1F1D2B', color: '#F5F4FA' }}>{text}</span>
    </span>
  )
}
function Section({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-bold uppercase tracking-wider mt-5 mb-2 pb-1 border-b" style={{ color: PERI, borderColor: 'var(--color-border)' }}>{children}</h3>
}
function Hbar({ label, value, max, color, right }: { label: string; value: number; max: number; color: string; right?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-xs w-36 flex-shrink-0" style={{ color: 'var(--color-text)' }}>{label}</div>
      <div className="flex-1 h-2.5 rounded" style={{ background: '#F0F0EE' }}><div className="h-full rounded" style={{ width: `${max ? Math.round((value / max) * 100) : 0}%`, background: color }} /></div>
      <div className="text-xs font-semibold w-10 text-right flex-shrink-0" style={{ color: 'var(--color-text-2, #5A5868)' }}>{right ?? value}</div>
    </div>
  )
}
function Pill({ status }: { status: string }) {
  const c = STATUS[status] ?? NONE
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: c + '22', color: c }}>{status.toUpperCase()}</span>
}

export default function DashboardTabs({ technical: t, functional: f }: { technical: Technical; functional: Functional }) {
  const [tab, setTab] = useState<'functional' | 'technical'>('functional')
  const wadMax = Math.max(1, ...f.wadSeries.map(w => w.wad))
  const latestWad = f.wadSeries.at(-1)?.wad ?? 0
  const prevWad = f.wadSeries.at(-2)?.wad ?? 0
  const fn = f.funnel
  // Oldest row the cost tiles add up — the query is a row limit, so the window is stated, not assumed.
  const runsSince = t.runs.length ? t.runs[t.runs.length - 1].ran_at.slice(0, 10) : null
  const banner = f.status === 'no-key' ? 'BigQuery credentials not configured (GCP_SA_KEY_B64 missing).'
    : f.status === 'no-data' ? `No GA4 data in BigQuery yet. ${f.message ?? ''} Metrics populate as events arrive and the Daily export runs.`
    : f.status === 'error' ? `BigQuery query failed: ${f.message}` : null
  const filterMax = Math.max(1, ...Object.values(f.filters.byField), ...Object.values(f.filters.byCity))

  return (
    <main className="min-h-full" style={{ color: 'var(--color-text)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3" style={{ background: PRIMARY }}>
        <span className="text-2xl">🎈</span>
        <div><div className="text-white font-bold text-lg leading-tight">Open Eventz</div><div className="text-white/50 text-[11px]">Analytics Dashboard</div></div>
        <div className="ml-auto text-[11px] text-white/70 border border-white/20 rounded px-2.5 py-1 font-semibold">Live data · updates on refresh</div>
      </div>
      {/* Tabs */}
      <div className="flex px-5 border-b" style={{ background: 'var(--color-primary-dark, #242A52)', borderColor: 'rgba(255,255,255,.08)' }}>
        {(['functional', 'technical'] as const).map(name => (
          <button key={name} onClick={() => setTab(name)} className="px-5 py-2.5 text-[13px] font-semibold border-b-[3px] transition-colors"
            style={{ color: tab === name ? ACCENT : 'rgba(255,255,255,.45)', borderBottomColor: tab === name ? ACCENT : 'transparent' }}>
            {name === 'functional' ? '📊 Functional' : '⚙️ Technical'}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-5xl mx-auto">
        {tab === 'functional' ? (
          <>
            {banner && <div className="mb-4 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--color-border)', background: '#FEF3C7', color: AMBER }}>{banner}</div>}

            {/* North star + WAD trend */}
            <div className="grid md:grid-cols-2 gap-4 mb-2">
              <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: PRIMARY }}>
                <div className="text-5xl font-extrabold" style={{ color: ACCENT }}>{latestWad}</div>
                <div>
                  <div className="text-white font-bold text-sm">Weekly Active Discoverers (WAD)</div>
                  <div className="text-white/55 text-[10px] leading-relaxed max-w-xs">Unique visitors with ≥1 conversion action (Add to Calendar or Attending), once per visitor per week.</div>
                  {f.wadSeries.length >= 2 && <div className="text-[12px] font-bold mt-1.5" style={{ color: ACCENT }}>{latestWad >= prevWad ? '↑' : '↓'} {Math.abs(latestWad - prevWad)} vs prior week ({prevWad})</div>}
                </div>
              </div>
              <Card>
                <div className="text-[13px] font-semibold mb-2">WAD — recent weeks</div>
                <div className="flex items-end gap-1.5 h-24">
                  {f.wadSeries.slice(-8).map((w, i, arr) => (
                    <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[10px] font-bold">{w.wad}</div>
                      <div className="w-full rounded-t" style={{ height: `${Math.round((w.wad / wadMax) * 100)}%`, minHeight: 2, background: i === arr.length - 1 ? ACCENT : PRIMARY, opacity: i === arr.length - 1 ? 1 : 0.4 }} />
                      <div className="text-[9px]" style={{ color: 'var(--color-text-3, #9A9898)' }}>{w.week.slice(5)}</div>
                    </div>
                  ))}
                  {f.wadSeries.length === 0 && <div className="text-xs text-gray-400 self-center">No weekly data yet.</div>}
                </div>
              </Card>
            </div>

            {/* Funnel + standalone */}
            <Section>Conversion Funnel &amp; Standalone Metrics</Section>
            <div className="grid md:grid-cols-2 gap-4 items-start">
              <Card>
                <div className="text-[13px] font-semibold mb-3">Conversion Funnel</div>
                {([
                  ['Sessions', fn.sessions, null, 'Starting point', PRIMARY, []],
                  ['Engaged', fn.engaged, fn.engagedRate, 'of sessions', '#4A5DA8', [['Card click', fn.subMetrics.cardClick.count], ['Filter applied', fn.subMetrics.filterApplied.count]]],
                  ['Expressed Intent', fn.intent, fn.intentRate, 'of engaged', PERI, [['View details', fn.subMetrics.detailView.count], ['Get directions', fn.subMetrics.directions.count]]],
                  ['Converted · WAD', fn.converted, fn.conversionRate, 'of intent', ACCENT, [['Add to calendar', fn.subMetrics.calendarAdd.count], ['Attending', fn.subMetrics.attending.count]]],
                ] as [string, number, number | null, string, string, [string, number][]][]).map(([label, n, rate, sub, color, subs], idx, all) => (
                  <div key={label}>
                    <div className="flex items-center gap-3 mb-0.5">
                      <div className="w-32 flex-shrink-0">
                        <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-3,#9A9898)' }}>{label}</div>
                        <div className="text-xl font-extrabold">{n}</div>
                        <div className="text-[10px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>{rate !== null ? <><span style={{ color: PERI, fontWeight: 600 }}>{pct(rate)}</span> {sub}</> : sub}</div>
                      </div>
                      <div className="flex-1">
                        <div className="h-9 flex items-center justify-center text-[11px] font-bold text-white mx-auto" style={{ width: `${Math.max(24, Math.round((n / Math.max(1, fn.sessions)) * 100))}%`, background: color, clipPath: 'polygon(0 0, 100% 0, 88% 100%, 12% 100%)' }}>{n}</div>
                        {subs.length > 0 && <div className="flex gap-3 mt-1 flex-wrap justify-center text-[10px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>{subs.map(([sl, sv]) => <span key={sl}>{sl}: <strong style={{ color: 'var(--color-text-2,#5A5868)' }}>{sv}</strong></span>)}</div>}
                      </div>
                    </div>
                    {idx < all.length - 1 && <div className="text-center text-xs text-gray-300 py-0.5 ml-36">↓</div>}
                  </div>
                ))}
              </Card>
              <div className="flex flex-col gap-3">
                <Card><div className="flex items-center gap-3"><span className="text-2xl">↗️</span><div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>Referral — Share taps</div><div className="text-2xl font-extrabold">{f.referral.weeklyShareTaps.reduce((s, w) => s + w.count, 0)}</div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>{pct(f.referral.pctOfConvertedSessionsShared)} of converted sessions also shared</div></div></div></Card>
                <Card><div className="flex items-center gap-3"><span className="text-2xl">🔁</span><div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>Return Visit Rate</div><div className="text-2xl font-extrabold">{f.returnRate === null ? '—' : pct(f.returnRate)}</div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>{f.returnRate === null ? 'needs 2 weeks of data' : 'GA4 proxy · cookie-based'}</div></div></div></Card>
              </div>
            </div>

            {/* Breakdowns */}
            <div className="grid md:grid-cols-3 gap-4 mt-4">
              <Card>
                <div className="text-[13px] font-semibold mb-2">Filter Usage</div>
                <div className="flex flex-col gap-2.5">
                  {Object.entries(f.filters.byField).map(([k, v]) => <Hbar key={k} label={FILTER_LABEL[k] ?? k} value={v} max={filterMax} color={PRIMARY} />)}
                  {Object.entries(f.filters.byCity).map(([k, v]) => <Hbar key={k} label={`City — ${k}`} value={v} max={filterMax} color={ACCENT} />)}
                  {f.filters.total === 0 && <div className="text-xs text-gray-400">No filter events yet.</div>}
                </div>
              </Card>
              <Card>
                <div className="text-[13px] font-semibold mb-2">Conversion Actions</div>
                <div className="flex flex-col gap-2.5">
                  <Hbar label="Google Calendar" value={f.actions.googleCalendar} max={Math.max(1, f.actions.googleCalendar, f.actions.appleCalendar, f.actions.attending)} color={GREEN} />
                  <Hbar label="Apple Calendar (ICS)" value={f.actions.appleCalendar} max={Math.max(1, f.actions.googleCalendar, f.actions.appleCalendar, f.actions.attending)} color="#4CAF50" />
                  <Hbar label="Attending tap" value={f.actions.attending} max={Math.max(1, f.actions.googleCalendar, f.actions.appleCalendar, f.actions.attending)} color={PERI} />
                </div>
              </Card>
              <Card>
                <div className="text-[13px] font-semibold mb-2">Intent Actions</div>
                <div className="flex flex-col gap-2.5">
                  <Hbar label="View event details" value={fn.subMetrics.detailView.count} max={Math.max(1, fn.subMetrics.detailView.count, fn.subMetrics.directions.count)} color={BLUE} />
                  <Hbar label="Get directions" value={fn.subMetrics.directions.count} max={Math.max(1, fn.subMetrics.detailView.count, fn.subMetrics.directions.count)} color={PERI} />
                </div>
                <div className="mt-2.5 p-2 rounded text-[10px]" style={{ background: 'var(--color-bg,#F6F7F9)', color: 'var(--color-text-3,#9A9898)' }}>Get directions is a stronger signal — the parent is planning the trip.</div>
              </Card>
            </div>

            {/* Top events */}
            <Section>Top Events by Engagement</Section>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="text-left" style={{ color: 'var(--color-text-3,#9A9898)' }}>
                  <th className="p-2.5 font-bold uppercase text-[10px]">Event</th><th className="font-bold uppercase text-[10px]">Source</th><th className="font-bold uppercase text-[10px]">Attending</th><th className="font-bold uppercase text-[10px]">Calendar</th><th className="font-bold uppercase text-[10px]">Directions</th><th className="font-bold uppercase text-[10px]">Shares</th>
                </tr></thead>
                <tbody>
                  {f.top.map(e => (
                    <tr key={e.event_id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="p-2.5">{e.title ?? e.event_id}</td>
                      <td>{e.source ? (SRC[e.source] ?? e.source) : '—'}</td>
                      <td>{e.attending}</td><td>{e.calendarAdds}</td><td>{e.directions}</td><td>{e.shares}</td>
                    </tr>
                  ))}
                  {f.top.length === 0 && <tr><td colSpan={6} className="p-3 text-gray-400">No conversion/share events yet.</td></tr>}
                </tbody>
              </table>
            </Card>
            <p className="text-[11px] mt-4" style={{ color: 'var(--color-text-3,#9A9898)' }}>{f.rowCount} rows from BigQuery <code>analytics_546304403.events_*</code> (last 90 days).</p>
          </>
        ) : (
          <>
            {/* Technical */}

            {/* Heartbeat first, deliberately. Every tile below answers "how did the last run
                go?" — which assumes a run happened. On 2026-10-22 the schedule was dropped
                entirely and those tiles showed a healthy run from the day before. This reads
                the events table, so a pipeline that stopped is visible as staleness. */}
            <Section>Pipeline Heartbeat — did it run at all?</Section>
            <Card>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-semibold">
                  {t.heartbeat.every(h => h.ok)
                    ? 'All sources writing'
                    : `${t.heartbeat.filter(h => !h.ok).length} source(s) have stopped writing`}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>
                  window {t.heartbeatWindowHours}h
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {t.heartbeat.map(h => (
                  <div
                    key={h.source}
                    className="px-3 py-2"
                    style={{
                      borderRadius: 'var(--radius-input)',
                      border: `1px solid ${h.ok ? 'var(--color-border)' : ACCENT}`,
                      backgroundColor: h.ok ? 'transparent' : 'var(--color-accent-tint, rgba(180,98,59,0.08))',
                    }}
                  >
                    <div className="text-[11px] font-semibold flex items-center gap-1.5">
                      <span aria-hidden="true">{h.ok ? '✅' : '❌'}</span>
                      {SRC[h.source] ?? h.source}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: h.ok ? 'var(--color-text-3,#9A9898)' : ACCENT }}>
                      {h.detail}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] mt-2" style={{ color: 'var(--color-text-3,#9A9898)' }}>
                Read from the events table, not the run log — a schedule that never fired writes no run record.
                The same check runs as the Heartbeat workflow and emails on failure.
              </div>
            </Card>

            <Section>Ingest Pipeline — Last Run</Section>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>Last ingest</div><div className="text-base font-bold">{fmtTime(t.lastIngest?.ran_at ?? null)}</div>{t.lastIngest && <div className="mt-1"><Pill status={t.lastIngest.status} /></div>}</Card>
              <Card><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>Total events in DB</div><div className="text-2xl font-extrabold">{t.totalEvents}</div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>all four sources</div></Card>
              <Card><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>Upserted (last run)</div><div className="text-2xl font-extrabold">{t.lastIngest?.total_upserted ?? 0}</div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>duration {t.lastIngest ? (t.lastIngest.duration_ms / 1000).toFixed(1) + 's' : '—'}</div></Card>
              <Card><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>LLM calls (last run)</div><div className="text-2xl font-extrabold">{t.lastIngest?.llm_calls ?? 0}</div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>${(t.lastIngest?.llm_cost_usd ?? 0).toFixed(3)}</div></Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-2">
              <Card>
                <div className="text-[13px] font-semibold mb-2">Event Counts in DB</div>
                <div className="flex flex-col gap-2.5">
                  {t.counts.bySource.map(s => <Hbar key={s.source} label={SRC[s.source] ?? s.source} value={s.total} max={Math.max(1, ...t.counts.bySource.map(x => x.total))} color={PRIMARY} />)}
                </div>
                <div className="my-3 h-px" style={{ background: 'var(--color-border)' }} />
                <div className="flex flex-col gap-2.5">
                  <Hbar label="Free events" value={t.counts.free} max={t.totalEvents} color={GREEN} />
                  <Hbar label="Paid events" value={t.counts.paid} max={t.totalEvents} color={AMBER} />
                  <Hbar label="Price unknown" value={t.counts.unknown} max={t.totalEvents} color="#9A9898" />
                </div>
              </Card>
              <Card>
                <div className="text-[13px] font-semibold mb-2">Ingest History — 7 days</div>
                <div className="flex items-end gap-1 h-24">
                  {t.history.map(d => <div key={d.date} title={`${d.date}: ${d.status}`} className="flex-1 rounded-sm" style={{ height: d.status === 'none' ? '15%' : '100%', background: STATUS[d.status] }} />)}
                </div>
                <div className="flex gap-3 mt-2 text-[10px]" style={{ color: 'var(--color-text-3,#9A9898)' }}><span style={{ color: OK }}>● OK</span><span style={{ color: WARN }}>● WARN</span><span style={{ color: ERR }}>● ERR</span></div>
              </Card>
            </div>

            {t.inferred.map(({ source, label, confirmedLabel, ageVis, priceVis }) => (
              <div key={source}>
                <Section>{label} — Inferred Age Visibility <span className="normal-case font-normal tracking-normal">({ageVis.total} events)</span></Section>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {([
                    ['~ Family ✦ shown', ageVis.family, PRIMARY, 'The card shows "Family ✦": Claude judged it an all-ages family event. The ✦ marks an age we worked out, not one the source stated.'],
                    ['✦ only shown', ageVis.specific, BLUE, 'The card shows a specific age range with the ✦, e.g. "Ages 5–8 ✦": Claude worked out a range from the description. The source gave no age.'],
                    ['Nothing shown (low conf.)', ageVis.nothing, '#9A9898', 'No age badge on the card. Should be near zero: since v1.3 a low-confidence or missing guess falls back to "Family ✦". If it climbs, Claude stopped returning ages.'],
                    ['Hidden (not kid-relevant)', ageVis.hidden, ERR, 'Not shown to parents at all: Claude judged it not a kids or family event (or adults-only).'],
                  ] as [string, number, string, string][]).map(([l, n, c, tip], i) => (
                    <Card key={l}><div className="text-[11px] font-bold" style={{ color: c }}><Tip label={l} text={tip} align={i % 2 ? 'right' : 'left'} /></div><div className="text-2xl font-extrabold mt-1">{n} <span className="text-sm font-normal text-gray-400">{ageVis.total ? pct(n / ageVis.total) : '0%'}</span></div></Card>
                  ))}
                </div>

                <Section>{label} — Inferred Free vs Paid</Section>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {([['Free ✦ (inferred)', priceVis.freeInferred], [`Free (${confirmedLabel})`, priceVis.freeConfirmed], ['Paid ✦ (inferred)', priceVis.paidInferred], [`Paid (${confirmedLabel})`, priceVis.paidConfirmed], ['Unknown (no badge)', priceVis.unknown]] as [string, number][]).map(([l, n]) => (
                    <Card key={l}><div className="text-2xl font-extrabold">{n} <span className="text-sm font-normal text-gray-400">{priceVis.total ? pct(n / priceVis.total) : '0%'}</span></div><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}>{l}</div></Card>
                  ))}
                </div>
                <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-3,#9A9898)' }}><strong>Free ✦ (inferred) = {priceVis.freeInferred}</strong> is the &ldquo;free by assumption&rdquo; exposure.</p>
              </div>
            ))}

            <Section>LLM Inference — Cost &amp; Model</Section>
            <div className="grid grid-cols-3 gap-3">
              <Card><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}><Tip label="Calls (lifetime)" text={`Claude calls added up over the last ${t.runs.length} ingest rows${runsSince ? ` (since ${runsSince})` : ''}, not a true lifetime total. Each night writes one row per source. An event already classified is a cache hit and makes no call, so a quiet night adds 0.`} /></div><div className="text-2xl font-extrabold">{t.cost.totalCalls}</div></Card>
              <Card><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}><Tip label="Cost last run" text="Estimated cost of the single most recent ingest row: one source, not the whole night. The two libraries never call Claude, and cached events make no call, so this is often $0.000. Estimate = calls × $0.006, not the billed amount." /></div><div className="text-2xl font-extrabold" style={{ color: GREEN }}>${t.cost.lastRunUsd.toFixed(3)}</div></Card>
              <Card><div className="text-[11px]" style={{ color: 'var(--color-text-3,#9A9898)' }}><Tip align="right" label="Cost cumulative" text={`Estimated cost added up over the same last ${t.runs.length} ingest rows${runsSince ? ` (since ${runsSince})` : ''}. Calls × $0.006, not the billed amount. Covers the nightly ingest only: Ask Open Eventz and the CI evals are not included.`} /></div><div className="text-2xl font-extrabold" style={{ color: GREEN }}>${t.cost.cumulativeUsd.toFixed(3)}</div></Card>
            </div>
            <div className="mt-2 p-2.5 rounded text-[11px]" style={{ background: '#D1FAE5', color: GREEN }}>✓ Model: <strong>claude-sonnet-4-6</strong> over Haiku — cost difference &lt;$0.03 at this scale; accuracy the deciding factor.</div>

            <Section>Ingest Log — Last 7 Runs</Section>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="text-left" style={{ color: 'var(--color-text-3,#9A9898)' }}><th className="p-2.5 font-bold uppercase text-[10px]">When</th><th className="font-bold uppercase text-[10px]">Status</th><th className="font-bold uppercase text-[10px]">Frisco</th><th className="font-bold uppercase text-[10px]">Plano</th><th className="font-bold uppercase text-[10px]">Play&nbsp;Frisco</th><th className="font-bold uppercase text-[10px]">Upserted</th><th className="font-bold uppercase text-[10px]"><Tip align="right" label="LLM" text="Claude calls this run made. 0 is normal: the libraries never call Claude, and an event already classified on an earlier night is a cache hit. Only new events on Play Frisco and Kaleidoscope Park make calls." /></th><th className="font-bold uppercase text-[10px]"><Tip align="right" label="Cost" text="Estimated cost of this run: LLM calls × $0.006. An estimate for the dashboard, not the billed amount." /></th><th className="font-bold uppercase text-[10px]">Dur</th></tr></thead>
                <tbody>
                  {t.runs.slice(0, 7).map(r => (
                    <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="p-2.5 whitespace-nowrap">{fmtTime(r.ran_at)}</td><td><Pill status={r.status} /></td><td>{r.frisco_fetched}</td><td>{r.plano_fetched}</td><td>{r.play_frisco_fetched}</td><td>{r.total_upserted}</td><td>{r.llm_calls}</td><td>${(r.llm_cost_usd ?? 0).toFixed(3)}</td><td className="whitespace-nowrap">{(r.duration_ms / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                  {t.runs.length === 0 && <tr><td colSpan={9} className="p-3 text-gray-400">No runs recorded yet.</td></tr>}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </main>
  )
}
