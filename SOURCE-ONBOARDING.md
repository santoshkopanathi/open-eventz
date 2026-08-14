# Source-Onboarding Playbook

*How to add a new event source (or city) to Open Eventz. Written from real experience across the
four existing sources — BiblioCommons, Communico, CivicPlus, and now WordPress/The Events Calendar.
The goal (per the product thesis): make "add a source" a **process, not a research project.***

Related: `INGEST-DESIGN.md` (how ingest runs), `TESTING.md` + `TEST-SCENARIOS.md` (the data-quality gate).

---

## 0. Principles (the hard-won ones)

1. **The data a human sees may be client-rendered.** If a field is in the browser but not in `curl` output, it didn't vanish — it moved to a JS-hydrated API. Find that API (network tab). *(Frisco `/v2` CSR break.)*
2. **The official/documented API is often dead or gated; find what the site's own front-end talks to.** *(BiblioCommons RSS retired; Communico API auth-walled — the RSS token was the way in.)*
3. **Test access from a SERVER, not just a browser.** Datacenter IPs + bare requests get WAF/Cloudflare-blocked. Send `Accept: application/json`, a real browser `User-Agent`, and a `Referer`. *(Kaleidoscope's REST API: 403 bare → 200 with headers.)*
4. **Don't build a per-source keyword deny-list.** Let the LLM classify kid-vs-adult (LLM-primary), **fail-closed**; keep at most a tiny governance/admin pre-filter. Keyword lists are brittle and don't scale per source/city. *(Play Frisco classifier.)*
5. **Pair every new source with a real-data check.** Logic/mocked tests can't catch a data break — add at least a non-empty + freshness assertion to the data-quality gate. *(Frisco age incident.)*
6. **Log a ruled-out source and why.** An undocumented "no" gets re-litigated. *(VisitFrisco — build-ID URLs, mostly nightlife → logged out.)*

Prefer data sources in this order: **documented JSON API > JSON-LD embedded in the page > RSS/iCal feed > HTML scrape.**

---

## 1. Discover the data (before any code)

- Open the events page in a browser → **Network tab**. Reload and watch the XHR/fetch calls — that's where a client-rendered page gets its data.
- Identify the **platform**: `<meta name="generator">`, script/CDN hosts, CSS class prefixes (`tribe-events`, `cp-events-search-item`, `communico`…). Platform ⇒ the likely access pattern (WordPress+Tribe ⇒ `/wp-json/tribe/events/v1/events`; BiblioCommons ⇒ `/events/events/{id}?client_scope=events`; CivicPlus ⇒ `Calendar.aspx?EID=`).
- Also check for **JSON-LD** (`<script type="application/ld+json">` with `@type: Event`) — structured data already in the HTML.
- **Test the endpoint server-side** (`curl` + the headers from Principle 3). Confirm it returns JSON and isn't WAF-blocked from a datacenter IP.
- **Record:** platform, endpoint URL + required headers, data shape (map the fields you need), rough volume, and update cadence.

---

## 2. Assess fit & decide

- Kid/family-relevant? Free (or has free events)? In an existing city, or a **new city** (bigger — needs venue geocoding + its own sources)?
- Volume + cadence; **mixed audience** (needs the LLM classifier) or inherently all-kid?
- **Rule-out?** Record it in the Source Decision Log with one line on why. Otherwise proceed.

---

## 3. Map to the normalized schema

- Add the value to **`EventSource`** in `src/lib/types.ts`, and to `sourceShortLabel`, `sourceCity`, `sourceOrg` in `src/lib/site.ts`.
- **⚠️ `getSupervisionBadge` is exhaustive over `EventSource`** (`src/lib/supervision.ts` — completeness-guarded). A new source **must** get a supervision branch or the guard fails typecheck/tests. A park/venue with no drop-off policy → the "check with venue" default.
- Composite id: **`{source}-{original-id}`**.
- Fields to fill: `title`, `description` (strip HTML), `start/end_datetime` (**mind the timezone** — store UTC; CT sources need CT→UTC), `location_name/address/lat/lng` (source geo or a venue lookup table), `is_free`/`price_*` (source field or inference), `age_*`/`kid_relevant`/`age_buckets` (source field or LLM), `thumbnail_url` (encode `&amp;`/spaces so it resolves), `event_url`, `category`, `registration_required`.
- **Age & price:** structured from the source if present; otherwise reuse the LLM inference pattern (`inferPlayFriscoEvent`).

---

## 4. Build the ingester

- Add `ingestX()` (fetch/parse → map to the schema) **and** `runXIngest()` (dedup → upsert → source-specific cleanup/purge → `recordRun`) in `src/lib/ingest.ts`, mirroring the existing runners.
- Wire it into `scripts/ingest.ts` (the source arg) and the **matrix in `.github/workflows/ingest.yml`** (a new independent job — failure-isolated).
- **Classifier:** LLM-primary + fail-closed (Principle 4). At most a short governance/admin pre-filter.

---

## 5. Data-quality checks (Principle 5)

- Extend `src/lib/data-quality.ts` + the `validate-data.ts` gate for the new source: **non-empty + freshness minimum**; add age-variety / adult-leak / filter-narrows if it carries kid ages; add a **live-source canary** asserting the source still returns the field you depend on.

---

## 6. UI wiring

- Add the source to the city's sub-filter options (`SourceSubFilter`) and confirm the city tab shows it (`sourceCity`).
- Any source-specific badges (supervision handled in §3). Keep the card/detail render source-agnostic — it already reads `thumbnail_url`, badges, etc.

---

## 7. Tests

- **Unit** for pure parsers/mappers; **E2E** if a UI flow changed; **data-quality** test for the new invariants; **scenario doc** rows in `TEST-SCENARIOS.md` (`[A]` where automated).

---

## 8. Verify & deploy

- `npm run ingest -- <source>` locally against prod Supabase; check counts + date span; **`npm run validate`** green; **spot-check the LLM `reasoning`** on a few events (kept vs hidden).
- typecheck + unit + E2E + build + doc-parity green; push (Vercel deploys the code; the nightly Action picks up the new job).

---

## Worked example — Kaleidoscope Park (shipped 2026-08-13)

- **Platform:** WordPress + **The Events Calendar** (`tribe-events`). **Endpoint:** `GET /wp-json/tribe/events/v1/events` (needs `Accept: application/json` + browser UA + `Referer` — a bare request is **403 WAF-blocked**). Structured: title, `utc_start_date`/`utc_end_date` (UTC — no tz math), venue (geo often empty → park-coords fallback), `cost`, `image.url`, description.
- **What it took (the playbook proved out):** `EventSource` + `site.ts` helpers + a `getSupervisionBadge` branch (park → "check with venue"); `ingestKaleidoscope()` + `runKaleidoscopeIngest()` (reusing the shared **`classifyEvents()`** LLM pass — extracted from Play Frisco in the same change, so onboarding was *smaller* than the last source, not larger); `scripts/ingest.ts` + the `ingest.yml` matrix job; a `kaleidoscope-park` non-empty check in the data-quality gate; the Frisco sub-filter option + default-sources list. **No migration** (schema fit).
- **Result on prod:** **103 events → 84 kid-facing**, all with images, Sep 2026 → Feb 2027. The LLM-primary classifier earned its keep: "Pop & Pour" (a wine event) → **hidden** with reasoning *"explicitly requires guests to be 21+"*, while SaturYAY!/festivals/Tree Lighting are shown. Gates: typecheck + 250 unit + 11 E2E + build + doc-parity + `npm run validate` green; Play Frisco re-run = 0 LLM calls (the shared-classifier refactor is regression-free).
