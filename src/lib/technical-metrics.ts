import type { Event, EventSource } from './types'
import { getAgeBadge } from './age-badge'

// Technical dashboard metrics (v1.2 analytics spec, Part 1). Pure functions over Supabase
// data — the /dashboard route fetches events + ingest_runs and calls these; tests use fixtures.

// Documented estimate: Sonnet inference ~1.5k tokens/call. Cost is llm_calls * this constant.
// (Model rationale: Sonnet over Haiku — accuracy is the load-bearing factor; see BUILD-LOG.)
export const PER_INFERENCE_COST_USD = 0.006

export interface IngestRun {
  id: string
  ran_at: string
  duration_ms: number
  status: 'ok' | 'warn' | 'err'
  frisco_fetched: number
  plano_fetched: number
  play_frisco_fetched: number
  total_upserted: number
  llm_calls: number
  llm_cost_usd: number
  errors: string[]
}

// The event fields these metrics need (a subset of Event).
type EventRow = Pick<Event, 'source' | 'is_free' | 'kid_relevant' | 'age_buckets' | 'age_confidence'>

// ---------------------------------------------------------------------------
// Per-source event counts + free / paid / unknown totals (across all sources).
// price bucket: is_free true = free, false = paid, null = unknown.
// ---------------------------------------------------------------------------
export interface SourceCount { source: EventSource; total: number }

export function perSourceCounts(events: EventRow[]): {
  bySource: SourceCount[]
  free: number
  paid: number
  unknown: number
} {
  const sources: EventSource[] = ['frisco-library', 'plano-library', 'play-frisco']
  const bySource = sources.map(source => ({ source, total: events.filter(e => e.source === source).length }))
  let free = 0, paid = 0, unknown = 0
  for (const e of events) {
    if (e.is_free === true) free++
    else if (e.is_free === false) paid++
    else unknown++
  }
  return { bySource, free, paid, unknown }
}

// ---------------------------------------------------------------------------
// Play Frisco — inferred-age visibility. Four buckets that must sum to the total:
//   family   — "~ Family ✦" (appears under every age filter)
//   specific — "✦" only (inferred specific age)
//   nothing  — kid-relevant but low confidence → no badge, invisible to age filters
//   hidden   — not kid-relevant → excluded from all views
// ---------------------------------------------------------------------------
export interface AgeVisibility { family: number; specific: number; nothing: number; hidden: number; total: number }

export function inferredAgeVisibility(events: EventRow[]): AgeVisibility {
  const pf = events.filter(e => e.source === 'play-frisco')
  let family = 0, specific = 0, nothing = 0, hidden = 0
  for (const e of pf) {
    if (e.kid_relevant === false) { hidden++; continue }
    // getAgeBadge returns null for low-confidence / no-bucket inferred events.
    const badge = getAgeBadge(e as Event)
    if (badge?.kind === 'inferred-family') family++
    else if (badge?.kind === 'inferred-specific') specific++
    else nothing++
  }
  return { family, specific, nothing, hidden, total: pf.length }
}

// ---------------------------------------------------------------------------
// Ingest pipeline — the latest run, or null if none yet.
// ---------------------------------------------------------------------------
export function lastIngest(runs: IngestRun[]): IngestRun | null {
  if (runs.length === 0) return null
  return [...runs].sort((a, b) => b.ran_at.localeCompare(a.ran_at))[0]
}

// ---------------------------------------------------------------------------
// Ingest history — status per day for the last `days` days (most recent last).
// A day with multiple runs takes its worst status (err > warn > ok); no run → 'none'.
// ---------------------------------------------------------------------------
const RANK: Record<string, number> = { none: 0, ok: 1, warn: 2, err: 3 }
const RANK_INV = ['none', 'ok', 'warn', 'err'] as const

export function ingestHistory(runs: IngestRun[], todayISODate: string, days = 14): { date: string; status: 'none' | 'ok' | 'warn' | 'err' }[] {
  const worstByDate = new Map<string, number>()
  for (const r of runs) {
    const d = r.ran_at.slice(0, 10)
    worstByDate.set(d, Math.max(worstByDate.get(d) ?? 0, RANK[r.status] ?? 0))
  }
  const out: { date: string; status: 'none' | 'ok' | 'warn' | 'err' }[] = []
  const todayMs = Date.parse(`${todayISODate}T00:00:00Z`)
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10)
    out.push({ date, status: RANK_INV[worstByDate.get(date) ?? 0] })
  }
  return out
}

// ---------------------------------------------------------------------------
// LLM inference — last-run cost, cumulative cost, and lifetime call count.
// ---------------------------------------------------------------------------
export function llmCost(runs: IngestRun[]): { lastRunUsd: number; cumulativeUsd: number; totalCalls: number } {
  const last = lastIngest(runs)
  return {
    lastRunUsd: last?.llm_cost_usd ?? 0,
    cumulativeUsd: runs.reduce((s, r) => s + (r.llm_cost_usd ?? 0), 0),
    totalCalls: runs.reduce((s, r) => s + (r.llm_calls ?? 0), 0),
  }
}
