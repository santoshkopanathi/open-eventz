-- Enable RLS on ingest_runs — the PostgREST-exposed table missed by migration 005.
-- Run in the Supabase SQL Editor. Clears a "rls_disabled_in_public / Critical" advisory
-- (reported by Supabase 2026-07-26).
--
-- Why it was missed: migration 004 created ingest_runs but did not enable RLS, and
-- migration 005 only covered the three tables the linter had flagged at that time
-- (events, like_counts, supervision_policies). An earlier BUILD-LOG note incorrectly
-- implied ingest_runs already had RLS; this migration is the real fix.
--
-- Access model: ingest_runs is written only by POST /api/ingest and read only by the
-- /dashboard route, both via the SERVICE ROLE (supabaseAdmin), which BYPASSES RLS. The
-- anon key never touches it — so enabling RLS with NO policy locks it to the public
-- while the app keeps working (same posture as like_counts).

alter table public.ingest_runs enable row level security;
