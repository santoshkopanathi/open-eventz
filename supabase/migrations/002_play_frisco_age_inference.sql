-- Play Frisco LLM age inference columns (v1.1)
-- Run this in the Supabase SQL Editor before running the updated ingest.
-- These columns are only populated for Play Frisco (CivicPlus) events, which
-- have no structured age data. Library events (Frisco/Plano) leave them null.

alter table events
  add column if not exists kid_relevant  boolean,
  add column if not exists age_buckets   text[],
  add column if not exists age_confidence text,
  add column if not exists age_reasoning  text;

-- Hard gate on the events API queries WHERE kid_relevant IS NULL OR kid_relevant = true,
-- so an index on kid_relevant helps that predicate.
create index if not exists idx_events_kid_relevant on events (kid_relevant);
