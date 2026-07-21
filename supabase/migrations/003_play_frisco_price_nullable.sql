-- Play Frisco price inference — free-by-default with raw classification storage (v1.2)
-- Run this in the Supabase SQL Editor before running the updated ingest.
--
-- Two changes:
-- 1) is_free becomes nullable. It is now a DERIVED display field:
--      true  = free   (green "Free" / "Free ✦" badge)
--      false = paid   (amber "Paid" badge)
--      null  = unknown (no badge)
--    is_free is derived from price_class so the events API can still filter on it.
--
-- 2) Store the RAW price classification separately (Layer 5), so the free-by-default
--    policy can be re-derived WITHOUT re-running the LLM, and exposure ("how many
--    events show Free purely by assumption") is always queryable:
--      price_class      'free' | 'paid' | 'unknown'  — the resolved class (post Layers 2/3)
--      price_confidence 'confirmed' | 'inferred'     — confirmed = explicit signal in text;
--                                                       inferred = free-by-default (renders "Free ✦")
--      price_reasoning  text                          — the LLM's one-line rationale
--    These are populated for Play Frisco only; library sources leave them null and stay
--    hardcoded is_free = true by institutional default.

alter table events
  alter column is_free drop not null;

alter table events
  add column if not exists price_class      text,
  add column if not exists price_confidence text,
  add column if not exists price_reasoning  text;

-- Exposure query: count Play Frisco events currently showing Free purely by assumption
-- (this is the number the Technical dashboard surfaces).
--   select count(*) from events
--   where source = 'play-frisco' and price_class = 'free' and price_confidence = 'inferred';

-- OPTIONAL — re-price existing Play Frisco events under the new policy.
-- Clearing the inference forces the next ingest to treat these as new (cache miss),
-- which re-runs the LLM (age + price) and overwrites the old price. Library events are
-- untouched (is_free stays true by institutional default).
--
--   update events
--     set kid_relevant = null,
--         age_buckets = null,
--         age_confidence = null,
--         age_reasoning = null
--     where source = 'play-frisco';
