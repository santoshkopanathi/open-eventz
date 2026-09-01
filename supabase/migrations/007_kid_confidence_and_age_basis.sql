-- Split the overloaded confidence score, and record whether an age was STATED or ASSUMED (v1.3)
-- Run this in the Supabase SQL Editor BEFORE deploying the updated ingest.
--
-- Two columns, both Play Frisco / Kaleidoscope only (library sources leave them null).
--
-- 1) kid_confidence  'high' | 'medium' | 'low'
--    Until now ONE confidence score did two unrelated jobs: it decided whether to show an
--    age badge AND whether the event appeared on the site at all. But the prompt defines
--    that score in AGE terms ("high = the age range was explicitly stated"), so an event
--    plainly suitable for a family but vague about WHICH ages scored low and was deleted.
--    An event was being hidden because we were unsure about its age.
--
--    From now on: kid_confidence gates VISIBILITY. age_confidence only decides the badge.
--
-- 2) age_basis  'stated' | 'assumed'
--    The estimated ✦ marker was decided by SOURCE, not by evidence — every Play Frisco age
--    was treated as inferred because that source publishes prose. So a description reading
--    "Open to ages 5 and up" (Learn to Fish) or "Recommended for ages 3 and up"
--    (Princess Tea 2026) still told the parent we had guessed. Two live events today.
--
--    From now on: 'stated' -> plain badge, 'assumed' -> ✦.

alter table events
  add column if not exists kid_confidence text,
  add column if not exists age_basis      text;

-- Backfill note: existing rows have both null. That is handled and safe:
--   kid_confidence null -> the low-confidence hide does not fire. The only two events with
--                          age_confidence = 'low' today are already kid_relevant = false, so
--                          nothing changes visibly.
--   age_basis null      -> treated as 'assumed', which is the current behaviour. No regression.
--
-- Rows acquire real values as they are re-classified. To force it for a source immediately,
-- clear the inference so the next ingest treats them as a cache miss (~a cent for 144 events):
--
--   update events
--     set kid_relevant = null, age_buckets = null, age_confidence = null, age_reasoning = null
--     where source in ('play-frisco', 'kaleidoscope-park');
--
-- NOTE: price_class / price_confidence are deliberately NOT cleared. The price redesign was
-- measured against a 64-event golden set and rejected (see eval/RUN-LOG.md); price behaviour
-- is unchanged by this migration.
