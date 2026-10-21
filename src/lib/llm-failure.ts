// Telling apart the reasons a model call fails — pure, no I/O.
//
// WHY (2026-10-21). The nightly classification started failing on every event. In the log it
// looked exactly like a model problem: a line per event saying inference failed. The actual
// cause was the Anthropic credit balance reaching zero, which is a 30-second fix in a billing
// page — but nothing in the output said so, and the pipeline's fail-closed design meant the
// visible symptom was simply "some events are missing".
//
// The classes below differ in WHO fixes them and HOW FAST, which is the only distinction an
// operator needs at 6am:
//
//   billing      nobody is coming; the pipeline degrades until a human adds credit
//   auth         same, and usually means a rotated or wrong key
//   rate-limit   transient; the next run very likely succeeds
//   overloaded   transient; upstream capacity
//   other        a genuine model/parsing problem, worth reading
//
// This matters again on a schedule: promotional credit on this account expires 2026-11-18,
// after which the balance falls back to auto-reload. If that handover misfires, this is the
// failure that returns.

export type LlmFailureKind = 'billing' | 'auth' | 'rate-limit' | 'overloaded' | 'other'

/**
 * Classify a failed model call from its error text (the SDK puts the HTTP status and the JSON
 * body into the message). Matching is on the provider's wording, so an unrecognised message
 * falls through to 'other' — a wrong guess about WHY it failed would be worse than no guess.
 */
export function classifyLlmFailure(message: string): LlmFailureKind {
  const m = (message ?? '').toLowerCase()
  if (/credit balance is too low|insufficient (?:funds|credit|balance)|payment required|\b402\b|billing/.test(m)) return 'billing'
  if (/invalid x-api-key|authentication_error|invalid api key|unauthorized|\b401\b|permission_error/.test(m)) return 'auth'
  if (/rate_limit|rate limit|too many requests|\b429\b/.test(m)) return 'rate-limit'
  if (/overloaded|\b529\b|\b503\b/.test(m)) return 'overloaded'
  return 'other'
}

/** True when retrying tonight is pointless — a human must act first. */
export function needsHuman(kind: LlmFailureKind): boolean {
  return kind === 'billing' || kind === 'auth'
}

/** One line for the run record and the alert email: what happened, and what to do about it. */
export function describeLlmFailure(kind: LlmFailureKind, source: string, heldBack: number): string {
  const held = `${heldBack} event(s) were held back rather than published unclassified`
  switch (kind) {
    case 'billing':
      return `llm-billing (${source}): the Anthropic credit balance is exhausted — classification stopped and ${held}. This is a billing fix, not a data problem: console.anthropic.com/settings/billing.`
    case 'auth':
      return `llm-auth (${source}): the Anthropic API key was rejected — classification stopped and ${held}. Check ANTHROPIC_API_KEY locally and in the GitHub Production environment secret.`
    case 'rate-limit':
      return `llm-rate-limit (${source}): rate limited by the API; ${held}. Transient — the next run should recover.`
    case 'overloaded':
      return `llm-overloaded (${source}): the API was overloaded; ${held}. Transient — the next run should recover.`
    default:
      return `llm-failure (${source}): model calls failed; ${held}. Check the per-event errors above.`
  }
}
