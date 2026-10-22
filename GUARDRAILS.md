# Guardrails

**What stands between a defect and a parent standing outside a locked library.**

This is the single inventory of every control protecting Open Eventz data, where each one sits,
and what it catches. Started 2026-08-15 after the "5:00 AM story time" incident reached real
users.

**How to read it.** The **layer tables** below are the index — one line per control, grouped by
where it sits in the pipeline. [**The catalogue**](#the-catalogue--every-control-with-a-worked-example)
is the reference: each control's purpose, how it decides, a worked example, and the failure it
was written for. Almost every entry there dates from the day after something got through.

**Related documents.** `EVALS.md` covers the quality of the *model's judgment* (age, price,
kid-relevance) — the one axis these controls barely touch, since a confidently-wrong
classification passes every rule here. `INGEST-DESIGN.md` §8 is the implementation detail.

---

## Why this is not the testing document

| Document | Question it answers |
|---|---|
| **`TESTING.md`** | *How do I run the checks?* — the commands and layers |
| **`TEST-SCENARIOS.md`** | *What behaviour is covered?* — the scenario-by-scenario coverage record |
| **`GUARDRAILS.md`** (this) | *What stops bad data reaching a user, and where?* — the defence architecture |

The distinction is not bureaucratic. **Tests prove the code does what we intended. Guardrails
handle reality not matching our intent** — a source changing shape, a wrong assumption, a
different machine.

The proof is the incident that prompted this file: **every test passed, and production served
wrong event times for three days.** The tests were correct and useless, because a test can only
check what someone thought to model. Guardrails point at the real output instead.

They overlap in one place: some guardrails are *implemented* as tests but aren't testing
behaviour — they enforce architecture (e.g. "no code path may bypass the write guard"). Those
are listed under **Structural** below and cross-referenced from `TEST-SCENARIOS.md`; they live
here because their job is prevention, not coverage.

---

## The core rule

> **A wrong value is worse than a missing one.**
>
> A parent who arrives at the wrong hour is failed harder than one who never saw the event.
> When a control is unsure, it must publish **less**, never guess.

Every guardrail below resolves ambiguity toward *withholding*. Where that costs us coverage, the
cost is accepted deliberately.

---

## Layer 1 — Design-time defaults (fail-closed)

Choices in the code that make the safe outcome the automatic one.

| Guardrail | Catches | Behaviour when unsure |
|---|---|---|
| LLM classification fail-closed (`classifyEvents`) | a `low`-confidence **kid-relevance** call | `kid_relevant = false` — event hidden. Was gated on *age* confidence until v1.3, which deleted events whose age was merely vague |
| Hard adults-only override | "21+", "18+", "adults only" slipping past the model | hidden regardless of the LLM's view |
| Unparseable start time (`parseCentralWallTime` → `null`) | malformed or unexpected date formats | event **skipped**, never stored at a guessed time |
| Explicit venue timezone, never the machine's | the runtime deciding what "10:00 AM" means | conversion is always America/Chicago, DST-aware |
| `getSupervisionBadge` returns `null` for an unknown source | a new source with no drop-off policy defined | **no badge** rather than a wrong reassurance |
| Events API gate is **source-aware** | an LLM-classified event with `kid_relevant = NULL` — never successfully classified — being served as if it were a library event, which legitimately has NULL | NULL passes **only** for non-LLM sources. Fired for real 2026-09-01: an excluded event left NULL on an existing row and was served unclassified |
| Model call fails or returns an unusable shape | a transient API error being stored as a permanent decision | the event is **excluded from the write** and retried next run — never stored as `kid_relevant = false`, which the cache would read as a real answer and hide it forever |
| LLM spend ceiling reached (`llm-budget.ts`) | a source anomaly (e.g. 10,000 events) running up unbounded cost | the event is **excluded from the write** — not shown, not cached, re-tried next run |
| Account-level spend limit | our own cap being wrong, or any spend path we did not anticipate — including Claude Code and Playground usage, which our in-code cap does not see | API usage pauses at the limit. **Changed 2026-10-21:** the account now runs on **promotional credit expiring 2026-11-18**, with **auto-reload ON** ($15 when the balance falls below $5). The handover at expiry is the next live test of this row |
| **A model call that needs a human** (`llm-failure.ts`, added 2026-10-21) | an exhausted balance or rejected key, which otherwise reads as ordinary inference failures — one cryptic line per event and no statement of cause | remaining calls **stopped**, events held back, and **one line** in the run record naming the cause and the fix |

## Layer 2 — Structural guards (architecture, enforced in CI)

These don't test behaviour; they make an unsafe *shape* of code impossible to merge.

| Guardrail | Catches | File |
|---|---|---|
| Only **one** `events.upsert` may exist in the ingest module | a future source quietly bypassing the write guard | `no-ambient-timezone.test.ts` |
| Every `new Date(<arg>)` in ingest must be allowlisted with a reason | reintroducing the ambient-timezone bug | `no-ambient-timezone.test.ts` |
| Every event detail surface must render `<SupervisionCallout>` | a surface shipping without the drop-off badge (has happened twice) | `supervision-surfaces.test.ts` |
| `Record<EventSource, true>` completeness check | adding a source without a supervision policy | `supervision.test.ts` |
| **Every no-decision path uses the same flag**, and every runner filters it | a classifier path that stores a value it never decided, or a source that forgets to exclude undecided events | `classify-skip.test.ts` |
| Doc↔test parity | `TEST-SCENARIOS.md` claiming coverage that no longer exists | `scripts/check-doc-parity.mjs` |
| **The failure alert still delivers under a flaky Issues API** | a regression in the alert itself — which only executes when something is already broken, so it would stay invisible until the night it mattered | `notify-alert.test.ts` |

> **The alert is a guardrail too, so it gets a guardrail.** `notify-alert.test.ts` extracts the
> `notify` script straight out of `ingest.yml` (never a copy, so it cannot drift) and replays
> **all three real drill failures** plus a total outage against mocked APIs. Verified to fail
> when the fall-forward logic is removed, and it runs in <1s — the retry backoff is collapsed in
> test, because a suite that adds a minute to every commit is a suite people stop running.

> **Verify a structural guard by breaking the thing it guards.** The first version of the
> ambient-timezone ban used a regex that matched only string literals — it missed all three real
> call sites and would have passed while the bug was live. It was replaced, then confirmed by
> reintroducing the original bug and watching it fail at the right line.
> **A guard you have never seen fail is not a guard.**

## Layer 3 — Pre-write (the strongest layer)

`guardedUpsert` → `screenBatch` ([`src/lib/ingest-guard.ts`](src/lib/ingest-guard.ts)). Runs
**before** anything reaches the database. This is the layer that makes "wrong data cannot be
published" a property rather than a hope.

| Rule | Catches | On trip |
|---|---|---|
| **Implausible start** — nothing between 12:01 and 7:00 AM CT (exact midnight allowed = all-day) | individually broken times | that event is **dropped** |
| **Uniform shift** — ≥80% of ≥20 overlapping events moved by the *same* non-zero offset | any clock/timezone bug, **including shifts landing at plausible hours** | **whole batch rejected** |
| **Shrink** — batch smaller than half the **upcoming** stored set *(upcoming-only since 2026-10-19)* | a partial/failed scrape being read as "events cancelled" | **whole batch rejected** |
| **Cancellation purge** — upcoming rows the batch no longer lists, capped at 25% *(added 2026-10-20)* | an event cancelled upstream staying on our site forever | rows **deleted**; above the cap, reported instead |
| **Cannot read stored events** | comparing against nothing and writing blind | **refuses to write** |

On abort: nothing is written **and the purge/cleanup steps are skipped** — otherwise a rejected
batch would still delete good rows. The previously-stored correct events simply remain.

**Why the uniform-shift rule is the important one.** A genuine reschedule moves *one* event by an
arbitrary amount. A clock bug moves *every* event by an identical amount. That signature catches
failures nobody enumerated — a DST error, a source switching timezone, an off-by-one-day parse —
including ones landing at perfectly normal-looking hours, which no plausible-hours rule can see.

**Escape hatch:** `INGEST_ALLOW_TIME_SHIFT=1` permits an *intended* mass correction (the
re-ingest that fixes a timezone bug is supposed to move everything at once). Explicit by design,
and it forgives only the shift rule — implausible times stay blocked even with it set.

## Layer 4 — Post-write, against real data

`npm run validate` → [`scripts/validate-data.ts`](scripts/validate-data.ts), run as the
`data-quality` job after every nightly ingest. Pure checks in `src/lib/data-quality.ts`.

| Check | Catches |
|---|---|
| Age variety (no bucket > 85%) | age extraction collapsing to a single fallback |
| Zero adult-title leaks | adult events stored kid-visible |
| Toddler filter narrows (< 90% match) | an age filter that has become a no-op |
| Start times plausible, per source | a timezone shift that somehow reached the DB |
| **No unclassified LLM events stored** | an event from a source we classify sitting with `kid_relevant = null` — never classified, and kept hidden only by the API gate. Names the events rather than a bare count |
| Per-source non-empty | a source whose stored *stock* has collapsed |
| **Per-source freshness (≤ 48h)** *(per-source since 2026-08-22)* | a single source that has stopped *writing*, while the others stay healthy — the check names which one |
| Live-source canary | BiblioCommons changing its audience API contract |
| Fallback-rate run warning | graceful degradation hiding a break (>50% fallback) |

This layer is **detection, not prevention** — by the time it fires, data is already stored. It
exists as a backstop for whatever Layer 3 didn't anticipate.

**What the user sees when any of this trips** is specified in the [Fallback table](#fallback-table--what-the-user-sees-when-something-breaks) at the end of this document.

## Layer 5 — Pipeline gates

| Gate | Runs | Notes |
|---|---|---|
| typecheck + unit | pre-commit hook, CI | CI runs the suite **twice** — `TZ=UTC` and `TZ=America/Chicago` |
| E2E (Playwright) | pre-push (when a browser is present), CI | a green pre-push hook is **not** a green pipeline |
| `next build` | CI | |
| doc-parity | CI | |
| data-quality | after every nightly ingest | Layer 4 |

## Layer 6 — Alerting and human review

| Guardrail | Detail |
|---|---|
| **Ingest failure alert — PRIMARY: GitHub's own workflow-failure email** | When any job fails the run goes red and GitHub emails the repo owner ("Ingest events: Some jobs were not successful", with per-job status). It needs no code and **cannot be broken by our own logic** — which is the entire reason it is the primary channel. **Verified 2026-08-17, and verified in the strongest possible way: it arrived for drill #3, the run where our own issue-based alert failed.** The email listed `alert on failure — Failed`, so **a broken secondary channel is itself visible through the primary one.** Already enabled on this account; the setting lives at `github.com/settings/notifications` → Actions (**personal** settings, not repo settings) if it ever needs re-checking. |
| **Ingest failure alert — SECONDARY: the `notify` job's GitHub Issue** | Best-effort **enhancement**, not the primary signal. It adds a durable, must-be-closed record with triage instructions, but three fire drills produced **three different failures** on GitHub's Issues API (`createLabel` 503; create-with-label rejected; `createComment` 503), so it is treated as a flaky dependency: every call retries, and delivery falls forward through comment → labelled issue → unlabelled issue. **For an alert, a duplicate beats a silence.** If every rung fails it logs which calls broke and fails the job — costing nothing, since the run was already red and the primary email already fired. |
| **Fire drill** | **Three drills on 2026-08-17 produced three different bugs — none of them findable by reading the code.** (1) `createLabel` 503 was unhandled, killing the job before it opened the issue — a *cosmetic* step took down the alert. (2) The issue was delivered but **unlabelled** (GitHub rejected the label it had just created), while dedup looked issues up *by label* — so every future failure would have opened a duplicate. (3) `createComment` 503'd on the existing issue and delivery simply gave up. Each fix is in the row above. The standing lesson: **the alert's dependency is flaky, so fall forward rather than fail.** **How to run one:** Actions → Ingest events → Run workflow → tick **`simulate_failure`**. One job fails on purpose, the real ingest step is skipped for *every* source (nothing scraped, classified or written), and the alert fires under the separate `ingest-drill` label so a test issue can never absorb a real one. Scheduled runs are unaffected — `inputs` is undefined on a schedule event. **Re-run after any change to the alert.** All three drill failures are now permanent regression tests (`notify-alert.test.ts`, row in Layer 2), so a drill is no longer the only thing standing between a broken alert and a silent night. |
| **Weekly live-site review** | Open the real site and read the event times. Not automated, and not optional — **both** timezone bugs were found this way and neither by a test. |

---

## Operating practices

The habits that surround the automated controls. These are the part no CI job can enforce.

| When | Practice | Why it exists |
|---|---|---|
| **Learning a lesson on one source** | Audit **every other source** for the same shape *that day* | Principle #7 ("don't trust a source's UTC") was written after Kaleidoscope and not applied to the other three — the same bug class shipped one day later. A principle not applied backwards is a note, not a control. |
| **Changing where or how code runs** | Treat it as a code change: re-ask what it assumes about its environment | Moving ingest to GitHub Actions changed no logic and broke every event time. The review question must be "does it still *mean* the same thing here?", not "does it still run?" |
| **Before pushing a UI change** | Run `npx playwright test` locally | The pre-push hook deliberately excludes E2E; a green hook is not a green pipeline |
| **After any ingest/data change** | Look at the live thing | Two of the last three data bugs passed every gate and were visible immediately on the rendered page |
| **When a source publishes a UTC field** | Cross-check it against the local wall time; don't trust either alone | BiblioCommons publishes the correct UTC *next to* the ambiguous local time — a free oracle we ignored. Kaleidoscope's UTC is 10h wrong. |
| **Adding a source** | Follow `SOURCE-ONBOARDING.md`; confirm the first run passes the guard rather than needing the escape hatch | A source that only ingests with `INGEST_ALLOW_TIME_SHIFT=1` has an unresolved bug |
| **Writing a guardrail** | Break the thing it guards and watch it fail before trusting it | See the ambient-timezone regex that would have passed during the live bug |

---

## Known gaps — accepted, not solved

Recorded openly so they're chosen rather than discovered. **These are inputs to
[`BACKLOG.md`](BACKLOG.md)**, which ranks them against the product work rather than listing them
in isolation — a guardrail gap and a feature compete for the same afternoon.

1. **A rejected batch needs a human.** If a source legitimately reschedules everything at once,
   Layer 3 rejects it and data goes stale until someone investigates. This is the deliberate
   direction given the core rule, but it is a real operational cost.
2. **Weekly live review is a habit, not a control.** It is currently the most effective detector
   we have and the least reliable. Anything that automates a "does the rendered page look right"
   check would be the highest-value next guardrail.
3. **No end-to-end test touches real data.** Playwright mocks every `/api/*` call, by design
   (deterministic, CI-safe). Nothing exercises the real DB → real render path.
4. **Age, price and kid-relevance have no equivalent of the uniform-shift check.** A systematic
   corruption of those fields would be caught only by Layer 4's thresholds, after the write.
5. **Alerting covers ingest only.** Application errors in production still have no tracing
   (Sentry remains planned, needs a DSN).
6. **The fall-forward delivery path has only been proven against mocks.** All three drill
   failures are covered by `notify-alert.test.ts`, but the *real* fall-forward has never run
   against a genuinely flaky GitHub — that only happens when GitHub is flaky again, which is
   not something we can schedule.
7. **Alerting is binary.** A run either fails or it doesn't. There is no threshold on cost
   spikes, guardrail hit-rate, or latency, so a slow degradation is invisible until it becomes
   a failure.
8. **Inferred dates are not yet measured.** D7 publishes dates we worked out, and the nightly
   re-anchor grades every one of them within days — but nothing records the verdict. "How often
   was an inference right?" is answerable from the data and is currently answered by opinion.
   The `date_inferred` flag exists precisely so this can be closed cheaply.
9. **The sitemap has not regenerated in 24h** *(open, 2026-10-21)*. It still lists 189 deleted
   Kaleidoscope URLs despite `revalidate = 3600`, and a cache-busted request still returns
   `X-Vercel-Cache: HIT`. The dead links are the small problem; the open question is whether
   **any** nightly-ingested event reaches the sitemap without a deploy. Undiagnosed — do not
   change the route until it is understood.
10. **Replacing a source is a human-run migration.** When a source legitimately collapses (189
    Kaleidoscope occurrences → 19 real ones), C3 and C4 both refuse by design and someone must
    delete and re-ingest by hand. Correct, and a real operational cost.
11. **The billing handover on 2026-11-18 is untested.** Promotional credit expires and
    auto-reload takes over. A9 means the failure would announce itself, but the handover itself
    has never run.

---

## Adding a guardrail

1. Name the failure it catches, and at which layer it must sit. Prefer the earliest layer that
   can see the problem — pre-write beats post-write beats alerting.
2. Decide the unsure behaviour. It must withhold, never guess.
3. Write it as a pure function where possible, so it can be unit-tested against a *healthy* and
   an *incident* fixture.
4. **Break the thing it guards and confirm it fails.**
5. Run it against real data before trusting it — the start-time check went red on 11 legitimate
   all-day events the first time it met production.
6. Add it to the table above and to `TEST-SCENARIOS.md` if it has an `[A]` test.

---

---

# The catalogue — every control, with a worked example

The layer tables above are the index. This is the reference: what each control is *for*, how it
actually decides, a concrete example of it working, and the failure it exists to catch.

Read it two ways. Top to bottom, it is the defence architecture. Entry by entry, it is a list of
real incidents — almost every control here was written the day after something got through.

**Status key:** ⬤ live · ◐ live but with a known limit · ○ designed, not yet built.

---

## A. Design-time defaults — the safe outcome is the automatic one

### A1. Unparseable time → the event is skipped ⬤
**Purpose.** Never store a time we had to guess at.
**How it works.** `parseCentralWallTime()` returns `null` rather than a best effort, and the
caller `continue`s past the event.
**Example.** A Frisco card reads `Octobre 22` after a site edit. The parser returns `null`; the
event is absent from tonight's batch and appears again when the format is fixed.
**Catches.** Format drift, locale changes, half-rendered pages.
**Cost, accepted.** A real event goes missing silently — which is why A9 exists.

### A2. The venue's timezone, never the machine's ⬤
**Purpose.** "10:00 AM" must mean the same thing on a laptop in Texas and a runner in UTC.
**How it works.** Every source time is resolved explicitly as `America/Chicago`, DST-aware.
**Example.** Live After 5 starts 5:30 PM Central. In October that is `22:30Z`; in November,
`23:30Z`. The conversion is recomputed per date rather than copied forward.
**Catches.** The 2026-08 incident: the nightly ingest moved to UTC runners and wrote every event
5–6 hours early. Nothing in the code changed — only where it ran.

### A3. Fail-closed classification ⬤
**Purpose.** An uncertain call about *whether children belong here* must hide the event.
**How it works.** `kid_confidence = 'low'` → `kid_relevant = false`, applied to cached results too.
**Example.** A wine-tasting listing with vague wording scores low; it never reaches the app.
**Catches.** Adult events leaking into a children's product.
**Note.** This gates on *kid-relevance* confidence, not *age* confidence. Until v1.3 it gated on
age, so an event plainly fit for families but vague about ages was deleted for the wrong reason.

### A4. Hard adults-only override ⬤
**Purpose.** One rule the model cannot overrule.
**How it works.** `/adults? only|21\s*\+|18\s*\+/` on title and description → hidden, whatever the
classifier said.
**Example.** "Pop & Pour" (a wine event) — hidden, with the model's own reasoning recorded as
*"explicitly requires guests to be 21+"*.
**Catches.** A confidently-wrong model call on the highest-severity axis.

### A5. No decision → no write ⬤
**Purpose.** Never store a value we never decided.
**How it works.** Three paths mark `_skipWrite`: the spend cap refused the call, the call failed,
or an earlier failure means a human must act (A9). Each runner filters the flag before writing.
**Example.** A transient 500 from the model: the event is excluded tonight and classified
normally tomorrow.
**Catches.** Cache poisoning. Writing `false` would read as a real stored answer on the next run
(`prior.kid_relevant !== null`), hiding the event permanently; writing `null` would fail *open*,
because NULL is how library events legitimately pass the API gate.
**Guarded by** `classify-skip.test.ts`, which counts the paths — it failed when a third was added
on 2026-10-21 and had to be updated deliberately.

### A6. The events API gate is source-aware ⬤
**Purpose.** `kid_relevant = NULL` means two different things depending on the source.
**How it works.** NULL passes only for sources we do not classify; for LLM sources it is withheld.
**Example.** Fired for real on 2026-09-01: an excluded event left NULL on an existing row and was
being served unclassified.
**Catches.** The gap between "not applicable" and "never decided".

### A7. Unknown source → no supervision badge ⬤
**Purpose.** Never reassure a parent about drop-off policy we do not know.
**How it works.** `getSupervisionBadge` returns `null` for an unrecognised source; the UI omits
the badge rather than defaulting.
**Catches.** A new source inheriting another's policy by accident.

### A8. LLM spend ceiling ⬤
**Purpose.** Bound the *anomaly*, not the normal case — cost scales with new events, not users.
**How it works.** `MAX_LLM_CALLS_PER_RUN` (default 300 ≈ $1.80 estimated). A refusal is fail-closed
(A5), and a cap hit **fails the run** so it reaches a human.
**Example.** A source whose pagination breaks and returns 10,000 events is classified 300 deep,
then stops, red.
**Catches.** Unbounded spend from a source-side change.

### A9. Why a model call failed ⬤ *(2026-10-21)*
**Purpose.** Distinguish failures by **who fixes them and how fast**.
**How it works.** `classifyLlmFailure()` sorts on the provider's own wording into `billing`,
`auth`, `rate-limit`, `overloaded`, `other`. For `billing`/`auth` the run stops calling the API
and records one line naming the cause and the remedy. Unrecognised text stays `other`.
**Example.** The credit balance hit zero. Before: five failing calls, five cryptic lines,
`errors: []`, and 27 events where 32 were expected. After: one call, and
*"the Anthropic credit balance is exhausted — classification stopped and 5 event(s) were held
back… console.anthropic.com/settings/billing"*.
**Catches.** An operational problem wearing a data problem's clothes.

---

## B. Structural guards — unsafe *shapes* of code cannot merge

These assert against the source text, not behaviour. They exist because a reviewer cannot be
relied on to notice an omission in a 1,200-line module.

### B1. Exactly one `events.upsert` in the ingest ⬤
Catches a future source writing around `guardedUpsert` entirely. Without it, every pre-write
control in Layer C is optional for whoever adds the next source.

### B2. Every `new Date(<arg>)` must be allowlisted with a reason ⬤
Catches reintroduction of the ambient-timezone bug. Adding an entry is deliberate friction — the
rule does not ask whether you were careful, it asks you to write down why. It fired twice during
the Kaleidoscope rebuild; both additions were genuinely safe and both had to be justified.
**Verified by breaking it:** the first version used a regex matching only string literals and
would have passed while the live bug was running.

### B3. Every detail surface renders `<SupervisionCallout>` ⬤
Catches a new surface shipping without the drop-off badge — which had already happened twice.

### B4. `Record<EventSource, true>` completeness ⬤
Catches adding a source without a supervision policy: it becomes a *type error*, not a runtime gap.
The same pattern now guards the data-quality source list.

### B5. No-decision paths and their filters are counted ⬤
See A5. Counts both the places that mark an event undecided and the places that filter it out.

### B6. Doc↔test parity ⬤
Catches `TEST-SCENARIOS.md` claiming coverage that no longer exists. Runs in CI.

### B7. The alert's own regression suite ⬤
`notify-alert.test.ts` extracts the `notify` script straight from `ingest.yml` (never a copy, so
it cannot drift) and replays all three real drill failures plus a total outage.
**The alert is a guardrail, so it gets a guardrail.**

---

## C. Pre-write — the strongest layer

`guardedUpsert` → `screenBatch`. Nothing in this layer is detection; all of it is prevention.

### C1. Implausible start time → drop the event ⬤
**Example.** A 4:00 AM "story time" is dropped while the rest of the batch writes normally.
**Catches.** Individually broken times. Exact midnight is allowed, because sources legitimately
use 00:00 for all-day entries — a rule learned when the check first met production and went red
on 11 genuine all-day events.

### C2. Uniform shift → reject the whole batch ⬤
**Purpose.** Catch the bug class that *looks* plausible.
**How it works.** If ≥80% of ≥20 overlapping events moved by the **same** non-zero offset, the
batch is systemically wrong, not rescheduled.
**Example.** 2026-08-12, the first UTC-runner night: every Frisco and Plano event moved by exactly
−300 minutes. A genuine reschedule moves *one* event by an arbitrary amount.
**Catches.** DST errors, a source switching timezone, off-by-one-day parses — **including shifts
that land at perfectly reasonable hours**, which no plausible-hours rule can see.
**Escape hatch.** `INGEST_ALLOW_TIME_SHIFT=1` for an intended mass correction. It forgives only
this rule; implausible times stay blocked.

### C3. Shrink → reject the whole batch ◐ *(fixed 2026-10-19)*
**Purpose.** A half-loaded scrape must not read as "these events were cancelled".
**How it works.** Reject if the batch is under half the **upcoming** stored rows.
**The bug this carries.** It originally compared against *every row ever written*, past events
included. A scrape returns a forward window; the stored pile grows forever. The denominator grew
nightly while the numerator did not, so the rule was a **countdown, not a check** — Frisco tripped
on 210 events against 525 stored (357 of them past) and froze for three nights.
**A second defect hid the first.** PostgREST silently caps an unpaginated select at 1,000 rows, so
Plano (1,683 stored) was judged against an arbitrary slice and passed at a fake threshold of 500
while Frisco failed on the same bug. The stored read now pages explicitly.
**Lesson worth keeping.** *A ratio is only a guardrail if both sides measure the same thing.* If a
threshold's denominator grows with time, you have written a timer.

### C4. Cancellation purge ⬤ *(2026-10-20)*
**Purpose.** Notice what **stopped** arriving — the only failure mode that needs no bad data.
**How it works.** After a batch is written, delete upcoming rows the source no longer lists.
Three narrowings, each one bought with a bug:
- **upcoming only** — a past event cannot be cancelled;
- **compared against the whole incoming batch**, including events C1 dropped, because those still
  exist at the source;
- **capped at 25%** — above that it reports for a human instead of deleting.
**The horizon detail.** The purge's cutoff is **now**; the guard's is **midnight**. A listing drops
an event the moment it finishes, so using midnight would delete events that had merely happened
that morning. The dry run caught exactly this: 5 queued deletions, of which 3 were genuinely gone
(HTTP 404) and 2 were live story times that had finished at 10 and 11 AM.
**Caught in production.** Three "Teen Anime Club" sessions the library had deleted, one four days
out, plus a Plano staff event titled **"test"** sitting on Christmas Day.

### C5. Cannot read current state → refuse to write ⬤
If the stored-events read fails, the guard has nothing to compare against and writes nothing.
**Catches.** Writing blind during a database incident.

---

## D. Source-shape guards — "is this still the source we think it is?"

Added across 2026-10-20/21, after two sources changed shape in three days. These sit between the
fetch and the batch, and all of them fail closed.

### D1. Cards seen vs events parsed ⬤
**Purpose.** Tell "the source published nothing" from "we no longer understand the source".
**How it works.** Count listing cards; if cards > 0 and parsed = 0, raise an error naming it.
**Example.** BiblioCommons moved event links from `/events/<id>` to `/v2/events/<id>`. Twenty cards
per page, zero understood, and the run reported `fetched: 0, errors: []`. The guards protected the
data perfectly and the log named the wrong problem.
**Catches.** Silent format drift — the failure that looks like an empty calendar.

### D2. The absence of structured data is the filter ⬤
**Purpose.** Decide what counts as an event using the publisher's own markup.
**How it works.** A Kaleidoscope page with no schema.org `Event` JSON-LD is not an event.
**Example.** "Host an event" and "Vendor opportunities" live under `/events/` and are excluded with
no keyword list to maintain.

### D3. Transcription checksum ⬤
**Purpose.** Never trust our reading of marketing prose without a control value.
**How it works.** Dates are scraped from copy ("September 10: Jade Nikol"), and the machine-readable
next-occurrence date **must appear** in what we parsed. If it does not, the whole list is dropped
and only the confirmed occurrence is published.
**Catches.** A reformatted page producing a plausible-looking but wrong set of dates.

### D4. The series weekday resolves the omitted year ⬤
**Purpose.** The copy prints "September 10" with no year.
**How it works.** Of the years either side of the confirmed date, at most one puts that date on the
series' weekday; a date matching none is not an occurrence and is skipped.
**Catches.** Off-by-one-year dates, and stray dates in unrelated copy.

### D5. A cadence is clipped by its stated end ⬤
**Purpose.** A rule without its bound is half a sentence.
**Example.** "SaturYay: Holiday Edition — every Saturday **through Dec 19**". The first version read
the rule, ignored the deadline printed beside it, and generated Saturdays into January.

### D6. Published beats inferred; the seasonal variant beats the standing series; different families never compete ⬤
**Purpose.** Decide what actually happens in one slot without inventing an answer.
**How it works.** A slot is a time, a place **and a programme family**. Within a family: a published
occurrence wins; otherwise the **shorter stated run** wins (four weeks beats fifty-five); if nothing
distinguishes them, both are dropped.
**Example.** SaturYAY and its Holiday Edition both claim 10 AM Saturdays — the Holiday Edition takes
Nov 21 → Dec 19. A vendor market and a food drive the same morning are different families, so all of
them show. **That last rule came from the product owner, not the data:** the first version treated
any shared slot as a rivalry and emptied the December Saturdays.
**Catches.** Duplicate listings of one event, and the opposite error of hiding real ones.

### D7. Inference is bounded to 8 weeks ⬤
**Purpose.** Dates we worked out ourselves have a short shelf life.
**How it works.** A weekly programme with no published list gets a rolling 8-week horizon,
re-anchored nightly on the venue's own "next date".
**Why short.** Exposure to a wrong date is bounded by the horizon. The park's stated end date moved
from "Dec 18 2027" to "Nov 13 2027" in two days — those claims are soft, and the horizon does not
depend on them.

---

## E. Publication guards — what we are entitled to claim

### E1. One indexability gate, shared ⬤
**Purpose.** The sitemap, the page's `robots` tag and the city lists must never disagree about
whether an event is public.
**How it works.** `isIndexableEvent()` is the single definition; all three call it.
**Catches.** A sitemap advertising a page that marks itself `noindex`.

### E2. An inferred date never reaches a machine-readable surface ⬤ *(2026-10-20)*
**Purpose.** Show a parent our best guess; never state it as fact to a search engine.
**How it works.** `date_inferred = true` → excluded from the sitemap, `noindex`, and **no Event
JSON-LD emitted**, while the page still renders.
**Example.** SaturYAY on 31 October renders with the note *"Date expected from the organizer's
'every saturday' schedule — only the next session is listed by the venue, so confirm before you
go"*, and tells Google nothing.
**Catches.** Publishing a structured claim about an occurrence nobody announced.

### E3. The user is told which dates are expected ⬤
The disclosure line above is a control, not decoration: it is the thing that makes D7 honest.

---

## F. Post-write — detection against real data

`npm run validate`, run as the `data-quality` job after every nightly ingest. Already tabulated in
Layer 4; the two worth narrating:

### F1. Per-source freshness (≤48h) ⬤
**The bug it replaced.** Freshness was one query for the newest write across the *whole* table.
Plano writes ~600 rows a night, so that timestamp was always minutes old — the check was
**mathematically incapable of failing** unless all four sources died at once. It had been
documented as per-source since the day it was written.
**Lesson.** *A guardrail whose input is an aggregate over healthy and unhealthy subjects cannot
see the unhealthy one.* Ask the question per subject, or do not claim the guardrail.

### F2. No unclassified LLM events stored ⬤
Names the offending events rather than printing a count — a check you cannot act on is a check you
will learn to ignore.

---

## G. Operating tools

### G1. `INGEST_DRY_RUN=1` ⬤ *(2026-10-20)*
**Purpose.** Ask "what would tonight do?" without finding out the hard way.
**How it works.** Fetch, screen and decide exactly as normal; print the batch, the guard verdict
and the purge list; write nothing.
**What it has caught.** The purge horizon bug before a single row was deleted; two silent patch
failures that the unit suite passed straight through; and the billing outage, by making the
27-vs-32 discrepancy visible as a list rather than a number.
**Principle.** *A delete path with no rehearsal is a delete path you test in production.*

### G2. A run that writes nothing exits non-zero ⬤
Keeps "the ingest succeeded and did nothing" from being a passing state.

### G3. The weekly live-site read ◐
Not automated, not optional. **Both** timezone bugs and the duplicate SaturYAY were found this way
and none by a test. It is the most effective detector listed in this document and the least
reliable, which is a standing argument for E-layer automation.


---

# Governance framework coverage

Open Eventz mapped onto the standard AI-governance model — three failure categories, five
instruments. Kept here so it can be **re-scored as gaps close**: the "Gap" column *is* the backlog.

**The structural fact that shapes every row below.** Open Eventz is a *scraped data pipeline with
an LLM classifier in the middle*, not a user-facing generative feature. Claude is called from
exactly one place — `src/lib/age-inference.ts`, model `claude-sonnet-4-6`, at **ingest time** —
and both LLM-touching endpoints sit behind `CRON_SECRET`. **No user free-text ever reaches a
model.** That deletes most of the misuse surface and makes output correctness carry nearly all
the risk.

## Table 1 — The three failure categories

| Category | What it means | Does it apply here? | What we cover today | The gap |
|---|---|---|---|---|
| **Content failure** | The output itself is the problem. The system worked mechanically — called the API, got a response, rendered it — but what it produced is wrong, malformed, or erodes trust. The feature "succeeded" and still failed the user. | **Yes — our dominant risk**, in a different form. For a generative product this means bad prose; here the content is **event data**: start times, age ranges, kid-relevance, price, supervision guidance. A wrong start time is our broken bio — and worse, because a parent *acts* on it. | **Pre-write guard** (`screenBatch`): implausible times dropped, uniform shift or shrink rejects the batch — wrong data cannot be stored at all. **Post-write gate**: 13 checks against the live DB (age variety, adult-title leaks, filter-narrowing, start-time plausibility, freshness, live-source canary). **300 unit tests** under two timezones in CI. **Structural guards**: one write path only; every detail surface must render the supervision badge. **Fail-closed classification**: LLM error or low confidence hides the event. | LLM **classification quality has no automated eval on change** — `calibrate:price` is manual. No adversarial or edge cases (non-English, empty description, ambiguous age). **Nothing checks the rendered page** — both real incidents were caught by a human opening the site, not by a test. |
| **Behavioural failure** | The user's intent is the problem. Someone uses the feature for something it was never built for — offensive input, prompt injection, out-of-scope use — and the system complies, laundering it through your brand. You did not write the content, but your name is on it. | **Mostly no, for a structural reason.** There is no user-input path to a model: users filter and browse, they never submit text. That *deletes* the misuse surface rather than mitigating it. **Two real analogues remain**: scraped event text is untrusted input to our prompt, and we publish third-party descriptions verbatim under our masthead. | **Architecture, not a control** — the strongest kind: no user free-text surface exists. `/api/infer-age` and `/api/ingest` behind `CRON_SECRET`, which closed a genuine unauthenticated cost-DoS vector in July 2026. **Refusal equivalent**: fail-closed classification plus a hard `adults only / 21+ / 18+` override, so the model cannot opt an adult event into a kids app. Civic and library sources — low base rate of hostile content. | The prompt does **not** tell the model to treat event text as *data, never instructions* — injection via a scraped description is unguarded. **No content filter on descriptions we render verbatim.** Low likelihood, non-zero severity: brand risk rather than user harm. |
| **Economic failure** | The cost is the problem. Usage — legitimate or hostile — drives spend faster than value. No rate limit, no cap, no alert; you find out from the bill. | **Yes, but structurally bounded**, and the reason is the interesting part: LLM cost scales with **number of new events, not number of users**. Classification is nightly and batched, results are cached, and re-running an unchanged source costs **zero calls** (verified — a Play Frisco re-run after a refactor made none). A traffic spike costs Vercel bandwidth and Supabase egress, not tokens. | Batch, not per-request. Caching makes repeat runs free. No user-triggered generation exists. Both paid endpoints secret-gated. Per-run `llm_calls` and `llm_cost_usd` recorded in `ingest_runs` and surfaced on the Technical dashboard. | **No hard cap** — a source suddenly returning 10,000 events would be classified in full. **`llm_cost_usd` is `calls × $0.006`, an estimate, not metered spend** — a dashboard number, not a control. No spend alert or threshold. No rate limit on the public `/api/events` (Supabase egress). |

## Table 2 — The five instruments

| Instrument | What it is | What we cover today | The gap |
|---|---|---|---|
| **1. Evals at scale** | A suite measuring whether the feature does what it should, extended with **edge cases** and **adversarial cases**, running **automatically** on every prompt change, model swap and deploy — so quality is a system property, not a launch criterion. | **300 unit tests** on every push, run under `TZ=UTC` **and** `TZ=America/Chicago`. The deterministic half of the price-calibration set runs free in CI; `calibrate:price` runs the **real model** against ground-truth fixtures. **Incident-derived cases**: every production bug becomes a permanent test — the timezone incident encoded with *verbatim source strings*, the age break as "healthy" vs "the-incident" fixtures. A doc-parity CI job stops the coverage doc claiming tests that no longer exist. | The **real-model eval is manual with no trigger** — the textbook "eval suite that only runs manually is a scaling liability." Nothing detects that the prompt or the `MODEL` constant changed. **No adversarial cases.** Calibration is price-focused; **kid-relevance classification has no eval of its own**. |
| **2a. Guardrail — input classifier** | Fires **before** the model is called, rejecting input the feature was never designed for so the model never sees it. | **N/A in the user sense** — there is no user input. The nearest equivalent is the small **governance-keyword pre-filter** (city council, board meeting, work session) that skips civic-admin noise so we do not pay to classify it. | Scraped source text is not screened for injection before entering the prompt. |
| **2b. Guardrail — output classifier** | Fires **after** the model responds and before the user sees it, catching broken formatting, wrong length or off-criteria output and falling back to a safe default. | **Our strongest instrument, and broader than the standard version.** `screenBatch` validates the whole batch **before the DB write**: per-event implausible-time drop, **uniform-shift batch rejection** (≥80% of ≥20 overlapping events moving by the same offset), shrink rejection, and refuse-if-we-cannot-read-current-state. On abort, purge and cleanup are skipped so previously-correct rows survive. It compares against **prior state**, which a stateless output classifier cannot do. | Covers **times and volume, not semantics**. A confidently-wrong `kid_relevant` passes every rule. |
| **2c. Guardrail — refusal layer** | System-prompt instructions stating what the feature is *not* for, so the model itself refuses out-of-scope use. | The behavioural equivalent, **enforced in code rather than prose**: LLM failure or `low` confidence → `kid_relevant = false`; hard override for `adults only / 21+ / 18+`. Applied uniformly across cached and fresh results. | **Not expressed in the prompt** — enforcement is post-hoc. No explicit "you are a kids-event classifier, refuse anything else" framing. |
| **2d. Guardrail — rate limits & cost cap** | Per-user, per-window generation limits plus a daily spend ceiling, degrading gracefully when hit. | **Structural** (no user-triggered generation exists, so nothing to rate-limit per user; secret-gating prevents external triggering) **plus a hard per-run ceiling** — `MAX_LLM_CALLS_PER_RUN`, default 300, in `src/lib/llm-budget.ts`. Refused calls are **fail-closed**: the event is excluded from the write entirely, so it is neither shown nor cached, and gets classified normally once the cap is raised. A cap hit **fails the run**, so it reaches a human through the alert rather than sitting in a log. Raising it is a deliberate act, like `INGEST_ALLOW_TIME_SHIFT`. | Spend is still **estimated, not metered** (`calls × $0.006`) — a dashboard number, not a control. The dollar backstop is account-side and **is set**: $5/month with an email alert at $2, auto-reload off (Console → Settings → Billing). **Note the arithmetic:** one capped run is ~300 × $0.006 ≈ **$1.80**, so two capped runs in a night would consume most of a $5 month. That is tolerable only because a cap hit **fails the run and alerts** — you would know after the first night, not the third. Revisit `DEFAULT_MAX_LLM_CALLS_PER_RUN` if the monthly limit ever drops. |
| **3. Observability** | Every call traced — input, output, model version, latency, cost, guardrails fired — feeding a dashboard with **alert thresholds**, turning a black box into something manageable. | `ingest_runs` per run: `ran_at`, `duration_ms`, status, per-source counts, `llm_calls`, `llm_cost_usd`, errors → Technical dashboard. **Per-event auditability is unusually strong**: `age_confidence`, `age_reasoning` and `price_reasoning` are stored on every classified event, so any decision can be explained later. GA4 → BigQuery → Functional dashboard. **Failure alert, two layers**: GitHub's own workflow-failure email (primary — no code, verified to fire even when our own alert broke) plus a best-effort GitHub Issue with triage instructions (secondary, falls forward through three delivery options). **Proven, not assumed**: testable on demand via the `simulate_failure` fire drill, and all three real drill failures are permanent regression tests. | **No production application-error tracking** — Sentry planned, blocked on a DSN. **No alert thresholds** on cost spike or guardrail hit-rate; alerting is binary pass/fail. Cost is estimated, not metered. No latency percentiles. |
| **4. Fallbacks** | A written table: every row a failure scenario, the right column exactly **what the user sees** and what the system does. A design artifact that belongs in the spec, before launch. | The behaviours exist and are consistently fail-safe: LLM failure → event hidden · unparseable time → event skipped · batch rejected → previous correct rows kept and purge skipped · missing image → omitted (a *broken* URL is still an empty box on the server page — found by writing the table) · unrecognised source → no supervision badge rather than a wrong one · one source down → the others unaffected (per-source jobs, `fail-fast: false`). | **Written 2026-08-17** — see [Fallback table](#fallback-table--what-the-user-sees-when-something-breaks). Writing it immediately surfaced **six undefined behaviours** the scattered code comments had hidden, two of them user-facing and actively misleading (a 500 renders as "No events match your filters"; a thrown fetch spins forever). Those six are now the open work — the instrument itself is in place. |
| **5. Audit trail** | Per-call logging — what went in, what came back, which guardrails fired, what it cost — on a retention schedule, doubling as the **feedback loop** into the eval suite. | **Per-event LLM reasoning stored permanently** (`age_reasoning` / `price_reasoning`) — every automated decision is explainable months later, which is the part most teams skip. `ingest_runs` is a durable per-run record including errors, and guard rejections are written into it. **The feedback loop is real and documented**: every incident becomes a test case *plus* a BUILD-LOG entry *plus* a playbook principle. | No retention or deletion schedule. **Guardrail hit-rate is not aggregated** anywhere. Minimal per-user logging — but that is a deliberate privacy posture (anonymous like counts, RLS-locked tables), so it should be recorded as a **decision** rather than left looking like an oversight. |

## Scoring summary

| | Strong | Partial | Open |
|---|---|---|---|
| **Categories** | Content · **Economic** | *(none)* | Behavioural (low severity) |
| **Instruments** | 2b output classifier · **2d cost cap** · 4 fallback table · 5 audit trail | 1 evals · 2c refusal · 3 observability | *(none)* |

**Priority order to close:** eval-on-change trigger → adversarial classifier cases → prompt-injection framing
→ Sentry → the two remaining fallback gaps (staleness signal, server-page broken image).

*Done 2026-08-17: the fallback table itself, plus four of the six gaps it surfaced.*

---

# Fallback table — what the user sees when something breaks

Every row is a failure scenario; the right-hand columns are what the system does and **what the
user actually sees**. Written 2026-08-17 by reading the code, not from memory.

The discipline: *a row you cannot fill is an undefined behaviour you have just found.* Six of
them turned up on the first pass and are listed at the bottom — that is the table earning its
keep, not a sign it was written badly.

Status key: **OK** = deliberate and sound · **WEAK** = degrades, but the user gets no useful
signal · **BAD** = the user is actively misled.

## Ingest and data

| Failure | What the system does | What the user sees | |
|---|---|---|---|
| LLM classification errors, or returns `low` confidence | Event marked not kid-relevant (fail-closed) | Event is simply not listed | OK |
| Event start time unparseable | Event skipped, never stored at a guessed time | Event is not listed | OK |
| Batch fails the pre-write guard | Nothing written, purge skipped, run goes red, alert fires | Previously-correct events remain — the list is slightly **stale, never wrong** | OK |
| One source fails to scrape | Other three unaffected (per-source jobs, `fail-fast: false`) | That source's events age; the rest stay current | OK |
| **All** sources fail | No writes; freshness check only trips at 48h | List silently goes stale for up to two days | **WEAK** |
| Event has no image | Image omitted entirely | No banner; layout unaffected | OK |
| Image URL 404s | Client drawer hides it via `onError`; the server page has no such hook | Drawer: clean. `/events/[id]`: **an empty box** | **WEAK** |
| Source exposes no age data | Falls back to all-ages and counts it; >50% fallback raises a run warning | Event shows without a specific age badge | OK |
| Unrecognised source | `getSupervisionBadge` returns null | No supervision callout, rather than a wrong one | OK |

## App and runtime

| Failure | What the system does | What the user sees | |
|---|---|---|---|
| `/api/events` returns 500 (Supabase down) | Non-OK status throws; a distinct **error state**, never the empty state | "We couldn’t load events right now." + **Try again**. Filters preserved | OK |
| `/api/events` fetch throws (offline, DNS) | Same error state; `setLoading(false)` moved into `finally` | Same as above — the spinner can no longer hang | OK |
| `/api/venues` fails | Caught; the event list is untouched | Note inside the map: "Map locations couldn’t be loaded right now." + **Try again** | OK |
| Likes GET fails | Explicit `.catch()` — no unhandled rejection | Count is simply absent; nothing untrue is claimed | OK |
| Likes POST fails | Optimistic flip is **reverted** (state + localStorage) | Toggle returns to its true value, with "Couldn’t save that — try again." | OK |
| Event id not found | `notFound()` | Standard 404 | OK |
| Event is non-indexable | `noindex` metadata; page still renders | Page works normally, just not in search | OK |
| BigQuery key absent | `bigquery.ts` catches and returns empty | Dashboard renders without the funnel panel | OK |
| No ingest runs recorded yet | Graceful empty state | Dashboard shows an empty pipeline panel | OK |

## Alerting

| Failure | What the system does | What the user sees | |
|---|---|---|---|
| Secondary alert (the Issue) fails | Falls forward through three delivery options; if all fail, loud error + red job | Still receives the **primary** workflow-failure email | OK |
| Primary email notification disabled | Nothing else watches | **Nothing reaches anyone** — the whole chain rests on one account setting | **WEAK** |

## What this table found

Six gaps, none visible before the rows were written out. **Four are now fixed (2026-08-17);
two remain open.**

| | Gap | Status |
|---|---|---|
| 1 | `/api/events` 500 rendered as "No events match your filters" — blaming the user for our outage | **Fixed** — distinct error state, "We couldn’t load events right now." + Try again |
| 2 | A thrown fetch left the spinner running forever | **Fixed** — `setLoading(false)` moved into `finally` |
| 4 | `/api/venues` failing gave an empty map with no explanation | **Fixed** — caught, with an in-map note and Try again |
| 5 | A failed Likes POST left the UI claiming "Attending" | **Fixed** — the optimistic flip is reverted, with an inline note |
| 3 | All-sources-fail is invisible for up to 48h — no staleness signal to the visitor | **Open** |
| 6 | A broken image URL leaves an empty box on `/events/[id]` (server-rendered, so no `onError`) | **Open** |

Fixes 1 and 2 are covered by three Playwright cases (§1.7) that assert the error and empty
states stay **distinct** — they were one state until now, and that was the bug. The error case
was verified to fail with the guard removed, then pass with it restored.

A note on what these were. **None were data-correctness bugs** — the pre-write guard still
guaranteed no wrong event times were published throughout. They were **honesty-of-failure**
bugs: the app degraded without telling the truth about why. That is its own category of harm,
and it is invisible to every test that only asks whether the happy path works.

While fixing them, one more of the same kind was folded in: the Share button used a native
`alert()` popup — an OS-level modal you must dismiss — where every other message in the app is
a calm inline note. Now inline.
