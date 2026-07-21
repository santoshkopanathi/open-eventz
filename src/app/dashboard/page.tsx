import { supabaseAdmin } from '@/lib/supabase'
import {
  inferredAgeVisibility,
  lastIngest,
  ingestHistory,
  llmCost,
  type IngestRun,
} from '@/lib/technical-metrics'
import type { Event } from '@/lib/types'

// Always read fresh (live operational data), never statically cached.
export const dynamic = 'force-dynamic'

const STATUS_COLOR: Record<string, string> = {
  ok: '#16A34A', warn: '#D97706', err: '#DC2626', none: '#E5E7EB',
}
const SOURCE_LABEL: Record<string, string> = {
  'frisco-library': 'Frisco Library', 'plano-library': 'Plano Libraries', 'play-frisco': 'Play Frisco',
}
const pct = (n: number, d: number) => (d === 0 ? '0%' : `${Math.round((n / d) * 100)}%`)
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

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

export default async function DashboardPage() {
  const db = supabaseAdmin()
  // Use exact COUNT queries for totals (a plain .select() caps at 1000 rows). Fetch only the
  // Play Frisco rows in full for the age-visibility buckets (a small set).
  const [total, frisco, plano, pf, free, paid, unknown, pfEventsRes, runsRes] = await Promise.all([
    db.from('events').select('*', { count: 'exact', head: true }),
    db.from('events').select('*', { count: 'exact', head: true }).eq('source', 'frisco-library'),
    db.from('events').select('*', { count: 'exact', head: true }).eq('source', 'plano-library'),
    db.from('events').select('*', { count: 'exact', head: true }).eq('source', 'play-frisco'),
    db.from('events').select('*', { count: 'exact', head: true }).eq('is_free', true),
    db.from('events').select('*', { count: 'exact', head: true }).eq('is_free', false),
    db.from('events').select('*', { count: 'exact', head: true }).is('is_free', null),
    db.from('events').select('source, is_free, kid_relevant, age_buckets, age_confidence').eq('source', 'play-frisco'),
    db.from('ingest_runs').select('*').order('ran_at', { ascending: false }).limit(30),
  ])

  const totalEvents = total.count ?? 0
  const counts = {
    bySource: [
      { source: 'frisco-library', total: frisco.count ?? 0 },
      { source: 'plano-library', total: plano.count ?? 0 },
      { source: 'play-frisco', total: pf.count ?? 0 },
    ],
    free: free.count ?? 0,
    paid: paid.count ?? 0,
    unknown: unknown.count ?? 0,
  }
  const vis = inferredAgeVisibility((pfEventsRes.data ?? []) as unknown as Event[])
  const runs = (runsRes.data ?? []) as unknown as IngestRun[]
  const last = lastIngest(runs)
  const today = new Date().toISOString().slice(0, 10)
  const history = ingestHistory(runs, today, 14)
  const cost = llmCost(runs)

  return (
    <main className="min-h-full p-6 max-w-5xl mx-auto" style={{ color: 'var(--color-text)' }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Open Eventz — Technical Dashboard</h1>
        <p className="text-sm text-gray-500">Operational health of the ingest pipeline, data, and LLM inference. Reads live Supabase data.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Ingest pipeline */}
        <Tile title="Ingest pipeline">
          {last ? (
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Last ingest" value={fmtTime(last.ran_at)} />
              <Stat label="Status" value={<span style={{ color: STATUS_COLOR[last.status] }}>{last.status.toUpperCase()}</span>} />
              <Stat label="Duration" value={`${(last.duration_ms / 1000).toFixed(1)}s`} />
              <Stat label="Total events in DB" value={totalEvents} />
            </div>
          ) : (
            <p className="text-sm text-gray-500">No ingest runs recorded yet. Run the ingest to populate this.</p>
          )}
        </Tile>

        {/* Per-source counts */}
        <Tile title="Event counts">
          <div className="grid grid-cols-3 gap-3 mb-3">
            {counts.bySource.map(s => (
              <Stat key={s.source} label={SOURCE_LABEL[s.source] ?? s.source} value={s.total} />
            ))}
          </div>
          <div className="flex gap-4 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <Stat label="Free" value={counts.free} />
            <Stat label="Paid" value={counts.paid} />
            <Stat label="Unknown" value={counts.unknown} />
          </div>
        </Tile>

        {/* Ingest history */}
        <Tile title="Ingest history — 14 days">
          <div className="flex items-end gap-1 h-16">
            {history.map(d => (
              <div key={d.date} title={`${d.date}: ${d.status}`} className="flex-1 rounded-sm" style={{ height: d.status === 'none' ? '20%' : '100%', backgroundColor: STATUS_COLOR[d.status] }} />
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span><span style={{ color: STATUS_COLOR.ok }}>●</span> OK</span>
            <span><span style={{ color: STATUS_COLOR.warn }}>●</span> WARN</span>
            <span><span style={{ color: STATUS_COLOR.err }}>●</span> ERR</span>
          </div>
        </Tile>

        {/* LLM inference */}
        <Tile title="LLM inference">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Calls (lifetime)" value={cost.totalCalls} />
            <Stat label="Cost last run" value={`$${cost.lastRunUsd.toFixed(3)}`} />
            <Stat label="Cost cumulative" value={`$${cost.cumulativeUsd.toFixed(3)}`} />
          </div>
          <p className="text-xs text-gray-500 mt-3">Model: <code>claude-sonnet-4-6</code> — chosen over Haiku; cost difference &lt;$0.03 at this scale, accuracy the deciding factor.</p>
        </Tile>
      </div>

      {/* Inferred-age visibility */}
      <div className="mt-4">
        <Tile title="Play Frisco — inferred-age visibility">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['~ Family ✦ shown', vis.family],
              ['✦ only shown', vis.specific],
              ['Nothing shown (low conf.)', vis.nothing],
              ['Hidden (not kid-relevant)', vis.hidden],
            ].map(([label, n]) => (
              <div key={label as string}>
                <div className="text-2xl font-bold">{n as number} <span className="text-sm font-normal text-gray-500">{pct(n as number, vis.total)}</span></div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">{vis.total} Play Frisco events · buckets sum to 100%.</p>
        </Tile>
      </div>

      {/* Ingest log */}
      <div className="mt-4">
        <Tile title="Ingest log — last 7 runs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="py-2 pr-3">When</th><th className="pr-3">Status</th><th className="pr-3">Frisco</th><th className="pr-3">Plano</th><th className="pr-3">Play&nbsp;Frisco</th><th className="pr-3">Upserted</th><th className="pr-3">LLM</th><th className="pr-3">Cost</th><th className="pr-3">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 7).map(r => (
                  <tr key={r.id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(r.ran_at)}</td>
                    <td className="pr-3 font-medium" style={{ color: STATUS_COLOR[r.status] }}>{r.status.toUpperCase()}</td>
                    <td className="pr-3">{r.frisco_fetched}</td>
                    <td className="pr-3">{r.plano_fetched}</td>
                    <td className="pr-3">{r.play_frisco_fetched}</td>
                    <td className="pr-3">{r.total_upserted}</td>
                    <td className="pr-3">{r.llm_calls}</td>
                    <td className="pr-3">${(r.llm_cost_usd ?? 0).toFixed(3)}</td>
                    <td className="pr-3 whitespace-nowrap">{(r.duration_ms / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr><td colSpan={9} className="py-3 text-gray-500">No runs recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Tile>
      </div>
    </main>
  )
}
