-- Enable Row Level Security on the PostgREST-exposed tables (security hardening).
-- Run in the Supabase SQL Editor. Applied 2026-07-23 to clear three "RLS Disabled in
-- Public / Critical" advisories from the Supabase linter.
--
-- Why: the anon key is public (it ships in the site's client bundle). With RLS off,
-- anyone holding it could read AND write these tables directly via the auto-generated
-- REST API, bypassing the app. RLS closes that. The service-role key (used server-side
-- for ingest, the likes API, and the dashboard) BYPASSES RLS, so those paths keep working.
--
-- Access model this enforces (least privilege):
--   events               → public may READ only  (writes are service-role: ingest)
--   like_counts          → NO public access      (read+write only via service role: /api/likes)
--   supervision_policies → NO public access       (not queried by the app today)
--
-- Verified after applying: /api/events (1000), /api/venues (7), /sitemap.xml (721),
-- /api/likes/* (200), /dashboard (200) all still work in production.

-- events: the anon key (used by the events/venues/branches APIs and the SEO data layer)
-- must still be able to SELECT. Writes have no policy, so anon cannot insert/update/delete.
alter table public.events enable row level security;
create policy "events_public_read"
  on public.events for select
  to anon
  using (true);

-- like_counts: only ever touched by the service role (POST/GET /api/likes). No anon policy
-- → the anon key is fully denied; the service role bypasses RLS so the app is unaffected.
alter table public.like_counts enable row level security;

-- supervision_policies: reference data not queried by the client. Locked (no policy).
-- If it is ever read via the anon key, add a matching "for select to anon using (true)" policy.
alter table public.supervision_policies enable row level security;
