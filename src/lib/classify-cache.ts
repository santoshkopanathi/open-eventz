/*
 * CACHE HIT — carry a stored classification forward onto tonight's copy of an event.
 *
 * The classification cache stores the model's JUDGMENT (kid relevance, age, price). Everything
 * else about the event is re-read from the source every night, which is why a cached event still
 * goes through the batch, the pre-write guard and the purge.
 *
 * THE BUG THIS FIXES (found 2026-11-20 while documenting the ingest decision map). The cache-hit
 * branch copied the stored price over tonight's value unconditionally. But a price can be LOCKED
 * before the model ever runs: a structured `Cost:` field on a Play Frisco page, or Kaleidoscope's
 * machine-readable "this is free". Those are the source stating the price, and they are meant to
 * win outright. On a cached event they lost. A known event that gained "Cost: $35" kept its old
 * "Free ✦" — the error a parent feels at the door.
 *
 * So: the judgment fields always come from the cache; the price fields come from the cache only
 * when tonight's price is not locked.
 *
 * Deliberately NOT done here: noticing that a description changed. The cache is keyed by event
 * id, so a rewritten description is still not re-classified. Tracked in OPEN-ITEMS.md.
 */

/** The stored columns a cache hit can carry forward. */
export interface CachedClassification {
  kid_relevant: boolean | null
  kid_confidence: unknown
  age_buckets: unknown
  age_basis: unknown
  age_confidence: unknown
  age_reasoning: unknown
  price_class: unknown
  price_confidence: unknown
  price_decided_by: unknown
  price_reasoning: unknown
  is_free: unknown
  price_text: unknown
}

/** A cache hit means the stored row holds a real decision (see classify-skip.test.ts). */
export function isCacheHit(prior: Pick<CachedClassification, 'kid_relevant'> | undefined | null): boolean {
  return !!prior && prior.kid_relevant !== null
}

/**
 * Copy the stored judgment onto `e` (mutates). When `priceLocked` is true, tonight's price —
 * already set on `e` from the source — is kept instead of the stored one.
 */
export function applyCachedClassification(
  e: Record<string, unknown>,
  prior: CachedClassification,
  priceLocked: boolean,
): void {
  e.kid_relevant = prior.kid_relevant
  e.kid_confidence = prior.kid_confidence
  e.age_buckets = prior.age_buckets
  e.age_basis = prior.age_basis
  e.age_confidence = prior.age_confidence
  e.age_reasoning = prior.age_reasoning
  if (priceLocked) return
  e.price_class = prior.price_class
  e.price_confidence = prior.price_confidence
  e.price_decided_by = prior.price_decided_by
  e.price_reasoning = prior.price_reasoning
  e.is_free = prior.is_free
  e.price_text = prior.price_text
}
