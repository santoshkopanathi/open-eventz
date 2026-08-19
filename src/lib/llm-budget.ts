import { PER_INFERENCE_COST_USD } from './technical-metrics'

// A hard ceiling on paid LLM calls per ingest run.
//
// WHY THIS EXISTS. Classification cost scales with the number of *new* events, not with users —
// it is nightly, batched, and cached, so a re-run of an unchanged source costs zero calls. That
// bounds normal spend to pennies. What it does NOT bound is an anomaly: a source that suddenly
// returns 10,000 events (a changed API default, a pagination bug, a date-window mistake) would
// be classified in full, at our expense, with nothing to stop it. The governance review scored
// this the only fully-missing instrument and the only open economic risk.
//
// The cap is deliberately set far above normal volume, so tripping it means "something is wrong",
// not "we are busy". Normal runs: Play Frisco ~30 events, Kaleidoscope ~100, and both are ~0 on a
// re-run because results are cached.
//
// RAISING IT IS A DELIBERATE ACT, like INGEST_ALLOW_TIME_SHIFT. If a source legitimately grows
// past the ceiling, set MAX_LLM_CALLS_PER_RUN explicitly — that is a human accepting a new normal,
// not a limit quietly sliding.

export const DEFAULT_MAX_LLM_CALLS_PER_RUN = 300

/** Resolve the per-run call ceiling from the environment, falling back to the default. */
export function resolveLlmCallCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MAX_LLM_CALLS_PER_RUN
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_LLM_CALLS_PER_RUN
  const n = Number(raw)
  // A malformed or nonsensical value must not silently disable the cap.
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_LLM_CALLS_PER_RUN
  return Math.floor(n)
}

/** Rough spend for a call count. Estimate, not metered — see GUARDRAILS.md. */
export function estimateCostUsd(calls: number): number {
  return Number((calls * PER_INFERENCE_COST_USD).toFixed(4))
}

export interface LlmBudget {
  /** True while another paid call is allowed. */
  canSpend(): boolean
  /** Record one paid call. Returns false if the cap was already reached (call NOT allowed). */
  spend(): boolean
  /** Calls consumed so far. */
  used(): number
  /** The ceiling in force. */
  cap(): number
  /** True once a call has been refused — i.e. the run hit the ceiling. */
  wasCapped(): boolean
  /** Human-readable summary for run records and logs. */
  describe(): string
}

/**
 * A per-run spend counter. Deliberately a tiny object rather than a module-level global so each
 * ingest run gets its own, and so it is trivially unit-testable.
 */
export function createLlmBudget(cap: number = resolveLlmCallCap()): LlmBudget {
  let used = 0
  let capped = false

  return {
    canSpend: () => used < cap,
    spend() {
      if (used >= cap) { capped = true; return false }
      used++
      return true
    },
    used: () => used,
    cap: () => cap,
    wasCapped: () => capped,
    describe: () =>
      `${used}/${cap} LLM calls (~$${estimateCostUsd(used).toFixed(2)} est.)` +
      (capped ? ' — CAP REACHED, remaining events hidden (fail-closed)' : ''),
  }
}
