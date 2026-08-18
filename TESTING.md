# Testing — Open Eventz

The canonical **"what to run after any change"** guide. Update *this file in place* as the test
setup evolves; the versioned scenario docs (in `../02-product`) are point-in-time history.

> **Related, but a different question.** This file = *how do I run the checks?* ·
> `TEST-SCENARIOS.md` = *what behaviour is covered?* · **[`GUARDRAILS.md`](./GUARDRAILS.md)** =
> *what stops bad data reaching a user, and where does each control sit?* Tests prove the code
> does what we intended; guardrails handle reality not matching our intent. The timezone
> incident is the proof they're distinct — every test passed while production served wrong
> event times.

> **Timezone note:** CI runs the unit suite **twice**, under `TZ=UTC` (the runner's own) and
> `TZ=America/Chicago`. Run `TZ=UTC npx jest` locally before touching any date handling — a
> suite that only runs in your machine's timezone cannot catch a timezone bug.

## Run everything (before every commit)

```bash
npm run typecheck    # tsc --noEmit
npm test             # Jest unit tests (pure logic — fast, no infra)
npm run test:e2e     # Playwright smoke (UI flows, /api mocked)
```

> **Building while a dev server is running — use a separate output dir:**
> ```bash
> NEXT_DIST_DIR=.next-check npm run build
> ```
> `next build` and `next dev` both write to `./.next`, so a plain `npm run build` wipes the
> directory underneath a running dev server and kills it. That has cost us a broken local
> preview *and* a failed push (Playwright then cold-starts its own server and hits the 120s
> `webServer` timeout). `next.config.ts` reads `NEXT_DIST_DIR`; it is unset on Vercel, so
> production builds still use `.next` unchanged.
>
> **If typecheck fails inside `.next/dev/types/`**, that is a *generated* file left half-written
> by a dev server that died mid-write — not a real error. Clear it and re-run:
> `rm -rf .next/dev && npm run typecheck`.

CI runs all three automatically on push / PR — see `.github/workflows/ci.yml`.

**Git hooks** (`core.hooksPath=.githooks`): `pre-commit` runs `typecheck + unit` (fast, browser-free). **`pre-push` runs `typecheck + unit`, then the Playwright E2E smoke suite — but only when a browser is installed.** If no browser is found it prints a warning and *skips* E2E (so a browserless clone/CI-runner isn't blocked and forced onto `--no-verify`); CI runs E2E unconditionally regardless (`ci.yml`, job `e2e`). Install the browser locally with `npx playwright install chromium`. **Discipline for UI changes:** make sure the browser is installed so pre-push actually *runs* E2E rather than skipping it — a green pre-commit is not a green pipeline (this bit us on the Weekend Paper reskin: unit/typecheck green locally, E2E red in CI — see BUILD-LOG).

**LLM price calibration** (manual, costs money): `npm run calibrate:price` runs the real Claude model against the ground-truth set in `src/lib/__fixtures__/price-calibration.ts` and prints a pass/fail table. Run it when the price/age prompt or model changes, or when drift is suspected — NOT in CI. Needs `ANTHROPIC_API_KEY`. The deterministic half of the calibration set runs for free in the normal Jest suite.

**Data-quality gate** (post-ingest, runs against REAL data): `npm run validate` runs `scripts/validate-data.ts` against the **live Supabase** — real-data invariants (Frisco age variety, **no adult-title leaks**, the Toddler filter actually **narrows**, per-source non-empty, freshness) + a **live-source canary** (BiblioCommons still exposes resolvable `audience_ids`) + a real-data filter regression. Writes a ✓/✗ summary and **exits non-zero on any violation**. Runs automatically as the **`data-quality` job in `.github/workflows/ingest.yml`** (`needs: ingest`) after the nightly per-source ingest — so a silent source change (a scraper going empty, a source moving its data) becomes a **RED pipeline**, not a green ingest over corrupt data. *Why this layer exists (short):* logic/mocked tests can't catch a **data** break — full story in BUILD-LOG "Frisco age filter broke". The pure checks live in `src/lib/data-quality.ts` (unit-tested against a "healthy" and a "the-incident" fixture). Needs the Supabase env vars (local: `.env.local`; CI: the `Production` environment secrets).

## Test layers

| Layer | Tool | Location | Covers |
|---|---|---|---|
| **Unit** | Jest | `src/lib/*.test.ts` | parsers, badge logic (`getAgeBadge`/card/detail), age filter, recurring detection; **v1.2:** price (`price.test` — `getPriceBadge` confirmed-vs-inferred `✦`, `interpretCostField`, calibration set + known-gaps), combined disclosure (`inference-disclosure.test`), measurement framework (`measurement.test` — WAD/funnel/KPIs), technical-dashboard metrics (`technical-metrics.test`); **2026-08:** Frisco audience-id → age mapper (`age-parsers.test` — `mapFriscoAudienceIds`) and data-quality checks (`data-quality.test`) |
| **E2E smoke** | Playwright | `e2e/*.spec.ts` | city tabs, dropdowns, multi-select, badge rendering (incl. `Free ✦`/`Paid ✦` and Cost-field-confirmed plain `Free`), combined disclosure, detail view, per-city persistence, conditional **"Clear filters"** (hidden by default, appears when a filter is non-default) — **all `/api/*` mocked** |
| **Data-quality** | tsx + Supabase | `scripts/validate-data.ts`, `src/lib/data-quality.ts` (+`.test`) | **REAL-data** post-ingest gate: Frisco age variety, no adult-title leaks, Toddler-filter-narrows, per-source non-empty, freshness, + live-source canary. Runs as the `data-quality` job in `ingest.yml` (`needs: ingest`); `npm run validate` locally. Exits red on any violation. |
| **Manual** | human | `../02-product/functional-test-scenarios-v1.2-price-analytics.md` (latest) | LLM classification/price accuracy (`npm run calibrate:price` + spot-checking Play Frisco `kid_relevant` reasoning), GA4 event firing (Realtime/DebugView), `/dashboard` with real data, map rendering |

## Manual scenario docs (history + reference)

- `functional-test-scenarios.md` — **v1.0 baseline**
- `functional-test-scenarios-v1.1-badges-filters.md` — **v1.1** badge/filter changes (latest)

The **latest** versioned doc is the current manual run-list; older docs are the change history.
Automated coverage (Jest + Playwright) supersedes the pure-logic and UI-wiring cases in those docs —
what remains manual is only what can't reasonably be automated (live scrape/ingest, inference accuracy).

## Adding coverage for a new change

1. **Unit** — add/extend Jest tests for any new pure logic (badge rules, filters, parsers, mappers).
2. **E2E** — add a Playwright case for any new UI flow; mock the relevant `/api` response in-test.
3. **Data-quality** — for **ingest / source / data** changes, add or extend the real-data invariants in `src/lib/data-quality.ts` (+ its unit test) so a future silent source break turns the pipeline **red**. Logic tests over mocked data can't catch bad *data* — this layer is the guardrail pointed at the real output. Adding a new source? Give it a non-empty + freshness check at minimum.
4. **Manual** — only for things you genuinely can't automate (live scrape/ingest, LLM classification accuracy, map); record them in a new versioned scenario doc.
