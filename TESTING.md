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

## Test layers

| Layer | Tool | Location | Covers |
|---|---|---|---|
| **Unit** | Jest | `src/lib/*.test.ts` | parsers, badge logic (`getAgeBadge`/card/detail), age filter (overlap + multi-select OR + gating), recurring detection |
| **E2E smoke** | Playwright | `e2e/*.spec.ts` | city tabs, dropdowns + count badges, multi-select, badge rendering, detail view, per-city persistence — **all `/api/*` mocked** (deterministic, no Supabase) |
| **Manual** | human | `../02-product/functional-test-scenarios*.md` | live ingest pipeline, LLM inference accuracy, map/directions, calendar/attend actions |

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
