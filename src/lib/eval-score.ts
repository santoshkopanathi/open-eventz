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

export interface GateResult { name: string; pass: boolean; detail: string }

/**
 * `baseline` is the last run a human accepted. Over-claim is gated on NOT INCREASING rather
 * than on zero: every wrongly-free begins as an over-claim that resolved badly, so it is the
 * leading indicator — but forcing it to zero means badging nothing, which buys a safety number
 * with a useless product. Under-claim is reported alongside so that trade stays visible.
 */
export function gates(now: Counts, baseline: Counts | null): GateResult[] {
  const out: GateResult[] = [
    {
      name: 'wrongly-free',
      pass: now.wronglyFree === 0,
      detail: `${now.wronglyFree} (must be 0)`,
    },
    {
      name: 'leaked non-kid events',
      pass: now.leaked === 0,
      detail: `${now.leaked} (must be 0)`,
    },
  ]
  if (baseline) {
    out.push({
      name: 'over-claim',
      pass: now.overClaim <= baseline.overClaim,
      detail: `${now.overClaim} vs baseline ${baseline.overClaim} (must not increase)`,
    })
  }
  return out
}
