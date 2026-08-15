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

## Layer 2 — Structural guards (architecture, enforced in CI)

These don't test behaviour; they make an unsafe *shape* of code impossible to merge.

| Guardrail | Catches | File |
|---|---|---|
| Only **one** `events.upsert` may exist in the ingest module | a future source quietly bypassing the write guard | `no-ambient-timezone.test.ts` |
| Every `new Date(<arg>)` in ingest must be allowlisted with a reason | reintroducing the ambient-timezone bug | `no-ambient-timezone.test.ts` |
| Every event detail surface must render `<SupervisionCallout>` | a surface shipping without the drop-off badge (has happened twice) | `supervision-surfaces.test.ts` |
| `Record<EventSource, true>` completeness check | adding a source without a supervision policy | `supervision.test.ts` |
| Doc↔test parity | `TEST-SCENARIOS.md` claiming coverage that no longer exists | `scripts/check-doc-parity.mjs` |

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
| **Ingest failure alert** | The `notify` job opens (or comments on) a GitHub Issue labelled `ingest-failure` whenever a source job or the data-quality gate fails. GitHub emails the repo owner. No new secrets — uses the built-in token. The issue must be **closed**, so it can't be skimmed past like an email. |
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
