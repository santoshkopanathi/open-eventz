-- Ingest run history (v1.2 analytics — Technical dashboard)
-- Run this in the Supabase SQL Editor. One row per ingest run; the POST /api/ingest
-- handler writes a row at the end of each run. Powers the Technical dashboard's
-- ingest pipeline status, 14-day history, LLM cost, and last-7-runs log.

create table if not exists ingest_runs (
  id                  uuid primary key default gen_random_uuid(),
  ran_at              timestamptz not null default now(),
  duration_ms         integer     not null,
  status              text        not null,          -- 'ok' | 'warn' | 'err'
  frisco_fetched      integer     not null default 0,
  plano_fetched       integer     not null default 0,
  play_frisco_fetched integer     not null default 0,
  total_upserted      integer     not null default 0,
  llm_calls           integer     not null default 0,  -- new Play Frisco inferences this run
  llm_cost_usd        numeric(10,4) not null default 0, -- llm_calls * per-call estimate
  errors              jsonb       not null default '[]'::jsonb
);

-- The dashboard reads the most recent runs; index the sort key.
create index if not exists idx_ingest_runs_ran_at on ingest_runs (ran_at desc);
