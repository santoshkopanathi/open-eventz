# Backlog

**One prioritised list, two ways to read it.** Every item is tagged **F** (functional — what a
parent or the owner would notice) or **T** (technical — what keeps the thing trustworthy: NFRs,
guardrails, observability, scale). The tags are *views*, not separate backlogs: the work competes
for the same hours, so it is ranked once.

Started 2026-10-22, consolidating the gaps recorded in `GUARDRAILS.md`, the parked design work in
`BUILD-LOG.md`, and the open product questions from the dashboard.

**Priority**
- **P0 — now.** Something is broken, stale or misleading in production today.
- **P1 — next.** A known gap with a real failure mode, not yet biting.
- **P2 — later.** Accepted limits, worth closing when the cost drops or the risk rises.

**Status:** `open` · `in progress` · `blocked` · `done`

---

## The list

| # | Item | View | Priority | Status |
|---|---|---|---|---|
| 1 | Push the four pending commits | T · F | **P0** | done 10-22 |
| 2 | Kaleidoscope delete-and-reingest (human-run migration) | T | **P0** | done 10-22 |
| 3 | Did the nightly run today? No run record exists | T | **P0** | done 10-22 — answered |
| 4 | Sitemap has not regenerated in 24h+ | F · T | **P0** | open |
| 5 | Dry runs write `ingest_runs` records | T | P1 | done 10-22 |
| 6 | No heartbeat — a run that never starts is silent | T | P1 | done 10-22 (partial — see item) |
| 7 | Classification quality has no eval on change | T | P1 | open |
| 8 | Inferred dates are published but never graded | T | P1 | open |
| 9 | No conversions since 2026-08-18 | F | P1 | open |
| 10 | Event archive / change log | T · F | P1 | parked by decision |
| 11 | Nothing checks the rendered page | T | P1 | open |
| 12 | Alerting is binary — no thresholds | T | P1 | open |
| 13 | No application error tracking (Sentry) | T | P1 | open |
| 14 | Search Console migration not yet complete | F | P1 | open |
| 15 | Billing handover on 2026-11-18 untested | T | P1 | date-bound |
| 16 | Phase 2 — map pins, legend, `/dashboard` restyle | F | P2 | open |
| 17 | Phase 3 — search, saved events, distance | F | P2 | open |
| 18 | Venue pages and recurrence confidence | F | P2 | open |
| 19 | No E2E test touches real data | T | P2 | open |
| 20 | Scraped text is unguarded prompt input | T | P2 | open |
| 21 | No rate limit on the public events API | T | P2 | open |
| 22 | Spend is estimated, not metered | T | P2 | open |
| 23 | Retention, deletion and guardrail hit-rate | T | P2 | open |
| 24 | Source replacement has no tooling | T | P2 | accepted |

---

## P0 — now

### 1. Push the four pending commits · T · F
**Why.** Frisco's last successful write was **43 hours ago**; last night's run hit the same silent
zero the fix addresses. Meanwhile the duplicate SaturYAY is live on the site, and the billing
diagnostics that would have explained Tuesday's outage are sitting on this machine.
**Done when.** `master` is current and the nightly runs green on all four sources.
**Size.** Minutes. **This is the highest-value action available.**

### 2. Kaleidoscope delete-and-reingest · T
**Why.** The id scheme moved to Central dates and the collision rules removed duplicates, so ~39%
of stored Kaleidoscope rows are absent from the new batch. The purge cap correctly refuses to act
on that, which is the guard working — replacing a source is a human-run migration.
**Done when.** `delete from events where source = 'kaleidoscope-park';` then a manual workflow run
produces ~32 rows, 11 of them `date_inferred`.
**Blocked by** #1. **Size.** 10 minutes. Runbook: `supabase/migrations/008_date_inferred.sql`.

### 3. Did the nightly run today? · T · **answered 2026-10-22**
**The answer: the schedule did not fire.** GitHub's Actions API shows no scheduled run for
2026-10-22 at all, and the twelve before it started at wildly different times against a fixed
`0 11 * * *`:

```
13:59  14:12  15:04  15:23  15:27  15:37  15:43  16:26  17:14  17:50  20:02   (UTC)
```

**Delays of 3 to 9 hours, averaging ~5, then a drop.** GitHub's scheduler is best-effort and
most congested on the hour, which is exactly where we were scheduled.

**What changed.** The cron moved to `40 3 * * *` — off the hour, and early enough that the
observed delay still lands it roughly 1–7 AM Central. Timing is still not guaranteed, which is
why the real answer is #6.

### 4. Sitemap has not regenerated in 24h+ · F · T
**Why.** It still lists **189 deleted Kaleidoscope URLs** that now 404, despite `revalidate = 3600`,
and a cache-busted request returns `X-Vercel-Cache: HIT`. The dead links are the small problem.
The open question is whether **any** nightly-ingested event reaches Google without a deploy — if
not, the entire per-event SEO strategy is quietly inert between deploys.
**Done when.** The cause is understood (ISR behaviour vs route config), and either the route is
corrected or the nightly job triggers revalidation on completion.
**Do not change the route before diagnosing it.** **Size.** Half a day, mostly investigation.

---

## P1 — next

### 5. Dry runs write `ingest_runs` records · T
A rehearsal that writes nothing to `events` still calls `recordRun`, so the Technical dashboard's
"last ingest" and cost figures include runs that never happened — five such rows exist already.
**Done when.** `INGEST_DRY_RUN` skips the record, or marks it unmistakably. **Size.** 30 minutes.

### 6. No heartbeat · T · **built 2026-10-22, partially closed**
Every alert fires when a run **fails**. A run that never starts produces silence, which looks
exactly like success — and #3 proved it was already happening.

**Built.** A separate `Heartbeat` workflow on its own schedule asks the database one question:
has every source written in the last 30 hours? A dropped schedule, a failed job, a silent zero
and a dead source all produce the same answer and need the same first response. It alerts by
failing, which triggers GitHub's own workflow-failure email — the channel that needs no code of
ours. Run it any time with `npm run heartbeat`; it caught Frisco at 43.8h on its first run.

**Why "partial".** It is scheduled by the same mechanism that drops ingest runs, so it can be
delayed or dropped too. Staleness persists, so tomorrow's heartbeat catches what today's missed —
but a true dead-man's switch needs a service *outside* GitHub (a scheduled ping with an external
monitor). **Remaining work:** decide whether that external dependency is worth it. Keep at P1.

### 7. Classification quality has no eval on change · T
The long-standing weak spot, and the one none of this month's work touched. Thirty-six controls
protect times, volumes and absence; **a confidently-wrong age range or kid-relevance call passes
every one of them.** `calibrate:price` runs the real model against ground truth but is manual, and
nothing notices when the prompt or the `MODEL` constant changes.
**Done when.** A golden set runs on prompt/model change in CI, with a threshold that fails the
build. Kid-relevance needs its own set — today only price has one.
**Size.** 2–3 days. See `EVALS.md`.

### 8. Inferred dates are published but never graded · T
We publish dates derived from a stated cadence, and the nightly re-anchor grades every one of them
within days — but no verdict is recorded. "How often was an inference right?" is answerable from
the data and is currently answered by opinion. The `date_inferred` flag exists to make this cheap.
**Done when.** Each inferred occurrence's fate (confirmed / moved / vanished) is recorded, and the
accuracy is on the Technical dashboard. **Depends on** #10 for history. **Size.** 1 day.

### 9. No conversions since 2026-08-18 · F
**The North Star has been flat for two months.** 72 event detail views, zero Add-to-Calendar or
Attending taps. Tracking is intact (verified in code), so this is behaviour, not instrumentation.
It is the most important question on this list and the least technical.
**Done when.** The drop is explained — a UI problem, a traffic-mix change, or a real signal that
the conversion actions are not what visitors want. **Size.** A day of analysis.

### 10. Event archive / change log · T · F
Parked by decision on 2026-10-20, and three P1 items now point at it: guard thresholds have no
baseline, freshness is a hand-set 48h, inferred-date accuracy (#8) needs history, and the dashboard
cannot name events GA4 still remembers. Design settled: a **log**, not a move — write on change,
with validity windows; analysis-only to start, same database, written by a job outside the ingest.
**Done when.** Unpicked when #8 or #7 needs it. **Size.** 2 days.

### 11. Nothing checks the rendered page · T
The weekly live-site read remains the most effective detector in the project and the least
reliable. Both timezone bugs and the duplicate SaturYAY were found by a human opening the site.
**Done when.** Something automated looks at the real rendered page — a handful of events whose
times are asserted against the source, or a visual snapshot of the city pages.
**Size.** 1–2 days. **Highest-value *new* guardrail.**

### 12. Alerting is binary · T
A run fails or it does not. No threshold on cost spikes, guardrail hit-rate or purge volume, so a
slow degradation is invisible until it becomes a failure. **Size.** 1 day. **Related to** #6.

### 13. No application error tracking · T
Alerting covers the ingest only; a 500 in production is invisible. Sentry is chosen and blocked on
a DSN. **Size.** Half a day once unblocked.

### 14. Search Console migration not yet complete · F
The move to `openeventz.com` is submitted and in flight; event pages are indexed, the city pages
are not yet back. Needs watching rather than working — Pages and Performance in the new property.
**Interacts with #4:** if the sitemap is inert, this never fully lands.

### 15. Billing handover on 2026-11-18 · T
Promotional credit expires and auto-reload ($15 below $5) takes over. The failure would announce
itself now, but the handover has never run. **Done when.** A classification runs on purchased
credit after that date. **Date-bound — set a reminder, not a task.**

---

## P2 — later

| # | Item | Why it is not P1 |
|---|---|---|
| 16 | **Phase 2 restyle** — map pins, legend, `/dashboard` | Deliberately deferred during the Weekend Paper reskin; cosmetic debt on non-primary surfaces |
| 17 | **Phase 3 features** — search, saved events, distance | Real features, and the conversion question (#9) should be understood before adding more |
| 18 | **Venue pages, recurrence confidence** | The durable SEO surfaces: every content-rich page today expires. Strong candidate to promote once #10 exists |
| 19 | **E2E against real data** | Playwright mocks every API by design; nothing exercises real DB → real render. Overlaps #11, which is cheaper |
| 20 | **Scraped text as prompt input** | The prompt does not frame event text as data-never-instructions, and descriptions render verbatim under our masthead. Low likelihood, non-zero severity |
| 21 | **No rate limit on the public events API** | Supabase egress exposure; no incident yet |
| 22 | **Spend estimated, not metered** | `calls × $0.006` is a dashboard number, not a control. The account cap is the real backstop |
| 23 | **Retention, deletion, guardrail hit-rate** | No retention schedule; hit-rate is never aggregated, so we cannot say which guard earns its keep |
| 24 | **Source replacement tooling** | Accepted as human-run. Revisit if a third source is rebuilt |

---

## Recently closed (2026-10-19 → 21)

Kept short, as context for what the list above inherited.

| Closed | Item |
|---|---|
| 10-19 | Shrink guard compared a forward window against an accumulation — froze Frisco for three nights |
| 10-19 | Stored-events read silently truncated at 1,000 rows |
| 10-20 | No cancellation detection on the library sources — three live stale events removed |
| 10-20 | Kaleidoscope's source replaced; connector rebuilt on structured data |
| 10-21 | Frisco's silent zero — a changed link format reported as an empty calendar |
| 10-21 | Duplicate SaturYAY, inference past a stated end date, ids naming the wrong day |
| 10-21 | A billing failure that read as a model failure |
| 10-21 | `GUARDRAILS.md` catalogue — 36 controls documented with worked examples |
