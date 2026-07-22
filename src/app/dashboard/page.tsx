import { supabaseAdmin } from '@/lib/supabase'
import { fetchAnalyticsRows } from '@/lib/bigquery'
import {
  inferredAgeVisibility, inferredPriceVisibility, lastIngest, ingestHistory, llmCost, type IngestRun,
} from '@/lib/technical-metrics'
import {
  weeklyActiveDiscoverers, computeFunnel, returnVisitRate, referral, topEvents,
  conversionActionBreakdown, filterUsage,
} from '@/lib/measurement'
import type { Event } from '@/lib/types'
import DashboardTabs from './DashboardTabs'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const db = supabaseAdmin()

  // ---- Technical (Supabase) ----
  const [total, frisco, plano, pf, free, paid, unknown, pfEventsRes, runsRes] = await Promise.all([
    db.from('events').select('*', { count: 'exact', head: true }),
    db.from('events').select('*', { count: 'exact', head: true }).eq('source', 'frisco-library'),
    db.from('events').select('*', { count: 'exact', head: true }).eq('source', 'plano-library'),
    db.from('events').select('*', { count: 'exact', head: true }).eq('source', 'play-frisco'),
    db.from('events').select('*', { count: 'exact', head: true }).eq('is_free', true),
    db.from('events').select('*', { count: 'exact', head: true }).eq('is_free', false),
    db.from('events').select('*', { count: 'exact', head: true }).is('is_free', null),
    db.from('events').select('source, is_free, kid_relevant, age_buckets, age_confidence, price_class, price_confidence').eq('source', 'play-frisco'),
    db.from('ingest_runs').select('*').order('ran_at', { ascending: false }).limit(30),
  ])
  const pfEvents = (pfEventsRes.data ?? []) as unknown as Event[]
  const runs = (runsRes.data ?? []) as unknown as IngestRun[]

  const technical = {
    lastIngest: lastIngest(runs),
    totalEvents: total.count ?? 0,
    counts: {
      bySource: [
        { source: 'frisco-library', total: frisco.count ?? 0 },
        { source: 'plano-library', total: plano.count ?? 0 },
        { source: 'play-frisco', total: pf.count ?? 0 },
      ],
      free: free.count ?? 0, paid: paid.count ?? 0, unknown: unknown.count ?? 0,
    },
    ageVis: inferredAgeVisibility(pfEvents),
    priceVis: inferredPriceVisibility(pfEvents),
    history: ingestHistory(runs, new Date().toISOString().slice(0, 10), 14),
    cost: llmCost(runs),
    runs,
  }

  // ---- Functional (BigQuery) ----
  const fetched = await fetchAnalyticsRows()
  const rows = fetched.rows
  const wadSeries = weeklyActiveDiscoverers(rows)
  const top = topEvents(rows, 10)
  const topIds = top.map(t => t.event_id)
  const nameById: Record<string, { title: string; source: string }> = {}
  if (topIds.length) {
    const { data } = await db.from('events').select('id, title, source').in('id', topIds)
    for (const e of (data ?? []) as { id: string; title: string; source: string }[]) nameById[e.id] = { title: e.title, source: e.source }
  }

  const functional = {
    status: fetched.status,
    message: fetched.message,
    rowCount: rows.length,
    wadSeries,
    funnel: computeFunnel(rows),
    returnRate: wadSeries.length >= 2 ? returnVisitRate(rows, wadSeries[0].week) : null,
    referral: referral(rows),
    top: top.map(t => ({ ...t, ...(nameById[t.event_id] ?? {}) })),
    actions: conversionActionBreakdown(rows),
    filters: filterUsage(rows),
  }

  return <DashboardTabs technical={technical} functional={functional} />
}
