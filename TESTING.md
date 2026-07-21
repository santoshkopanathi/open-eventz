# Testing — Open Eventz

The canonical **"what to run after any change"** guide. Update *this file in place* as the test
setup evolves; the versioned scenario docs (in `../02-product`) are point-in-time history.

## Run everything (before every commit)

```bash
npm run typecheck    # tsc --noEmit
npm test             # Jest unit tests (pure logic — fast, no infra)
npm run test:e2e     # Playwright smoke (UI flows, /api mocked)
```

CI runs all three automatically on push / PR — see `.github/workflows/ci.yml`.

**Git hooks** (`core.hooksPath=.githooks`): `pre-commit` and `pre-push` both run `typecheck + unit` (fast, browser-free). **E2E is CI-only** — no hook runs it, so run `npm run test:e2e` manually before pushing UI changes, or rely on the CI `e2e` job.

**LLM price calibration** (manual, costs money): `npm run calibrate:price` runs the real Claude model against the ground-truth set in `src/lib/__fixtures__/price-calibration.ts` and prints a pass/fail table. Run it when the price/age prompt or model changes, or when drift is suspected — NOT in CI. Needs `ANTHROPIC_API_KEY`. The deterministic half of the calibration set runs for free in the normal Jest suite.

## Test layers

| Layer | Tool | Location | Covers |
|---|---|---|---|
| **Unit** | Jest | `src/lib/*.test.ts` | parsers, badge logic (`getAgeBadge`/card/detail), age filter, recurring detection; **v1.2:** price (`price.test` — `getPriceBadge` confirmed-vs-inferred `✦`, `interpretCostField`, calibration set + known-gaps), combined disclosure (`inference-disclosure.test`), measurement framework (`measurement.test` — WAD/funnel/KPIs), technical-dashboard metrics (`technical-metrics.test`) |
| **E2E smoke** | Playwright | `e2e/*.spec.ts` | city tabs, dropdowns, multi-select, badge rendering (incl. `Free ✦`/`Paid ✦` and Cost-field-confirmed plain `Free`), combined disclosure, detail view, per-city persistence — **all `/api/*` mocked** |
| **Manual** | human | `../02-product/functional-test-scenarios-v1.2-price-analytics.md` (latest) | live ingest + Cost-field scrape, LLM price accuracy (`npm run calibrate:price`), GA4 event firing (Realtime/DebugView), `/dashboard` with real data |

## Manual scenario docs (history + reference)

- `functional-test-scenarios.md` — **v1.0 baseline**
- `functional-test-scenarios-v1.1-badges-filters.md` — **v1.1** badge/filter changes (latest)

The **latest** versioned doc is the current manual run-list; older docs are the change history.
Automated coverage (Jest + Playwright) supersedes the pure-logic and UI-wiring cases in those docs —
what remains manual is only what can't reasonably be automated (live scrape/ingest, inference accuracy).

## Adding coverage for a new change

1. **Unit** — add/extend Jest tests for any new pure logic (badge rules, filters, parsers).
2. **E2E** — add a Playwright case for any new UI flow; mock the relevant `/api` response in-test.
3. **Manual** — only for things you genuinely can't automate; record them in a new versioned scenario doc.
