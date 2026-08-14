# Open Eventz — Ingest Design (the data pipeline)

*Date: 2026-08-12. Status: **shipped** — the ingest runs as a nightly, per-source GitHub Actions workflow. Written for a technical PM: what runs where, why it changed, and how to operate it.*

---

## 1. What "ingest" is

Open Eventz is **database-first**: the app never scrapes live on a page load. A scheduled job scrapes the three sources, normalizes them, and **upserts into Supabase**; the UI only ever reads Supabase. So "ingest" is the entire write side of the product — if it doesn't run, the site silently goes stale (events published after the last run never appear).

---

## 2. Where each source is fetched from

There is **no per-source magic** — three scraper functions, each hitting the source's own website and writing to the same `events` table.

| Source | Runner function | Fetches from | How |
|---|---|---|---|
| **Frisco Library** | `runFriscoIngest()` → `ingestFriscoLibrary()` | `friscolibrary.bibliocommons.com/v2/events?page=N` (listing) + the **JSON API** `/events/events/{id}?client_scope=events` (per event) | Paginated **HTML scrape** for the listing/IDs; **age + description + image come from the JSON API** (`definition.audience_ids` mapped via the `/events/event_audiences` taxonomy). *(Was: scraping the detail page's "Suitable for:" HTML block — see the CSR note below.)* |
| **Plano Libraries** | `runPlanoIngest()` → `ingestPlanoLibrary()` | `plano.libnet.info/feeds?data=<base64>` for each of **5 branches** + each event's AGE GROUP page | **Communico RSS** (base64-token filter, `days=365`) + per-event detail fetch |
| **Play Frisco** | `runPlayFriscoIngest()` → `ingestPlayFrisco()` | `friscotexas.gov/calendar.aspx…` (list) → `Calendar.aspx?EID=…` (each event) | **CivicPlus two-pass scrape** + a **Claude** LLM call per *new* event (age + price inference) |

All three live in [`src/lib/ingest.ts`](src/lib/ingest.ts) and write to the shared Supabase `events` table.

### Per-source quirks that matter operationally
- **Libraries accumulate** (upsert only — old rows stay until their date passes). **Play Frisco is purged** each run: any `play-frisco` row not in the current batch is deleted. So a Play Frisco run that fetches 0 events (off-season, or a scrape break) leaves the source **empty** — which is exactly why "Play Frisco = 0" shows up first when something is wrong.
- **Play Frisco LLM is cached.** Inference runs only for events **not already** in the DB (`kid_relevant` still null). A re-ingest of known events makes **0 Claude calls** (and costs $0). The first run after a gap is the expensive one.
- **Frisco adult-keyword cleanup** and **Play Frisco exclude-keyword cleanup** run at the end of their own source's job.

### Frisco Library — why age/description/image come from a JSON API, not the HTML (2026-08-13)

BiblioCommons moved event pages to a **client-side-rendered `/v2`** app: the "Suitable for:" audience is hydrated by JavaScript after load, so the server-side HTML we `fetch` has an **empty** `<span itemprop="name">` — no JSON-LD, no `__NEXT_DATA__`. Scraping that block returned null for every event, which fell to the `0–17` "all ages" fallback → **adult events leaked past the `age_min < 18` gate and every kid age-filter became a no-op** (304/306 events stored as 0–17). Fix: read the same data the front-end reads, from BiblioCommons' **unauthenticated JSON API**:

- **Per event:** `GET /events/events/{id}?client_scope=events` with header `Accept: application/json` → `event.definition` (`audience_ids`, `title`, `description`, `featured_image_id`). *(Same URL with a normal browser `Accept` returns the HTML page — it's content-negotiated.)*
- **Taxonomy (once/run):** `GET /events/event_audiences?client_scope=events&limit=0` → 6 stable audience IDs → names → age ranges:

  | audience_id | name | age |
  |---|---|---|
  | `5d7be0…` | Adults | 18–99 (excluded by the API gate) |
  | `5d8a3b…` | Teens | 13–17 |
  | `5d93b3bf…` | Children (0-5) | 0–5 |
  | `5d93b3c7…` | Children (6-12) | 6–12 |
  | `5d94f9ec…` | Tween (10-13) | 10–13 |
  | `614cf0…` | All Ages | 0–17 |

  Mapping (pure, unit-tested `mapFriscoAudienceIds`): kid audiences → union (min-of-mins, max-of-maxes); adults-only → 18–99 (excluded downstream); adults + kids → 0–17. This is deterministic and authoritative — chosen over LLM inference precisely because the data still existed, just client-rendered. `featured_image_id` is retained for a later event-image feature.

---

## 3. Trigger & execution — before vs. after

### Before (the staleness bug)
A **single Vercel Cron** ([`vercel.json`](vercel.json), `0 8 * * *`) sent `POST /api/ingest`, and that one route ran **all three sources sequentially in one serverless invocation**. A full ingest is ~1,800 external fetches + LLM calls (minutes) — it **cannot finish inside Vercel's function timeout** (10s on the Hobby plan). So the daily cron fired, ran ~10s, got killed **before the final write**, and refreshed nothing. The only ingests that ever completed were **manual local runs** — and when nobody ran one for three weeks, the data was three weeks stale. (Root-caused 2026-08-12: last real ingest was 2026-07-22; the BiblioCommons markup was intact, so it was pure staleness, not a parser break.)

### After (nightly, per-source, off Vercel)
Ingest now runs on **GitHub Actions** ([`.github/workflows/ingest.yml`](.github/workflows/ingest.yml)) — a scheduler with **no 10s limit** (30-min job cap here; Actions allows up to 6h). Key properties:

- **One job per source** (a `matrix` with `fail-fast: false`): `ingest (frisco)`, `ingest (plano)`, `ingest (play-frisco)` run **in parallel and independently**. A slow or broken source **cannot block or fail the others**, and each has its own logs.
- **Direct function call, not HTTP.** Each job runs [`scripts/ingest.ts`](scripts/ingest.ts) → the matching `runXIngest()` **in-process**. This matters: the old route writes everything in one upsert *at the end*, so any HTTP-based runner would hit Node's ~5-min request timeout and be killed *before* that write. Calling the function directly has no request timeout.
- **Schedule:** `0 11 * * *` (11:00 UTC ≈ 6 AM Central), nightly, plus a **manual "Run workflow" button** (`workflow_dispatch`).
- **Concurrency guard:** a manual run won't overlap the nightly one (avoids a double Play Frisco purge race).

### The `/api/ingest` route still exists
It's now a **thin wrapper** ([`src/app/api/ingest/route.ts`](src/app/api/ingest/route.ts)) that auth-checks `Bearer CRON_SECRET` and calls `runAllIngest()` (all three sequentially). Kept for **local/manual** ad-hoc refreshes; it is **no longer on any schedule** (the Vercel cron was removed).

---

## 4. Code map

| File | Role |
|---|---|
| [`src/lib/ingest.ts`](src/lib/ingest.ts) | All scraper logic + the runners: `runFriscoIngest`, `runPlanoIngest`, `runPlayFriscoIngest`, and `runAllIngest`. **No Next.js import** — pure functions, so a plain Node/tsx runner can call them. |
| [`scripts/ingest.ts`](scripts/ingest.ts) | CLI runner. `npm run ingest -- <frisco\|plano\|play-frisco\|all\|check>`. Loads `.env.local` locally (no-op in CI); exits non-zero when a source ingests nothing. |
| [`.github/workflows/ingest.yml`](.github/workflows/ingest.yml) | Nightly + manual; one job per source. |
| [`src/app/api/ingest/route.ts`](src/app/api/ingest/route.ts) | Thin auth'd wrapper → `runAllIngest()` for manual/local runs. |
| `ingest_runs` table + [`src/lib/technical-metrics.ts`](src/lib/technical-metrics.ts) | Telemetry — see §6. |

---

## 5. Operating it

### Secrets (GitHub → Settings → Secrets and variables → Actions)
Same values as `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` (only the Play Frisco job uses it)

`CRON_SECRET` is **not** needed — the script bypasses the HTTP auth.

### Run it manually
- **In the cloud:** Actions → "Ingest events" → **Run workflow** (all three jobs), or re-run a single source's job.
- **Locally:** `npm run ingest -- play-frisco` (or `frisco` / `plano` / `all`). `npm run ingest -- check` validates module resolution + env without touching the network.

### First run after this change
Adds the four secrets, then trigger once. The **first** Play Frisco run re-infers all current events (a small one-time Claude cost); subsequent runs are cached ($0 for unchanged events).

---

## 6. Telemetry — the Technical dashboard

Each source run writes **one `ingest_runs` row** (best-effort; a logging failure never fails the ingest), tagged with only its own `*_fetched` count. The dashboard's pure functions tolerate this:
- `perSourceCounts` reads live counts from the **events table**, not `ingest_runs`.
- `lastIngest` / `ingestHistory` / `llmCost` operate over the **array** of runs (most-recent, worst-status-per-day, summed cost) — multiple per-source rows aggregate correctly.

So splitting into per-source jobs needed **no migration and no dashboard change**. (A future nicety: add a `source` column to `ingest_runs` so the dashboard's single "last run" tile can show the exact source instead of the latest row.)

---

## 7. Risks & fallbacks

- **Datacenter-IP scraping.** GitHub runners use cloud IPs; a source *could* rate-limit or block them differently than a home IP. Evidence it's fine: a direct BiblioCommons fetch from a datacenter IP returns all 20 events/page, and Plano is a plain RSS feed. **Play Frisco (CivicPlus) is the one to watch** on the first cloud run. Fallback if a source blocks: run that source via a **self-hosted runner** (the user's machine) or keep it local.
- **Silent 0.** A source that legitimately returns 0 events marks its run `err` and exits non-zero → the job goes **red** in Actions (intentional — 0 is worth a look, especially for the purged Play Frisco source).
- **Cost.** Only *new* Play Frisco events cost anything (Claude). A steady state is cents/month; a big first run after a long gap is the outlier.

---

## 8. Data-quality gate — catching a silent source change (2026-08-13)

**Why it exists.** The unit/E2E suites are **logic-only and mocked** — they never see real ingested data. So when BiblioCommons went client-side-rendered and every Frisco age collapsed to `0–17`, *every test stayed green* while production served adult events to a kids app and the age filter became a no-op. The pipeline "succeeded" (rows written, run `ok`) because the parser's graceful fallback fired silently. The fix isn't just a better parser — it's a guardrail pointed at the **real output**, mapped to the three ways this hid:

| Layer | Failure mode | Guardrail |
|---|---|---|
| 1 | Mocks/fixtures never touch the live source | **Live-source canary** — `validate-data.ts` fetches real BiblioCommons events and asserts `audience_ids` still resolve to the taxonomy |
| 2 | Graceful `0–17` fallback fired 304× with no error | **Fallback-rate warning** — `ingestFriscoLibrary` counts resolved-vs-fallback; >50% fallback pushes a run warning (dashboard-visible) |
| 3 | Nothing ran on real data post-ingest | **Post-ingest data-quality gate** — a `data-quality` job (below) asserts DB invariants + runs the real filters on real rows, red on failure |

**The gate.** `.github/workflows/ingest.yml` → job `data-quality` (`needs: ingest`, `if: always()`), runs `npm run validate` → [`scripts/validate-data.ts`](scripts/validate-data.ts) against the live DB. Pure checks live in [`src/lib/data-quality.ts`](src/lib/data-quality.ts) (unit-tested against a *healthy* and a *the-incident* fixture):
- **Frisco age variety** — no single `(age_min,age_max)` bucket > 85% (the incident was ~100% `0–17`);
- **No adult-title leaks** — 0 events whose title targets adults but stored `age_min < 18`;
- **Toddler filter narrows** — `passesAgeFilter(e, [[0,5]])` matches < 90% (a real-data filter regression);
- **Per-source non-empty** + **freshness** (newest ingest ≤ 48h);
- **Start times plausible** *(added 2026-08-14)* — per source, ≤ 5% of upcoming events start before **7 AM Central**. See §8.1;
- **Live-source canary** (layer 1).

It writes a ✓/✗ table to `$GITHUB_STEP_SUMMARY` and **exits non-zero on any failure** → red job + GitHub notification. Run locally with `npm run validate`. **Net effect: a silent upstream change is now a RED pipeline, not a green ingest over corrupt data.**

### 8.1 Source timezones — the ingest runs in UTC (2026-08-14)

Every source publishes **local wall-clock** times with no usable offset:

| Source | Field | Example |
|---|---|---|
| Frisco Library | card date + `event-time` | `August 14, 2026 10:00 AM` |
| Plano | RSS `pubDate` | `Mon, 17 Aug 2026 09:30:00 +0000` — the offset is **false**, the time is local |
| Play Frisco | `itemprop="startDate"` | `2026-08-15T08:00:00` |
| Kaleidoscope | `start_date` | `2026-09-03 17:30:00` (its `utc_*` is 10h wrong — §7 of SOURCE-ONBOARDING) |

Parsing any of these with a bare `new Date(str)` resolves them in the **runtime's** timezone. That was invisible while ingest ran by hand on a Central machine, and became a live bug the moment it moved to **GitHub Actions runners, which are UTC** — every Frisco and Plano event was stored **5–6 hours early** (production showed 5:00 AM story times).

All sources now go through the pure, DST-aware **`parseCentralWallTime()`** in [`src/lib/datetime.ts`](src/lib/datetime.ts), which accepts all three shapes above and resolves them as `America/Chicago`. Unparseable input returns `null` → the event is skipped, never stored at a guessed time. Unit tests use verbatim source strings and **the suite must pass under `TZ=UTC npx jest`** as well as locally — that is the assertion a Central dev machine cannot fail on its own.

---

## 9. How to talk about it

*"A full scrape of three civic sources is minutes of work and ~1,800 requests — it never fit inside a serverless function's timeout, so the 'daily cron' silently did nothing and the data went stale whenever no one ran it by hand. I moved ingest off the request path entirely: the scraper logic is now a plain function, and a nightly GitHub Actions workflow runs one independent job per source, calling it directly with no HTTP timeout. Per-source jobs mean a slow or broken source can't take the others down, and each has isolated logs. The old endpoint stays as a manual trigger, and the telemetry keeps working because per-source run rows aggregate cleanly on the dashboard."*
