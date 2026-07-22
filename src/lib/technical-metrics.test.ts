import type { Event } from './types'
import {
  perSourceCounts,
  inferredAgeVisibility,
  inferredPriceVisibility,
  lastIngest,
  ingestHistory,
  llmCost,
  type IngestRun,
} from './technical-metrics'

// Minimal event rows (only the fields the metrics read).
function ev(p: Partial<Event>): Event {
  return {
    id: 'e', source: 'play-frisco', title: '', description: null,
    start_datetime: '', end_datetime: null, location_name: null, location_address: null,
    location_lat: null, location_lng: null, is_free: null, price_text: null,
    age_min: null, age_max: null, age_label: null, is_recurring: false, recurrence_label: null,
    thumbnail_url: null, event_url: '', category: null, registration_required: false,
    kid_relevant: null, age_buckets: null, age_confidence: null, age_reasoning: null,
    price_class: null, price_confidence: null, price_reasoning: null,
    ingested_at: '', created_at: '',
    ...p,
  }
}

const EVENTS: Event[] = [
  ev({ source: 'frisco-library', is_free: true }),
  ev({ source: 'plano-library', is_free: true }),
  ev({ source: 'play-frisco', is_free: true, kid_relevant: true, age_confidence: 'high', age_buckets: ['family'] }),   // family
  ev({ source: 'play-frisco', is_free: false, kid_relevant: true, age_confidence: 'high', age_buckets: ['teen'] }),    // specific
  ev({ source: 'play-frisco', is_free: null, kid_relevant: true, age_confidence: 'low', age_buckets: ['family'] }),    // nothing (low conf)
  ev({ source: 'play-frisco', is_free: null, kid_relevant: false }),                                                    // hidden
]

describe('perSourceCounts', () => {
  test('per-source totals + free/paid/unknown', () => {
    const c = perSourceCounts(EVENTS)
    expect(c.bySource).toEqual([
      { source: 'frisco-library', total: 1 },
      { source: 'plano-library', total: 1 },
      { source: 'play-frisco', total: 4 },
    ])
    expect(c.free).toBe(3)     // 2 library + 1 PF free
    expect(c.paid).toBe(1)     // 1 PF paid
    expect(c.unknown).toBe(2)  // 2 PF null
  })
})

describe('inferredAgeVisibility', () => {
  test('4 buckets sum to the Play Frisco total', () => {
    const v = inferredAgeVisibility(EVENTS)
    expect(v).toEqual({ family: 1, specific: 1, nothing: 1, hidden: 1, total: 4 })
    expect(v.family + v.specific + v.nothing + v.hidden).toBe(v.total)
  })
})

describe('inferredPriceVisibility', () => {
  test('splits Play Frisco price by confirmed (Cost field) vs inferred (✦), + unknown', () => {
    const pf: Event[] = [
      ev({ source: 'play-frisco', price_class: 'free', price_confidence: 'inferred' }),
      ev({ source: 'play-frisco', price_class: 'free', price_confidence: 'confirmed' }),
      ev({ source: 'play-frisco', price_class: 'paid', price_confidence: 'inferred' }),
      ev({ source: 'play-frisco', price_class: 'paid', price_confidence: 'confirmed' }),
      ev({ source: 'play-frisco', price_class: 'unknown', price_confidence: 'inferred' }),
      ev({ source: 'frisco-library', is_free: true }), // not Play Frisco → ignored
    ]
    expect(inferredPriceVisibility(pf)).toEqual({
      freeConfirmed: 1, freeInferred: 1, paidConfirmed: 1, paidInferred: 1, unknown: 1, total: 5,
    })
  })
})

const RUNS: IngestRun[] = [
  { id: 'r1', ran_at: '2026-07-20T10:00:00Z', duration_ms: 5000, status: 'ok', frisco_fetched: 40, plano_fetched: 30, play_frisco_fetched: 20, total_upserted: 90, llm_calls: 5, llm_cost_usd: 0.03, errors: [] },
  { id: 'r2', ran_at: '2026-07-21T09:00:00Z', duration_ms: 6000, status: 'warn', frisco_fetched: 41, plano_fetched: 30, play_frisco_fetched: 20, total_upserted: 91, llm_calls: 2, llm_cost_usd: 0.012, errors: ['play-frisco EID 7: HTTP 500'] },
]

describe('lastIngest', () => {
  test('returns the most recent run', () => {
    expect(lastIngest(RUNS)?.id).toBe('r2')
    expect(lastIngest([])).toBeNull()
  })
})

describe('llmCost', () => {
  test('last-run, cumulative, and total calls', () => {
    const c = llmCost(RUNS)
    expect(c.lastRunUsd).toBe(0.012)
    expect(c.totalCalls).toBe(7)
    expect(c.cumulativeUsd).toBeCloseTo(0.042, 5)
  })
})

describe('ingestHistory', () => {
  test('14 days ending today, worst status per day, none where no run', () => {
    const h = ingestHistory(RUNS, '2026-07-21', 14)
    expect(h).toHaveLength(14)
    expect(h[h.length - 1]).toEqual({ date: '2026-07-21', status: 'warn' })
    expect(h[h.length - 2]).toEqual({ date: '2026-07-20', status: 'ok' })
    expect(h[0].status).toBe('none') // 14 days ago, no run
  })
})
