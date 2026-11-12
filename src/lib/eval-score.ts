/*
 * SCORING — counts by direction, never an accuracy rate.
 *
 * Two reasons there is no single number here.
 *
 * 1. The sample is small. At ~64 events one event is 1.5%, so any rate moves on a coin flip
 *    and a "4% error rate" is two events going either way. Small samples can answer existence
 *    questions, not rate questions — so the gates are on existence and on direction.
 * 2. The failures have different costs. Showing Free on a paid event sends a family out with
 *    no money; asserting a price the text never gave is usually harmless. Averaging them into
 *    one score deletes exactly the information a decision needs.
 */
export interface ScorableRow {
  id: string
  title: string
  label_kid: string | null
  label_price: string | null
  shipped: { price_class: string; price_confidence: string; shown: boolean } | null
  error: string | null
}

export interface Counts {
  scored: number
  /** We showed Free; a human said paid. The harm case. */
  wronglyFree: number
  /** We asserted a price a human could not determine from the text. Leading indicator. */
  overClaim: number
  /** We showed nothing where the text did state a price. The cost of being cautious. */
  underClaim: number
  agree: number
  badged: number
  /** We showed an event a human said was not for children. */
  leaked: number
  wronglyHidden: number
  /** No decision was made. Never counted as agreement — see inferPlayFriscoEvent's null. */
  errors: number
}

export function tally(rows: ScorableRow[]): Counts {
  const c: Counts = {
    scored: 0, wronglyFree: 0, overClaim: 0, underClaim: 0, agree: 0,
    badged: 0, leaked: 0, wronglyHidden: 0, errors: 0,
  }
  for (const r of rows) {
    // A row with no decision is an error, not a quiet pass. Treating null as agreement is how
    // an outage would read as a perfect score.
    if (r.error || !r.shipped) { c.errors++; continue }
    c.scored++

    if (r.label_price) {
      // Only a definite free/paid puts a badge on the card; 'unknown' shows nothing at all.
      const badged = r.shipped.price_class === 'free' || r.shipped.price_class === 'paid'
      if (badged) {
        c.badged++
        if (r.label_price === 'unknown') c.overClaim++
        else if (r.label_price === r.shipped.price_class) c.agree++
        if (r.label_price === 'paid' && r.shipped.price_class === 'free') c.wronglyFree++
      } else if (r.label_price !== 'unknown') {
        c.underClaim++
      }
    }

    if (r.label_kid === 'no' && r.shipped.shown) c.leaked++
    if (r.label_kid === 'yes' && !r.shipped.shown) c.wronglyHidden++
  }
  return c
}

/**
 * The measured run-to-run spread of the over-claim count on an unchanged set (4 runs,
 * 2026-11-12). Re-measure it when the set size changes materially — it is a property of this
 * set and this model, not a constant.
 */
export const NOISE_FLOOR = 2

export interface GateResult {
  name: string
  pass: boolean
  detail: string
  /** false when the gate could not be evaluated against the baseline at all. */
  comparable?: boolean
  /**
   * Whether a failure here should stop a build. Only metrics MEASURED to be stable across
   * repeated runs may block — see gates() for the measurement and why over-claim does not.
   */
  blocking: boolean
}

/**
 * `baseline` is the last run a human accepted.
 *
 * WHICH METRICS MAY BLOCK A BUILD — decided by measurement, 2026-11-12. Four consecutive runs
 * over the same 65 events, same prompt, same model, nothing changed:
 *
 *     wrongly-free     0, 0, 0, 0     stable
 *     leaked           0, 0, 0, 0     stable
 *     agree           42,42,42,42     stable
 *     under-claim      1, 1, 1, 1     stable
 *     wrongly-hidden   2, 2, 2, 2     stable
 *     over-claim      16,18,18,17     ±2
 *
 * Only two events of the 65 are unstable, and both are the same borderline: an artist-led
 * workshop the model oscillates between `unknown` and `paid` on.
 *
 * **The existence gates are perfectly stable, which is why they block.** That is the
 * "gate on existence, not rate" principle with evidence behind it rather than an argument:
 * asking whether a specific named event was ever shown as free does not depend on sampling
 * luck, and the measurement says it does not depend on model sampling either.
 *
 * **Over-claim does NOT block, because its natural spread is ±2.** A "must not increase" rule
 * against a count that moves by 2 on its own would fail roughly half of all clean runs, and a
 * gate that cries wolf is routed around within a week — the same reasoning that keeps this
 * whole suite off the per-push trigger. It stays reported, with the direction against
 * baseline, because it is still the leading indicator for wrongly-free; it simply cannot carry
 * a build decision at this sample size. The honest statement of the limit: **this set can
 * detect an over-claim regression larger than 2, and nothing smaller.**
 *
 * Under-claim and wrongly-hidden are also reported, so nobody can buy a safety number by
 * badging nothing or hiding everything.
 */
export function gates(now: Counts, baseline: Counts | null): GateResult[] {
  const out: GateResult[] = [
    {
      name: 'wrongly-free',
      pass: now.wronglyFree === 0,
      detail: `${now.wronglyFree} (must be 0)`,
      blocking: true,
    },
    {
      name: 'leaked non-kid events',
      pass: now.leaked === 0,
      detail: `${now.leaked} (must be 0)`,
      blocking: true,
    },
  ]
  if (baseline) {
    // A count gate is only meaningful against the same population. When the scored set has
    // changed size the two numbers are not comparable, so the gate reports NOT COMPARABLE
    // instead of a regression — and it does not pass either, because silently passing would
    // let a real regression hide inside a set change. A human re-accepts the baseline.
    if (now.scored !== baseline.scored) {
      out.push({
        name: 'over-claim',
        pass: false,
        comparable: false,
        blocking: false,
        detail:
          `${now.overClaim} on ${now.scored} events vs baseline ${baseline.overClaim} on ${baseline.scored} — ` +
          'NOT COMPARABLE, the set changed size. Re-accept with --accept.',
      })
    } else {
      // Reported, never blocking: the measured spread is ±2. See the note above.
      const delta = now.overClaim - baseline.overClaim
      out.push({
        name: 'over-claim',
        pass: delta <= NOISE_FLOOR,
        blocking: false,
        detail:
          `${now.overClaim} vs baseline ${baseline.overClaim} (${delta >= 0 ? '+' : ''}${delta}); ` +
          `measured run-to-run spread is ±${NOISE_FLOOR}, so only a rise above that means anything`,
      })
    }
  }
  return out
}

/**
 * Rows worth a second call before the build is failed, because the model is non-deterministic
 * and a single bad roll must not be indistinguishable from a regression.
 *
 * Deliberately NARROW: errors, and the two blocking-gate offenders. **Over-claim rows are not
 * retried**, and that asymmetry is the point.
 *
 *   - wrongly-free and leaked are EXISTENCE gates on a specific event. Asking the same event
 *     twice answers a sharper question — "does this reproduce?" — and a reproduced failure is
 *     a real one.
 *   - over-claim is a COUNT compared against a baseline. Re-rolling only the events that
 *     pushed the count up is a biased resample: it can lower the number and never raise it, so
 *     a retry there would be a mechanism for passing rather than for measuring.
 *
 * In short: retry to confirm a specific failure, never to improve an aggregate.
 */
export function rowsWorthRetrying(rows: ScorableRow[]): string[] {
  return rows
    .filter(r =>
      r.error ||
      !r.shipped ||
      (r.label_price === 'paid' && r.shipped.price_class === 'free') ||
      (r.label_kid === 'no' && r.shipped.shown))
    .map(r => r.id)
}
