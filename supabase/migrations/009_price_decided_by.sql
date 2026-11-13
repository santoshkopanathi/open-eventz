-- price_decided_by: WHICH LAYER settled this event's price (v1.5)
-- Run this in the Supabase SQL Editor BEFORE deploying the change.
--
-- WHY. `price_class = 'unknown'` is a terminal state reachable two ways that need opposite
-- fixes, and until now the stored row could not tell them apart:
--
--   1. THE MODEL DECLINED. The text carried weak or conflicting hints and the model refused
--      to commit. That is a prompt concern.
--   2. OUR OWN RULES OVERRODE IT. The model answered "free by default" and resolvePriceClass
--      downgraded it, because the text names a fee-associated activity (Layer 2) or the event
--      requires registration (Layer 3). That is a threshold concern.
--
-- On 2026-11-13 the only way to split the nine live `unknown` Play Frisco rows was to read
-- each stored `price_reasoning` and notice it disagreed with the stored class — the model
-- writes its reasoning before our rules run, so a reason saying "defaulting to free" beside a
-- stored class of `unknown` is the fingerprint of an override. That worked, and it is a
-- forensic exercise rather than a query. The split turned out to be 5 overridden and 4
-- genuine, and one of the overridden five is a Community Parade, which is almost certainly
-- free and is currently showing no price at all.
--
-- The same column also distinguishes the free values, which matters as much: a `free` from a
-- library's institutional default, a `free` the source published in machine-readable form, a
-- `free` read from a structured Cost field, and a `free` the model assumed because the text
-- said nothing are four different claims that currently look identical in the table.
--
-- Values:
--   'source-cost-field'   a structured price field on the source page (authoritative)
--   'source-declared'     the source's own machine-readable free statement (Kaleidoscope)
--   'source-institution'  free because of the venue — library programming, no judgment
--   'model'               the model's judgment stood unchanged
--   'rule-keyword'        Layer 2 overrode an inferred free (fee-associated activity)
--   'rule-registration'   Layer 3 overrode an inferred free (registration required)
--
-- Nullable on purpose. Existing rows get NULL, which is honest: we do not know retroactively
-- which layer decided them, and back-filling a guess would put invented provenance into the
-- one column whose entire job is to record real provenance. Rows acquire a value as they are
-- re-ingested.

alter table events
  add column if not exists price_decided_by text;

alter table events
  drop constraint if exists events_price_decided_by_check;

alter table events
  add constraint events_price_decided_by_check
  check (price_decided_by is null or price_decided_by in (
    'source-cost-field',
    'source-declared',
    'source-institution',
    'model',
    'rule-keyword',
    'rule-registration'
  ));

-- Narrow index: the question this column exists to answer is always about the overrides,
-- which are a small minority of rows.
create index if not exists events_price_decided_by_idx
  on events (price_decided_by)
  where price_decided_by in ('rule-keyword', 'rule-registration');

-- ---------------------------------------------------------------------------
-- AFTER DEPLOYING, verify with:
--
--   select price_decided_by, price_class, count(*)
--     from events group by 1, 2 order by 1, 2;
--
-- The question it was built to answer, which previously required reading prose:
--
--   select title, price_decided_by, registration_required
--     from events
--    where price_class = 'unknown'
--      and price_decided_by in ('rule-keyword', 'rule-registration');
--
-- Those are events showing no price because WE suppressed one, not because the source was
-- silent. Each is a candidate for a parent seeing nothing where "Free" would have been right.
