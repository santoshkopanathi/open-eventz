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

### 5. Dry runs write `ingest_runs` records · T · **done 2026-10-22**
**Problem.** A rehearsal wrote nothing to `events` but still called `recordRun`, so the run
history contained runs that never happened — **11 of them**, one reporting a billing failure that
was a deliberate test with an invalid key. That history feeds the Technical dashboard *and* is now
how scheduling is diagnosed, so it has to mean "what the pipeline actually did".
**Fixed.** `recordRun` returns early under `INGEST_DRY_RUN`; the 11 rows were deleted.

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

---

# Elaborations — problem, feature, effect, metric

Each open item in one shape: **the problem** (what goes wrong today), **the feature** (what gets
built), **how it helps** (the mechanism, not the hope), and **the metric it moves**. Items already
closed are omitted; see the status column above.

The discipline here is the fourth line. *An item whose metric is "it feels better" is a preference,
not a backlog entry* — two items below are honest about having no measurable effect yet, and that is
why they sit at P2.

---

## 4 · Sitemap has not regenerated · P0 · F · T

**Problem.** `sitemap.xml` is served from a build-time snapshot. It still lists 189 Kaleidoscope
URLs deleted two days ago, and a cache-busted request still returns a cache hit. The dead links are
cosmetic; the open question is structural — **if the sitemap only changes when the site is
rebuilt, then every event ingested overnight is invisible to Google until an unrelated deploy
happens.** Roughly 200 events a day enter the database; the sitemap claims 802 URLs regardless.

**Feature.** Diagnose first (ISR behaviour vs route config vs platform caching), then either
correct the route or have the nightly ingest trigger revalidation when it finishes — the pipeline
knows exactly when the content changed, which is the honest signal.

**How it helps.** Google discovers event pages from the sitemap. An event published today and
attended next Saturday has a one-week shelf life; a sitemap that updates weekly discovers it
after it has happened. Closing this is the difference between per-event SEO working and merely
existing.

**Metrics.** Indexed pages in Search Console (should track the live event count, currently flat
at 802) · impressions and clicks on `/events/*` · crawl errors, which should fall to zero as the
dead URLs leave · time-to-index for a newly ingested event.

---

## 6 · Heartbeat, the external half · P1 · T

**Problem.** The heartbeat built on 2026-10-22 shares a scheduler with the thing it watches. If
GitHub drops both on the same day, the silence is unbroken.

**Feature.** A dead-man's switch outside GitHub: the ingest pings an external monitor on success,
and the monitor alerts when a ping does not arrive inside the window.

**How it helps.** Removes the shared dependency. The current heartbeat is an independent *chance*
to notice; this is a guarantee, because the alert fires on the absence of a signal rather than on
the execution of code.

**Metrics.** Mean time to detect a stopped pipeline (today: unbounded — the 2026-10-22 drop was
found by a human reading a dashboard two days later) · false-alarm rate, which must stay at zero
or the alert gets ignored.

---

## 7 · Classification quality has no eval on change · P1 · T

**Problem.** Thirty-six controls protect times, volumes and absence. **Not one of them can see a
confidently-wrong age range or kid-relevance call.** `calibrate:price` runs the real model against
ground truth, but only when someone remembers, and kid-relevance has no golden set at all. Nothing
notices when the prompt or the `MODEL` constant changes — the two edits most likely to move
quality.

**Feature.** A golden set per decision (age bucket, kid-relevance, price), scored in CI on any
change to the prompt or model, failing the build below a threshold. Edge and adversarial cases
included: empty descriptions, teen-vs-child boundaries, adult events written in family language.

**How it helps.** Converts "the classifier seems fine" into a number that moves when something
breaks. It also makes prompt changes *safe to attempt* — today, editing the prompt is scary
precisely because nothing would catch a regression, so the prompt ossifies.

**Metrics.** Agreement with ground truth per decision (target: a stated threshold, not a vibe) ·
false-visible rate — adult or unsuitable events shown to parents, the one that matters most ·
false-hidden rate — real kids' events suppressed, the cost of being cautious · eval runtime and
cost per run, since an eval nobody can afford to run is not a control.

---

## 8 · Inferred dates are published but never graded · P1 · T

**Problem.** We publish dates derived from a stated cadence (15 live right now). The venue's own
"next date" grades every one of them within days — and nothing records the verdict. "How often is
an inference right?" is currently answered by opinion.

**Feature.** Record each inferred occurrence's fate: confirmed by the source, moved, or vanished.
Surface the accuracy on the Technical dashboard.

**How it helps.** Decides the horizon with evidence instead of instinct. At high accuracy, 8 weeks
is timid and could be extended; at low accuracy, inference should shrink or stop. Today that
number does not exist, so the horizon is a guess defended by a guess.

**Metrics.** Inference accuracy (% of inferred occurrences the source later confirmed) · mean lead
time between publishing a wrong date and correcting it · count of inferred rows live, which is the
exposure.

---

## 9 · No conversions since 2026-08-18 · P1 · F

**Problem.** 72 event detail views and **zero** Add-to-Calendar or Attending taps in two months.
Tracking is verified intact, so this is behaviour, not instrumentation. **The North Star has been
flat since before most of this month's engineering.**

**Feature.** Not a feature yet — an investigation, then a decision. Does the detail page make the
action obvious? Is the traffic arriving with intent, or landing from a search that did not match?
Is "Attending" even the action a parent wants, versus "send this to my partner"?

**How it helps.** Every other item on this list improves the *supply* of correct events. This is
the only one that asks whether the product converts attention into use. Building more supply
against a flat conversion rate is the expensive mistake available here.

**Metrics.** Weekly Active Discoverers (the North Star, currently 0) · detail-view → conversion
rate · share tap rate as an alternative intent signal · funnel drop-off between event-card click
and detail view.

---

## 10 · Event archive / change log · P1 · T · F

**Problem.** The system has no memory. Three consequences, all live:
1. **Guard thresholds are guesses.** The shrink rule's 50% and freshness's 48h were typed by a
   human. The right question — "is 210 events normal for Frisco in October?" — needs history.
   The 2026-10-19 outage was exactly this: a rule with no sense of normal.
2. **Inferred-date accuracy (#8) cannot be computed** without somewhere to record verdicts.
3. **Analytics are going unreadable.** GA4 keeps 90 days of event ids; the live table now keeps
   past events for days. Deleted event, unreadable dashboard row.

**Feature.** A change **log**, not a copy: write a row when an event's content changes (hash-based,
so a stable weekly storytime produces one row, not forty), each with a validity window. Read it
through a view that collapses to "latest version per event" for ordinary joins, and raw for
change analysis. **Analysis-only to start** — nothing user-facing reads it, so no latency or
uptime budget — in the same database, written by a job *outside* the ingest so an archive failure
cannot fail the pipeline.

**How it helps.** It is the substrate three other items need. It also answers questions we cannot
ask today: how far ahead does each source publish, how often do events move, which source is
least reliable. Those are the inputs to replacing hand-set thresholds with measured ones.

**Caution worth keeping.** Learned thresholds drift with a slowly degrading source — you adapt to
decline instead of detecting it. The design keeps a hard floor and uses history for *context*.

**Metrics.** Enables rather than moves: guard false-positive rate (how often a correct batch is
rejected — currently unknown and the 10-19 outage was a 100% false positive for three nights) ·
inference accuracy (#8) · dashboard rows resolvable to a title · source publishing lead time.

---

## 11 · Nothing checks the rendered page · P1 · T

**Problem.** Both timezone incidents and the duplicate SaturYAY were found by a human opening the
site. The weekly live read is the most effective detector in this project and the least reliable —
it depends on someone remembering, on a Saturday.

**Feature.** An automated read of the real rendered page: a handful of events whose displayed
times are asserted against the source, plus a snapshot of the city pages that fails on unexpected
change.

**How it helps.** Everything else inspects data in transit or at rest. This inspects what a parent
actually sees — the only place where a CSS bug, a hydration failure or a wrong local-time render
becomes visible. It is the layer that would have caught both incidents without a human.

**Metrics.** Defects caught before a human notices (today: zero) · mean time to detect a
user-visible defect · false-failure rate, which decides whether anyone keeps it on.

---

## 12 · Alerting is binary · P1 · T

**Problem.** A run fails or it does not. There is no threshold on cost, guardrail hit rate, or
purge volume — so a *slow* degradation is invisible until it becomes a failure. A source quietly
shedding 20% of its events every night never trips anything.

**Feature.** Thresholds on the numbers already recorded: LLM cost per run, events purged, events
dropped by the guard, batch size versus trailing average.

**How it helps.** Converts the pipeline from pass/fail into something with a trend. Most of the
failures in this project's history announced themselves as a drift first and a break later.

**Metrics.** Alerts raised per week and their precision (an alert nobody trusts is worse than none)
· mean time to detect a degradation, as distinct from a failure.

---

## 13 · No application error tracking · P1 · T

**Problem.** Alerting covers the ingest only. A 500 on an event page, a client crash on the map,
a failed API call in the browser — all invisible. The one user-facing error state we added was
found by reading code, not by a report.

**Feature.** Sentry (chosen, blocked on a DSN) for server and client errors, with release tagging.

**How it helps.** Closes the gap between "the data is correct" and "the site works". The current
blind spot is the entire runtime.

**Metrics.** Error rate per session · time to detect a production error (today: until someone
mentions it) · error-free session share.

---

## 14 · Search Console migration · P1 · F

**Problem.** The domain move is in flight: event pages are indexed on the new domain, the city
pages are not yet back, and the old `vercel.app` listing still appears. This is Google's clock, not
ours — the work is watching, not building.

**Feature.** Weekly check of Pages and Performance in the new property until the city pages return
and the old host's entries are gone.

**How it helps.** Confirms the migration completed rather than assuming it. **Interacts with #4:**
if the sitemap is inert, the migration never fully lands and we would mistake one problem for the
other.

**Metrics.** Indexed pages on the new domain vs the old · impressions and clicks for city queries ·
average position for "free kids events frisco".

---

## 15 · Billing handover on 2026-11-18 · P1 · T · date-bound

**Problem.** Promotional credit expires that day and auto-reload takes over. The failure mode is
already understood — it happened on 2026-10-21 and classification silently degraded for a run.

**Feature.** No build. A reminder, and a verification that a classification runs on purchased
credit after the date.

**How it helps.** The detection exists now (A9 names billing failures explicitly); this is
confirming the money path, which no code can test in advance.

**Metrics.** Classified events per run across the boundary · one check that the first post-expiry
run is green.

---

## P2 — elaborated briefly

**16 · Phase 2 restyle** (map pins, legend, `/dashboard`) · F — *Problem:* three surfaces still
carry pre-reskin styling. *Metric:* none measurable; it is consistency debt, which is exactly why
it sits at P2.

**17 · Phase 3 features** (search, saved events, distance) · F — *Problem:* browsing is the only
way to find an event; a parent looking for "Saturday near me" must scan. *Feature:* search, saved
list, distance sort. *Metric:* detail-view rate per session, return-visit rate. **Hold until #9
explains why conversions are flat** — adding features on top of an unexplained zero is how you get
two unexplained zeros.

**18 · Venue pages, recurrence confidence** · F — *Problem:* every content-rich page expires, so
the SEO surface is permanently thin. *Feature:* durable venue pages built from history, plus
"usually happens weekly" confidence. *Metric:* indexed durable pages, organic entrances to
non-event URLs. **Depends on #10.** Strong candidate for promotion once the archive exists.

**19 · E2E against real data** · T — *Problem:* Playwright mocks every API, so nothing exercises
real DB → real render. *Metric:* overlaps #11, which is cheaper and catches more.

**20 · Scraped text as prompt input** · T — *Problem:* event descriptions enter the prompt
unframed, and render verbatim under our masthead. *Feature:* instruct the model to treat source
text as data, never instructions; basic content screening on what we republish. *Metric:* none
until something happens — low likelihood, non-zero severity, documented so it is a choice.

**21 · No rate limit on the public events API** · T — *Problem:* Supabase egress is unbounded per
client. *Metric:* egress per day; cost per thousand sessions.

**22 · Spend estimated, not metered** · T — *Problem:* `calls × $0.006` is a dashboard number, not
a control; the real backstop is the account cap. *Metric:* variance between estimate and invoice.

**23 · Retention, deletion, guardrail hit rate** · T — *Problem:* no retention schedule, and **no
aggregate of which guards ever fire** — so we cannot say which of the 36 earns its keep. *Feature:*
count guard trips per run into `ingest_runs`. *Metric:* trips per guard per month; guards with zero
trips in a quarter are candidates for deletion or for suspicion.

**24 · Source replacement tooling** · T — *Problem:* replacing a source is a manual
delete-and-reingest, done twice this month. *Metric:* minutes of human time per replacement.
Accepted until a third source is rebuilt.


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
