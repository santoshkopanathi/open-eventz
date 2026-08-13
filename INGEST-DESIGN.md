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
| **Frisco Library** | `runFriscoIngest()` → `ingestFriscoLibrary()` | `friscolibrary.bibliocommons.com/v2/events?page=N` + each event's detail page | Paginated **HTML scrape** (`cp-events-search-item`); the detail page's **"Suitable for:"** block is the age source |
| **Plano Libraries** | `runPlanoIngest()` → `ingestPlanoLibrary()` | `plano.libnet.info/feeds?data=<base64>` for each of **5 branches** + each event's AGE GROUP page | **Communico RSS** (base64-token filter, `days=365`) + per-event detail fetch |
| **Play Frisco** | `runPlayFriscoIngest()` → `ingestPlayFrisco()` | `friscotexas.gov/calendar.aspx…` (list) → `Calendar.aspx?EID=…` (each event) | **CivicPlus two-pass scrape** + a **Claude** LLM call per *new* event (age + price inference) |

All three live in [`src/lib/ingest.ts`](src/lib/ingest.ts) and write to the shared Supabase `events` table.

### Per-source quirks that matter operationally
- **Libraries accumulate** (upsert only — old rows stay until their date passes). **Play Frisco is purged** each run: any `play-frisco` row not in the current batch is deleted. So a Play Frisco run that fetches 0 events (off-season, or a scrape break) leaves the source **empty** — which is exactly why "Play Frisco = 0" shows up first when something is wrong.
- **Play Frisco LLM is cached.** Inference runs only for events **not already** in the DB (`kid_relevant` still null). A re-ingest of known events makes **0 Claude calls** (and costs $0). The first run after a gap is the expensive one.
- **Frisco adult-keyword cleanup** and **Play Frisco exclude-keyword cleanup** run at the end of their own source's job.

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

## 8. How to talk about it

*"A full scrape of three civic sources is minutes of work and ~1,800 requests — it never fit inside a serverless function's timeout, so the 'daily cron' silently did nothing and the data went stale whenever no one ran it by hand. I moved ingest off the request path entirely: the scraper logic is now a plain function, and a nightly GitHub Actions workflow runs one independent job per source, calling it directly with no HTTP timeout. Per-source jobs mean a slow or broken source can't take the others down, and each has isolated logs. The old endpoint stays as a manual trigger, and the telemetry keeps working because per-source run rows aggregate cleanly on the dashboard."*
