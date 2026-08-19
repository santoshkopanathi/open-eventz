# Guardrails

**What stands between a defect and a parent standing outside a locked library.**

This is the single inventory of every control protecting Open Eventz data, where each one sits,
and what it catches. Started 2026-08-15 after the "5:00 AM story time" incident reached real
users.

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
| LLM classification fail-closed (`classifyEvents`) | LLM error, or a `low`-confidence kid/adult call | `kid_relevant = false` — event hidden |
| Hard adults-only override | "21+", "18+", "adults only" slipping past the model | hidden regardless of the LLM's view |
| Unparseable start time (`parseCentralWallTime` → `null`) | malformed or unexpected date formats | event **skipped**, never stored at a guessed time |
| Explicit venue timezone, never the machine's | the runtime deciding what "10:00 AM" means | conversion is always America/Chicago, DST-aware |
| `getSupervisionBadge` returns `null` for an unknown source | a new source with no drop-off policy defined | **no badge** rather than a wrong reassurance |
| LLM spend ceiling reached (`llm-budget.ts`) | a source anomaly (e.g. 10,000 events) running up unbounded cost | the event is **excluded from the write** — not shown, not cached, re-tried next run |
| Account-level spend limit **(set: $5/month, email alert at $2, auto-reload off)** | our own cap being wrong, or any spend path we did not anticipate — including Claude Code and Playground usage, which our in-code cap does not see | API usage pauses at the limit; admins are emailed at $2. Console → Settings → Billing |

## Layer 2 — Structural guards (architecture, enforced in CI)

These don't test behaviour; they make an unsafe *shape* of code impossible to merge.

| Guardrail | Catches | File |
|---|---|---|
| Only **one** `events.upsert` may exist in the ingest module | a future source quietly bypassing the write guard | `no-ambient-timezone.test.ts` |
| Every `new Date(<arg>)` in ingest must be allowlisted with a reason | reintroducing the ambient-timezone bug | `no-ambient-timezone.test.ts` |
| Every event detail surface must render `<SupervisionCallout>` | a surface shipping without the drop-off badge (has happened twice) | `supervision-surfaces.test.ts` |
| `Record<EventSource, true>` completeness check | adding a source without a supervision policy | `supervision.test.ts` |
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
| **Shrink** — batch smaller than half the stored set | a partial/failed scrape being read as "events cancelled" | **whole batch rejected** |
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
| Per-source non-empty + freshness (≤ 48h) | a source silently producing nothing |
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

Recorded openly so they're chosen rather than discovered.

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
