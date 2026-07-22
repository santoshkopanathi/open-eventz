import Link from 'next/link'
import { fetchAnalyticsRows } from '@/lib/bigquery'
import { supabaseAdmin } from '@/lib/supabase'
import {
  weeklyActiveDiscoverers,
  computeFunnel,
  returnVisitRate,
  referral,
  topEvents,
} from '@/lib/measurement'

export const dynamic = 'force-dynamic'

const pctStr = (x: number) => `${Math.round(x * 100)}%`
const usd = (n: number) => n.toLocaleString('en-US')

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{title}</h2>
      {children}
    </section>
  )
}
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{value}</div>
      <div className="text-xs text-gray-500">{label}{sub ? ` · ${sub}` : ''}</div>
    </div>
  )
}

export default async function FunctionalDashboardPage() {
  const fetched = await fetchAnalyticsRows()
  const rows = fetched.rows

  const wadSeries = weeklyActiveDiscoverers(rows)
  const latestWad = wadSeries.at(-1)?.wad ?? 0
  const prevWad = wadSeries.at(-2)?.wad ?? 0
  const wadTrend = latestWad - prevWad
  const funnel = computeFunnel(rows)
  const ref = referral(rows)
  const top = topEvents(rows, 10)
  // Return-visit rate needs two consecutive weeks; use the earliest week that has a follow-up.
  const returnRate = wadSeries.length >= 2 ? returnVisitRate(rows, wadSeries[0].week) : null

  // Join event names/source from Supabase for the Top Events table.
  const topIds = top.map(t => t.event_id)
  const nameById = new Map<string, { title: string; source: string }>()
  if (topIds.length) {
    const { data } = await supabaseAdmin().from('events').select('id, title, source').in('id', topIds)
    for (const e of (data ?? []) as { id: string; title: string; source: string }[]) nameById.set(e.id, { title: e.title, source: e.source })
  }

  const banner =
    fetched.status === 'no-key' ? 'BigQuery credentials are not configured (GCP_SA_KEY_B64 missing).'
    : fetched.status === 'no-data' ? `No GA4 data in BigQuery yet. ${fetched.message ?? ''} Metrics populate as events arrive and the Daily export runs.`
    : fetched.status === 'error' ? `BigQuery query failed: ${fetched.message}`
    : null

  return (
    <main className="min-h-full p-6 max-w-5xl mx-auto" style={{ color: 'var(--color-text)' }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Open Eventz — Functional Dashboard</h1>
        <p className="text-sm text-gray-500">
          Discovery funnel from GA4 (via BigQuery). <Link href="/dashboard" className="underline">← Technical dashboard</Link>
        </p>
      </div>

      {banner && (
        <div className="mb-4 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: '#FEF3C7', color: '#92400E' }}>
          {banner}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* North star */}
        <Tile title="North Star — Weekly Active Discoverers">
          <div className="flex items-end gap-3">
            <div className="text-4xl font-bold">{latestWad}</div>
            <div className="text-sm text-gray-500 pb-1">
              WAD (latest week){wadSeries.length >= 2 ? <> · {wadTrend >= 0 ? '▲' : '▼'} {Math.abs(wadTrend)} WoW</> : null}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Unique visitors/week with ≥1 conversion action (Add to Calendar or Attending).</p>
        </Tile>

        {/* KPIs */}
        <Tile title="Supporting KPIs">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Engagement rate" value={pctStr(funnel.engagedRate)} sub="of sessions" />
            <Stat label="Intent rate" value={pctStr(funnel.intentRate)} sub="of engaged" />
            <Stat label="Conversion rate" value={pctStr(funnel.conversionRate)} sub="of intent" />
            <Stat label="Return-visit rate" value={returnRate === null ? '—' : pctStr(returnRate)} sub={returnRate === null ? 'needs 2 weeks' : 'wk1→wk2'} />
          </div>
        </Tile>
      </div>

      {/* Funnel */}
      <div className="mt-4">
        <Tile title="Conversion funnel">
          <div className="grid grid-cols-4 gap-2">
            {[
              ['Sessions', funnel.sessions, null],
              ['Engaged', funnel.engaged, funnel.engagedRate],
              ['Expressed Intent', funnel.intent, funnel.intentRate],
              ['Converted', funnel.converted, funnel.conversionRate],
            ].map(([label, n, rate]) => (
              <div key={label as string} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
                <div className="text-2xl font-bold">{n as number}</div>
                <div className="text-xs text-gray-500">{label as string}</div>
                {rate !== null && <div className="text-xs text-gray-400 mt-1">{pctStr(rate as number)} of prior</div>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
            <div><strong>{funnel.subMetrics.detailView.count}</strong> detail views <span className="text-gray-400">({pctStr(funnel.subMetrics.detailView.pctOfIntent)} of intent)</span></div>
            <div><strong>{funnel.subMetrics.directions.count}</strong> directions <span className="text-gray-400">({pctStr(funnel.subMetrics.directions.pctOfIntent)} of intent)</span></div>
            <div><strong>{funnel.subMetrics.calendarAdd.count}</strong> calendar adds <span className="text-gray-400">({pctStr(funnel.subMetrics.calendarAdd.pctOfConverted)} of converted)</span></div>
            <div><strong>{funnel.subMetrics.attending.count}</strong> attending <span className="text-gray-400">({pctStr(funnel.subMetrics.attending.pctOfConverted)} of converted)</span></div>
          </div>
        </Tile>
      </div>

      {/* Referral */}
      <div className="mt-4">
        <Tile title="Referral — share taps">
          <div className="flex gap-6">
            <Stat label="Share taps (total)" value={ref.weeklyShareTaps.reduce((s, w) => s + w.count, 0)} />
            <Stat label="% of converted sessions that shared" value={pctStr(ref.pctOfConvertedSessionsShared)} />
          </div>
        </Tile>
      </div>

      {/* Top events */}
      <div className="mt-4">
        <Tile title="Top events (by attending)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="py-2 pr-3">Event</th><th className="pr-3">Source</th><th className="pr-3">Attending</th><th className="pr-3">Calendar</th><th className="pr-3">Directions</th><th className="pr-3">Shares</th>
                </tr>
              </thead>
              <tbody>
                {top.map(t => (
                  <tr key={t.event_id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="py-2 pr-3">{nameById.get(t.event_id)?.title ?? t.event_id}</td>
                    <td className="pr-3 text-gray-500">{nameById.get(t.event_id)?.source ?? '—'}</td>
                    <td className="pr-3">{t.attending}</td>
                    <td className="pr-3">{t.calendarAdds}</td>
                    <td className="pr-3">{t.directions}</td>
                    <td className="pr-3">{t.shares}</td>
                  </tr>
                ))}
                {top.length === 0 && <tr><td colSpan={6} className="py-3 text-gray-500">No conversion/share events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Tile>
      </div>

      <p className="text-xs text-gray-400 mt-4">Rows from GA4 export: {usd(rows.length)}. Source: BigQuery <code>analytics_546304403.events_*</code> (last 90 days).</p>
    </main>
  )
}
