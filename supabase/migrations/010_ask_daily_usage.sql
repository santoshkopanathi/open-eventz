-- ask_daily_usage: the Ask Open Eventz daily question ceiling, shared by every server instance
-- Run this in the Supabase SQL Editor BEFORE turning the Ask flag on in production.
--
-- WHY. The spec caps Ask at 100 questions a day (about $2), owner-approved 2026-11-18. The
-- first version kept the count in server memory, which is fine locally and wrong on Vercel:
-- each serverless instance would keep its own count, so the real ceiling would be 100 times
-- however many instances happen to be warm. The count has to live in one shared place.
--
-- SAFE IF FORGOTTEN. The 009 incident was a migration that was noted as "run by hand" and
-- wasn't. This one is designed so forgetting it costs nothing: /api/ask calls ask_take_slot()
-- and, if the call fails for ANY reason (function missing, table missing, network), treats
-- the day as full and shows "unavailable". Ask fails closed; the list is unaffected.
--
-- WHAT IT STORES. One row per Central-time day with a counter. No question text, no IP, no
-- user ID (spec "Personal data in questions").
--
-- ACCESS. RLS is on with no policies, so no client can read or write the table directly. The
-- only way in is ask_take_slot(), a SECURITY DEFINER function that increments atomically and
-- refuses past the cap. Anyone holding the public anon key can call it, which at worst uses up
-- the day's questions early (Ask then shows "unavailable"); it can never raise the cap or cost
-- more than the cap allows.

create table if not exists public.ask_daily_usage (
  day   date primary key,
  count integer not null default 0 check (count >= 0)
);

alter table public.ask_daily_usage enable row level security;

create or replace function public.ask_take_slot(p_day date, p_cap integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_cap is null or p_cap < 1 then
    return false;
  end if;
  insert into public.ask_daily_usage as u (day, count)
  values (p_day, 1)
  on conflict (day) do update
    set count = u.count + 1
    where u.count < p_cap
  returning u.count into n;
  return n is not null;
end;
$$;

revoke all on function public.ask_take_slot(date, integer) from public;
grant execute on function public.ask_take_slot(date, integer) to anon, authenticated, service_role;

-- Check after running (expect true, then the row with count 1; delete the test row after):
--   select public.ask_take_slot('2000-01-01', 100);
--   select * from public.ask_daily_usage where day = '2000-01-01';
--   delete from public.ask_daily_usage where day = '2000-01-01';
