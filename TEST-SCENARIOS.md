# Open Eventz — Functional Test Scenarios
Version: consolidated (base + v1.1 + v1.2 + 2026-08 data-quality + 2026-08 ingest guard)
Last updated: 2026-08-15

> This file is the **coverage record** — what behaviour is verified, scenario by scenario.
> For *what stops bad data reaching a user and where each control sits*, see
> **[`GUARDRAILS.md`](./GUARDRAILS.md)**. Some rows here (§1.5B.11–13) are structural guards
> that enforce architecture rather than behaviour; they're inventoried there.

Tag key:
[A] = Automated — a Jest or Playwright test exists
[R] = Regression — runs in CI on every push
[M] = Manual — cannot be automated; verified by hand

Zone 1: Documented AND automated in CI
Zone 2: Documented, manual by design — live ingest, LLM calibration, GA4, mobile
Zone 3: Automated in CI, backfilled here for completeness — SEO, calendar, dashboards

> Canonical location: this file lives in the **app repo** (next to the tests it references) so the
> `doc-parity` CI job can verify every `[A]` row's "covered by" test file still exists. The `[A]`
> rows name their covering test file inline in the tag cell. Superseded scenarios from earlier
> versioned docs are merged in (newest wins); the originals are archived under `02-product/`.

> **Why the 2026-08-13 additions (§1.1 rework, §1.5, §9.7/9.9, §12.8–9, §13.2).** A silent source
> break (BiblioCommons → client-side rendering) corrupted every Frisco age while all mocked/logic
> tests stayed green — so these scenarios assert against the **real output** (a live-DB data-quality
> gate §1.5 + a source canary). Rule: **logic tests can't catch bad data — pair every ingest/source
> change with a real-data assertion.** Full story: BUILD-LOG "Frisco age filter broke".

---

## 1. Data Ingest Pipeline

### 1.1 Frisco Library (BiblioCommons HTML scrape)
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.1.1 | Ingest runs against the live Frisco Library calendar | Events table populated; no ingest errors | [R] [M] |
| 1.1.2 | Time formatted `10:00am` (no space) | Parsed as 10:00 AM; no date-parse error | [R] [M] |
| 1.1.3 | Same event in multiple audience feeds | One record per event; no duplicate IDs | [R] [M] |
| 1.1.4 | Age data source *(2026-08: JSON API)* | `age_min/age_max` from the detail **JSON API** `definition.audience_ids`, mapped via the `/events/event_audiences` taxonomy (`mapFriscoAudienceIds`) — **not** the "Suitable for:" HTML, which the client-rendered `/v2` pages leave empty | [A] [R] · age-parsers.test.ts |
| 1.1.5 | Empty/unknown `audience_ids` | Falls back to all-ages `0–17` **and is counted**; an abnormally high fallback rate → run warning + the data-quality gate fails (§1.5.1) | [A] [R] · age-parsers.test.ts, data-quality.test.ts |
| 1.1.6 | Adults-only audience (e.g. "D&D for Adults") | `age_min=18`; excluded at the API (`age_min < 18`); never appears in any kid filter | [A] [R] · age-parsers.test.ts |
| 1.1.7 | Event image (detail view only) | From the card `uploads/images` URL, `&amp;`/spaces encoded so it resolves; hero image in the detail view; graceful when absent | [R] [M] |
| 1.1.8 | Detail JSON-API fetch returns HTTP error | Event still ingested (age → 0–17 fallback); others continue; other sources unaffected | [R] [M] |

### 1.2 Plano Libraries (Communico RSS)
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.2.1 | Ingest against Communico RSS | Events populated across all five branches | [R] [M] |
| 1.2.2 | AGE GROUP field present | `age_label` mapped to correct bucket | [R] [M] |
| 1.2.3 | Tagged "Adults"/"Older Adults" | Stored `age_min=18`; filtered at API (`age_min < 18`); never in UI | [R] [M] |
| 1.2.4 | Tagged "Families (All Ages)" | `age_min=0, age_max=17`; appears under all age selections | [R] [M] |
| 1.2.5 | Malformed XML | Plano error logged; other sources still load | [R] [M] |
| 1.2.6 | Base64 JWT encodes 365-day window | Feed returns up to 365 days; not truncated to 1 | [R] [M] |

### 1.3 Play Frisco (CivicPlus scrape)
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.3.1 | Ingest against city calendar | Play Frisco events populated | [R] [M] |
| 1.3.2 | Event absent from today's scrape | Deleted from table (stale cleanup) | [R] [M] |
| 1.3.3 | CivicPlus HTML structure changes | Fails gracefully; banner shown; library events unaffected | [R] [M] |
| 1.3.4 | Paid event (structured `Cost` field) | `is_free=false`, `price_text` stored | [R] [M] |
| 1.3.5 | Coverage window *(2026-08)* | Scrapes ~6 months out (was effectively ~1 month — a per-event `startDate` check overrode the loop); events months ahead now appear | [R] [M] |
| 1.3.6 | Event image *(2026-08)* | From the detail-page `og:image`; keeps only real `/ImageRepository/Document` images, drops the generic calendar-icon fallback; detail-view only, graceful when absent | [R] [M] |
| 1.3.7 | Keyword pre-filter is governance-only *(2026-08)* | `PARKS_REC_EXCLUDE_KEYWORDS` skips only city-admin noise (council/board/work-session…); kid-vs-adult is the LLM's call (§13.2), not a keyword list | [R] [M] |

### 1.4 Ingest security & architecture
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.4.1 | `/api/ingest` without bearer token | 401; no ingest runs | [R] [M] |
| 1.4.2 | `/api/ingest` with valid token | Runs; 200 with summary | [R] [M] |
| 1.4.3 | Composite ID for existing event | Upsert updates; no duplicate row | [R] [M] |

### 1.5 Data-quality gate — post-ingest, REAL data *(new 2026-08-13 — see the "why" note at the top)*
The layer that would have caught the Frisco age break: it asserts against the **real DB** (not mocks), so a silent source/data break turns the pipeline **red** instead of a green ingest over corrupt data. Runs as the `data-quality` job in `.github/workflows/ingest.yml` (`needs: ingest`) and locally via `npm run validate`; pure checks in `src/lib/data-quality.ts`.
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.5.1 | Frisco age variety | No single `(age_min,age_max)` bucket > 85% of events (the incident was ~100% `0–17`); else gate fails | [A] [R] · data-quality.test.ts |
| 1.5.2 | No adult-title leaks | 0 events whose title targets adults ("for adults"/"21+"/…) stored kid-visible (`age_min < 18`); else fails | [A] [R] · data-quality.test.ts |
| 1.5.3 | Toddler filter narrows (real data) | `passesAgeFilter(0–5)` matches < 90% of events (near-100% match = filter no-op); else fails | [A] [R] · data-quality.test.ts |
| 1.5.4 | Per-source non-empty + freshness | `validate-data.ts`: each library source ≥ a min count; newest `ingested_at` ≤ 48h; else red | [R] [M] |
| 1.5.5 | Live-source canary | `validate-data.ts` fetches a real event and asserts BiblioCommons still returns resolvable `audience_ids` (the exact contract that broke); else red | [R] [M] |
| 1.5.6 | Any check fails → pipeline red | Non-zero exit → red `data-quality` job + a `$GITHUB_STEP_SUMMARY` ✓/✗ table | [R] |
| 1.5.7 | Start times plausible *(new 2026-08-14)* | Per source, ≤ 5% of upcoming events start between **12:01 and 7:00 AM Central**; a whole source shifting (the timezone incident — 5:00 AM story times) fails the gate and names the source | [A] [R] · data-quality.test.ts |
| 1.5.8 | All-day events not flagged *(new 2026-08-14)* | **Exact midnight** = "all day, no meaningful time" (LIBRARY CLOSED, Unplug Texas Day) and is excluded; 12:30 AM is still flagged. Found when the check first ran on real data and went red on 11 legitimate rows | [A] [R] · data-quality.test.ts |

### 1.5B Pre-write ingest guard — fail-closed *(new 2026-08-15)*
**Product rule: a wrong event time is worse than a missing event.** Every runner writes through `guardedUpsert`, which screens the batch via `screenBatch` (`src/lib/ingest-guard.ts`) **before** the upsert. On abort nothing is written and the purge/cleanup steps are skipped, so the previously-stored correct rows survive. Escape hatch `INGEST_ALLOW_TIME_SHIFT=1` for an intended mass correction.
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.5B.1 | Event with an implausible start (12:01–7:00 AM CT) | **Dropped** — never written; the rest of the batch still publishes | [A] [R] · ingest-guard.test.ts |
| 1.5B.2 | Unparseable `start_datetime` | Dropped — never guessed, never stored | [A] [R] · ingest-guard.test.ts |
| 1.5B.3 | **The incident** — every event shifted by the same −300 min | **Whole batch rejected**, stored rows untouched | [A] [R] · ingest-guard.test.ts |
| 1.5B.4 | Uniform shift landing at *plausible* hours (e.g. 10 AM → 3 PM) | Still rejected — the uniform offset is the tell, not the hour | [A] [R] · ingest-guard.test.ts |
| 1.5B.5 | A few genuine reschedules | **Not** rejected — real changes are individually varied | [A] [R] · ingest-guard.test.ts |
| 1.5B.6 | >10% of events implausible | Whole batch rejected rather than publishing a fraction | [A] [R] · ingest-guard.test.ts |
| 1.5B.7 | Partial/empty scrape (< half the stored set) | Rejected — a failed scrape must not read as "events cancelled" | [A] [R] · ingest-guard.test.ts |
| 1.5B.8 | Intended correction + `INGEST_ALLOW_TIME_SHIFT=1` | Shift allowed; implausible times still blocked | [A] [R] · ingest-guard.test.ts |
| 1.5B.9 | Brand-new source (nothing stored) | Writes normally — no overlap to compare | [A] [R] · ingest-guard.test.ts |
| 1.5B.10 | Cannot read stored events | Refuses to write rather than write blind | [R] [M] |
| 1.5B.11 | No write path bypasses the guard | Exactly **one** `events.upsert` exists in `ingest.ts` | [A] [R] · no-ambient-timezone.test.ts |
| 1.5B.12 | Bare `new Date(<arg>)` in ingest | Fails unless allowlisted with a reason — verified by reintroducing the original bug | [A] [R] · no-ambient-timezone.test.ts |
| 1.5B.13 | Unit suite runs in both timezones | CI runs Jest at `TZ=UTC` (runner) **and** `TZ=America/Chicago`; a one-timezone suite can't catch a timezone bug | [R] |

### 1.7 User-facing failure states *(new 2026-08-17 — see the fallback table in GUARDRAILS.md)*
A failed request and a genuine zero-result query were **one state** until now: a 500 fell through
to `data.events ?? []` and rendered "No events match your filters", blaming the user for a
backend outage. These keep them distinct.
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.7.1 | `/api/events` returns 500 | "We couldn’t load events right now." + **Try again**; the filter message must **not** appear | [A] [R] · smoke.spec.ts |
| 1.7.2 | `/api/events` fetch throws | Same error state; the loading spinner must **not** survive | [A] [R] · smoke.spec.ts |
| 1.7.3 | Query genuinely returns zero events | "No events match your filters." + Clear filters; the error copy must **not** appear | [A] [R] · smoke.spec.ts |
| 1.7.4 | **Try again** after the backend recovers | Events render; error state clears | [A] [R] · smoke.spec.ts |
| 1.7.5 | Filters survive an error | Selections are preserved across the failure and the retry | [R] [M] |
| 1.7.6 | `/api/venues` fails | In-map note "Map locations couldn’t be loaded right now." + Try again; **the event list is unaffected** | [R] [M] |
| 1.7.7 | Likes POST fails | Optimistic toggle **reverts** (state + localStorage) with "Couldn’t save that — try again." | [R] [M] |
| 1.7.8 | Share on a browser without `navigator.share` | Inline "Link copied" note — **never** a native `alert()` modal | [R] [M] |
| 1.7.9 | Any failure state rendered | Fires GA4 `error_shown` with `surface: events | venues | likes` (8th custom event) | [R] [M] |
### 1.6A LLM spend ceiling *(new 2026-08-19 — the last governance instrument)*
Classification cost scales with **new events, not users** (batched nightly, cached — a re-run of an unchanged source costs 0 calls). The cap exists for the anomaly: a source that suddenly returns thousands of events. Default 300 calls/run, override `MAX_LLM_CALLS_PER_RUN`. Pure logic in `src/lib/llm-budget.ts`.
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.6A.1 | Normal run (well under the cap) | All events classified; run not flagged | [A] [R] · llm-budget.test.ts |
| 1.6A.2 | Cap reached mid-run | Further paid calls refused; remaining events **excluded from the write** | [A] [R] · llm-budget.test.ts |
| 1.6A.3 | A budget-skipped event | Never assigned `kid_relevant` — `false` would poison the cache (hidden forever), `null` would pass the API gate and be **shown** | [A] [R] · llm-budget.test.ts |
| 1.6A.4 | Run after a cap hit | Skipped events were never stored, so they are classified normally — self-healing | [R] [M] |
| 1.6A.5 | Malformed `MAX_LLM_CALLS_PER_RUN` | Falls back to the default; a bad value can **never** disable the cap | [A] [R] · llm-budget.test.ts |
| 1.6A.6 | `MAX_LLM_CALLS_PER_RUN=0` | Respected — an explicit "spend nothing" instruction | [A] [R] · llm-budget.test.ts |
| 1.6A.7 | Cap hit reaches a human | Run exits non-zero → red job → failure alert; error recorded on the run | [A] [R] · llm-budget.test.ts |
| 1.6A.8 | The ceiling cannot be bypassed | Exactly one paid call site, and it is gated by `budget.spend()` | [A] [R] · llm-budget.test.ts |

### 1.5C Failure alerting *(new 2026-08-17 — see INGEST-DESIGN §8.2/§8.3)*
**Primary channel = GitHub's own workflow-failure email** (no code, verified to fire on every drill). **Secondary = the `notify` job's GitHub Issue**, best-effort: GitHub's Issues API failed in three different ways across three drills, so delivery falls forward.
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.5B.14 | A source job or the data-quality gate fails | Run goes red → **GitHub's workflow-failure email reaches the owner** (primary, verified 2026-08-17) | [R] [M] |
| 1.5C.1 | Secondary alert delivery | `notify` opens, or comments on, an Issue with triage instructions; dedup matches the fixed **title**, not the label — and finds it even when the issue carries no label | [A] [R] · notify-alert.test.ts |
| 1.5C.2 | `createLabel` fails (drill 1) | Labelling is best-effort — the issue is still delivered, unlabelled | [A] [R] · notify-alert.test.ts |
| 1.5C.3 | Issue rejects the label (drill 2) | Falls back to creating the issue with no label | [A] [R] · notify-alert.test.ts |
| 1.5C.4 | `createComment` fails (drill 3) | Falls **forward** to opening a new issue — for an alert, a duplicate beats a silence | [A] [R] · notify-alert.test.ts |
| 1.5C.5 | Every Issues-API write fails | Logs which calls broke and fails the job; the run is already red so the **primary email still fires** | [A] [R] · notify-alert.test.ts |
| 1.5C.8 | Listing issues fails | Opens a new issue rather than staying silent | [A] [R] · notify-alert.test.ts |
| 1.5C.9 | Alert script cannot drift from what runs | The test extracts the `notify` script from `ingest.yml` itself, never a copy | [A] [R] · notify-alert.test.ts |
| 1.5C.6 | Fire drill | Actions → Ingest events → Run workflow → `simulate_failure`: one job fails on purpose, **no source is scraped or written**, alert fires under the `ingest-drill` label | [R] [M] |
| 1.5C.7 | Drill does not disturb the nightly | On a `schedule` event `inputs` is undefined → drill step skipped, real ingest runs normally | [R] [M] |

### 1.5A Source timezone handling *(new 2026-08-14 — the "5:00 AM story time" incident)*
Every source publishes **local wall-clock** times with no usable offset. Parsing them with a bare `new Date(str)` resolves in the **runtime's** timezone — correct on a Central dev machine, **5–6 hours early** on the UTC GitHub Actions runner that does the nightly ingest. All sources now go through `parseCentralWallTime` (`src/lib/datetime.ts`).
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.5A.1 | Frisco Library card date+time | `"August 14, 2026 10:00 AM"` → `15:00Z` (10 AM CDT), never `10:00Z` | [A] [R] · datetime.test.ts |
| 1.5A.2 | Plano RSS `pubDate` | `"Mon, 17 Aug 2026 09:30:00 +0000"` → `14:30Z` — the `+0000` is **ignored on purpose** (the feed stamps it on plainly local times) | [A] [R] · datetime.test.ts |
| 1.5A.3 | Play Frisco CivicPlus `startDate` | `"2026-08-15T08:00:00"` → `13:00Z` | [A] [R] · datetime.test.ts |
| 1.5A.4 | DST boundary | A December event shifts by 6h (CST), an August event by 5h (CDT) | [A] [R] · datetime.test.ts |
| 1.5A.5 | Machine-timezone independence | The same source string yields the same instant under `TZ=UTC` and `TZ=America/Chicago` (run `TZ=UTC npx jest` — this is the actual bug) | [A] [R] · datetime.test.ts |
| 1.5A.6 | Unparseable time | Returns `null` → the event is **skipped**, never stored at a guessed time | [A] [R] · datetime.test.ts |

### 1.6 Kaleidoscope Park (The Events Calendar REST API) *(new 2026-08-13 — first onboarding via SOURCE-ONBOARDING.md)*
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.6.1 | Ingest via `/wp-json/tribe/events/v1/events` | Events populated; bare request is 403 → 200 with `Accept: application/json` + browser UA + `Referer` | [R] [M] |
| 1.6.2 | Timezone (source UTC is wrong) | `start_datetime` from the LOCAL `start_date` converted as America/Chicago, DST-aware — the source's `utc_*` is 10h off (WordPress TZ misconfigured as UTC+5); venue geo empty → park-coords fallback | [A] [R] · datetime.test.ts |
| 1.6.3 | Mixed-audience classification (LLM-primary) | LLM decides kid-vs-adult; e.g. "Pop & Pour" (21+ wine) → `kid_relevant:false`, hidden; SaturYAY!/festivals shown | [M] |
| 1.6.4 | Price + image | `cost` field authoritative when present, else inferred; `image.url` → hero (detail-view only) | [R] [M] |
| 1.6.5 | Stale purge | Events removed from the API are deleted from the table on the next run | [R] [M] |
| 1.6.6 | Supervision badge | "Check with venue" (park, no drop-off policy) — enforced by the completeness guard | [A] [R] · supervision.test.ts |
| 1.6.7 | Non-empty data-quality check | `kaleidoscope-park` ≥ 5 upcoming, else the gate fails (§1.5) | [R] [M] |

---

## 2. Event Display — List View (core)
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 2.1 | App loads, no filters | All upcoming events, date-ascending | [R] |
| 2.2 | Events from all three sources present | Unified list shows all three | [R] |
| 2.3 | Card content | Title, time, location, source visible without opening detail | [R] |
| 2.4 | Registration required | "Registration" badge on card — full text on desktop, clipboard icon on mobile (see §11.5) | [A] [R] · smoke.spec.ts |
| 2.5 | Date range pre-populated on load | From = today; To = today + 7 days; both set without user action | [R] |

*(Price and age card badges are covered in §3 and §6; recurring in §11.)*

---

## 3. Age badges — cards  *(supersedes base §2.2)*
Cards show only "Family" (confirmed or inferred) and the bare inferred marker; structured age ranges are detail-only.

| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 3.1 | Frisco/Plano single structured age group | **No** age badge on card | [A] [R] · age-badge.test.ts |
| 3.2 | Frisco/Plano multi-group, not family | **No** age badge on card | [A] [R] · age-badge.test.ts |
| 3.3 | Plano "Families (All Ages)" | Gold **"Family"** badge | [A] [R] · age-badge.test.ts |
| 3.4 | Play Frisco inferred family (high/med) | Indigo **`~ Family ✦`** badge | [A] [R] · age-badge.test.ts |
| 3.5 | Play Frisco inferred specific age (high/med) | Bare **`✦`** marker | [A] [R] · age-badge.test.ts |
| 3.6 | Low confidence or `kid_relevant:false` | No badge | [A] [R] · age-badge.test.ts |
| 3.7 | No age data | No badge | [A] [R] · age-badge.test.ts |
| 3.8 | Desktop hover on any `✦` | Tooltip "Estimated from description". Mobile: no tooltip | [M] |
| 3.9 | Mobile tap on `✦` | Opens detail view (full disclosure there) | [M] |

---

## 4. Age badges — detail  *(supersedes base §6.3)*
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 4.1 | Single structured age group | Age-label badge ("Ages 0–5" / "Ages 6–12" / "Teens") | [A] [R] · age-badge.test.ts |
| 4.2 | Multi-group, not family | Single collapsed range ("Ages 6–17"); not "Family" | [A] [R] · age-badge.test.ts |
| 4.3 | Plano "Families (All Ages)" | Gold "Family"; no disclosure line | [A] [R] · age-badge.test.ts |
| 4.4 | Play Frisco inferred family | `~ Family ✦` + disclosure; no "Family event" label | [A] [R] · age-badge.test.ts |
| 4.5 | Play Frisco inferred specific age | `~ Ages [range] ✦` + disclosure | [A] [R] · age-badge.test.ts |
| 4.6 | Low confidence / no age | Nothing shown | [A] [R] · age-badge.test.ts |
| 4.7 | Legacy "👶 Suitable for: …" line | Removed (no longer rendered) | [M] |

---

## 5. Family-label rule (source logic)
"Family" appears only from an explicit signal — never derived from a numeric multi-group span.

| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 5.1 | Plano "Families (All Ages)" | Labeled "Family" (confirmed, gold) | [A] [R] · age-badge.test.ts |
| 5.2 | Play Frisco inferred family | Labeled "Family" (inferred, `~ Family ✦`) | [A] [R] · age-badge.test.ts |
| 5.3 | Frisco multi-age-group event | **Never** "Family" (no family field) | [A] [R] · age-badge.test.ts |
| 5.4 | Plano "Kids + Adults" (numeric 6–12) | **Never** "Family" from a numeric span | [A] [R] · age-parsers.test.ts |
| 5.5 | Explicit "Families (All Ages)" stored as `age_buckets=['family']` | `communicoIsFamily` true only for the explicit tag | [A] · age-parsers.test.ts |

---

## 6. Price classification — Play Frisco (Definition A)  *(supersedes base 2.1.4/2.1.5, 6.1.4/6.1.5)*
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 6.1 | Structured `Cost: Free` field | Confirmed free → plain **`Free`**, no `✦` | [A] [R] · price.test.ts |
| 6.2 | Structured `Cost: $35` / `Paid` | Confirmed paid → plain **`Paid`**, no `✦` | [A] [R] · price.test.ts |
| 6.3 | No Cost field; "FREE ADMISSION" in text | Inferred **`Free ✦`** | [A] [R] · price.test.ts |
| 6.4 | No Cost field; no price words; drop-in | Free-by-default → **`Free ✦`** | [A] [R] · price.test.ts |
| 6.5 | No Cost field; "workshop"/"class" or registration required | Layer 2/3 → **unknown, no badge** | [A] [R] · price.test.ts |
| 6.6 | Explicit paid ("BUY TICKETS", "$7") | **`Paid ✦`** | [A] [R] · price.test.ts |
| 6.7 | Member-gated ("Free for members … $7") | **`Paid ✦`** (public price wins) | [A] [R] · price.test.ts |
| 6.8 | Ambiguous / genuinely torn | **unknown, no badge** | [A] [R] · price.test.ts |
| 6.9 | Library event | Institutional **`Free`**, no `✦` | [A] [R] · price.test.ts |
| 6.10 | Card renders inferred free/paid | `Free ✦` / `Paid ✦` visible on card | [A] [R] · e2e/smoke.spec.ts |
| 6.11 | LLM accuracy on calibration set | `npm run calibrate:price` — ground-truth events pass | [M] |
| 6.12 | Live re-ingest picks up Cost fields | "Learn to Fish" shows confirmed `Free` (no `✦`) | [M] |

---

## 7. Inference disclosure (detail view)
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 7.1 | Age inferred only (family) | "Family suitability estimated from event description" | [A] [R] · inference-disclosure.test.ts |
| 7.2 | Age inferred only (specific) | "Age suitability estimated from event description" | [A] [R] · inference-disclosure.test.ts |
| 7.3 | Price inferred only | "'Free'/'Paid' admission status estimated from event description" | [A] [R] · inference-disclosure.test.ts |
| 7.4 | Both age + price inferred | **ONE** combined line; never two | [A] [R] · inference-disclosure.test.ts |
| 7.5 | Confirmed price (Cost field) + inferred age | Disclosure mentions age only; price omitted | [A] [R] · inference-disclosure.test.ts |
| 7.6 | Combined disclosure renders in detail | Single line shown in the detail panel | [A] [R] · e2e/smoke.spec.ts |
| 7.7 | Card `✦` hover (desktop) / tap (mobile) | Tooltip on desktop; opens detail on mobile | [M] |

---

## 8. Age filter — multi-select OR  *(supersedes base §5 filtering logic)*
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 8.1 | Single age chip (Kids 6–12) | Events overlapping 6–12 | [A] [R] · age-filter.test.ts |
| 8.2 | Multiple chips (Toddlers + Teens) | OR — 0–5 or 13–17; kids-only (6–12) excluded | [A] [R] · age-filter.test.ts |
| 8.3 | All-ages/family event, any active chip | Shown under every selected chip | [A] [R] · age-filter.test.ts |
| 8.4 | Play Frisco low-confidence under filter | Excluded | [A] [R] · age-filter.test.ts |
| 8.5 | Play Frisco `kid_relevant:false` | Never shown | [A] [R] · age-filter.test.ts |
| 8.6 | Plano "Kids + Adults" under Teens chip | **Not** shown (no adult-range bleed) | [A] [R] · age-filter.test.ts |
| 8.7 | Age dropdown multi-select sends OR params | Request carries both age ranges; count badge shows | [A] [R] · e2e/smoke.spec.ts |

---

## 9. Filter dropdowns (UI)
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 9.1 | Open Source dropdown (Frisco) | Checkboxes: "Frisco Library", "Play Frisco" | [M] |
| 9.2 | Open Branch dropdown (Plano) | Davis, Haggard, Harrington, Parr, Schimelpfenig, Virtual | [M] |
| 9.3 | Open Age dropdown | Toddlers/Kids/Teens multi-select | [M] |
| 9.4 | Exactly one option selected | Button shows that option's name | [M] |
| 9.5 | Two or more selected | Button shows group label + count badge | [M] |
| 9.6 | Zero selected | Group label, no badge (= all) | [M] |
| 9.7 | Filter row layout *(2026-08)* | Dropdowns + date range + Today/Tomorrow/Weekend presets flow inline on one row on desktop; wrap to stacked rows only as the width narrows (mobile) | [M] |
| 9.8 | Click outside an open dropdown | Dropdown closes | [M] |
| 9.9 | "Clear filters" visibility *(2026-08)* | Hidden by default; appears only when a filter is non-default (any source/branch/age selected, or the date range moved); clicking it resets and hides it again | [A] [R] · e2e/smoke.spec.ts |

---

## 10. City-first navigation & per-city persistence
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 10.1 | First load | Frisco tab active; Frisco events shown | [R] |
| 10.2 | Click Plano tab | Only Plano Library events | [R] |
| 10.3 | Click Frisco tab | Frisco Library + Play Frisco events | [R] |
| 10.4 | Active-tab accent | Correct accent on underline + filter-bar border per city | [M] |
| 10.5 | Per-city filter state persists across tab switches | Each city keeps its own selections | [A] [R] · e2e/smoke.spec.ts |
| 10.6 | Logo/title click | Full reset to home (Frisco, filters cleared, detail closed, map off) | [M] |

---

## 11. Recurring indicator
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 11.1 | Title on 2+ future dates within a source | "Recurring" badge on card + detail (detection logic; Weekend Paper: no `↻` symbol) | [A] [R] · recurring.test.ts |
| 11.2 | Single-occurrence event | No recurring badge | [A] [R] · recurring.test.ts |
| 11.3 | Same title in two sources | Not merged (source-scoped) | [A] · recurring.test.ts |
| 11.4 | Pre-flagged recurring at scrape time | Flag preserved; label not overwritten | [A] · recurring.test.ts |
| 11.5 | Registration / Recurring badge — **responsive** | Full text on desktop; collapses to a **line-icon on mobile** (Recurring → repeat, Registration → clipboard), each keeping an aria-label + tooltip | [A] [R] · smoke.spec.ts |

---

## 12. Event detail view — core, supervision, actions
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 12.1 | Click a card (desktop) | Detail panel opens (title, date, time, location, description) | [R] |
| 12.2 | Click a card (mobile) | Full-screen overlay; back button visible | [R] |
| 12.3 | Tap mobile back button | Overlay closes; list visible (filters preserved) | [R] |
| 12.4 | Click close (desktop) | Panel closes; welcome panel shown | [R] |
| 12.5 | Free / paid detail | "Free admission" / "Paid" pill (see §6 for `✦` rules) | [R] |
| 12.6 | Registration required | Calm accent-tint (rust) callout, one line: "Registration required — sign up before attending" (Weekend Paper — was a yellow banner) | [R] |
| 12.7 | Supervision "can kids be dropped off?" badge | Per-source drop-off badge — fully specified in **§12A. Supervision Badge** below | [A] [R] · supervision.test.ts |
| 12.10 | Supervision badge on **every** detail surface *(new 2026-08-14)* | Both the in-app panel and the `/events/[id]` server page render it, from the shared `SupervisionCallout` component — the server page had shipped without it since day one | [A] [R] · supervision-surfaces.test.ts |
| 12.8 | Hero image *(2026-08)* | When the event has a `thumbnail_url`, a banner renders at the top of the detail view (drawer + `/events/[id]`); hidden when absent or if the image fails to load (`onError`) — never a broken box; detail-view only (not on cards) | [R] [M] |
| 12.9 | Mobile detail header *(2026-08)* | The mobile full-screen detail overlay header matches the home ink masthead (ink band + rust rule + two-colour "Open Eventz" wordmark + tagline), not a plain paper bar | [M] |
| 12.11 | Add to Google Calendar | Opens Google Calendar link, event pre-filled | [R] |
| 12.12 | Add to Apple Calendar | Opens the `/api/ics/[id]` `text/calendar` route → iOS opens Add-to-Calendar (no file download) | [A] [R] · ics.test.ts |
| 12.13 | Get directions | Opens directions with venue address | [R] |
| 12.14 | Attending toggle + persistence | Count increments/decrements; state persists (localStorage) | [R] |

---

## 12A. Supervision Badge (detail view)

The "can kids be dropped off?" badge is resolved per source by `getSupervisionBadge` (`src/lib/supervision.ts`) and rendered in the event detail panel. All six rows run automatically on every push (Jest unit job). **History:** originally shown for all three sources; silently narrowed to Frisco-only in a pre-git refactor; rediscovered via product review; restored 2026-08-04 (see BUILD-LOG "Drop-off policy badge" / "Learning 5").

**Visual — Weekend Paper redesign (2026-08-05):** these are now rendered as **one calm fill-subtle callout** with a grey left bar — **no color-coding, no emoji** ("instruction, not alarm"; a wrong "you can drop off" answer should not read as reassurance-by-colour). The per-case distinction lives entirely in the **label text**, which is what the unit tests assert — colours are intentionally not tested, so the redesign didn't touch the suite. (Was: red / blue / green / grey emoji badges.)

| # | Scenario | Expected result (label text; all in the calm callout) | Tag |
|---|---|---|---|
| S.1 | Frisco Library, age 0–5 | "No — adult must stay with child" | [A] [R] · supervision.test.ts |
| S.2 | Frisco Library, age 6–12 | "only if child is 10 or older" (drop-off OK at 10+) | [A] [R] · supervision.test.ts |
| S.3 | Frisco Library, teens 13–17 | "teens 13+ may attend alone" | [A] [R] · supervision.test.ts |
| S.4 | Plano Libraries, any age | "Plan to stay" + "no formal Plano Library policy" sub-line (never a hard age cutoff) | [A] [R] · supervision.test.ts |
| S.5 | Play Frisco, any event | "Check with venue" + "before dropping off" sub-line | [A] [R] · supervision.test.ts |
| S.6 | No source match (unrecognised source) | No callout rendered (null) | [A] [R] · supervision.test.ts |

Extra regression guards in the same suite: Frisco *no-age-data* → "check with Frisco Library" (never a guessed threshold); Plano *same badge regardless of age* (no invented cutoff); and a `Record<EventSource, true>` completeness check that fails CI if a new source is added without a supervision case.

---

## 13. Play Frisco LLM age inference
### 13.1 Inference accuracy — validated events (calibration)
| # | Event | kid_relevant | age_buckets | confidence |
|---|---|---|---|---|
| 13.1.1 | Second Saturday: Sensational Soccer | true | family | high |
| 13.1.2 | Painting Dreamscapes (16+) | true | teen | high |
| 13.1.3 | Walnut Wednesdays | true | family | high |
| 13.1.4 | History of Play 2026 | true | family | high |
| 13.1.5 | Fun Float Night | true | family | high |
| 13.1.6 | Play For All Sensory Swim | true | family | high |
| 13.1.7 | Calling All Heroes 2026 | true | family | high |
| 13.1.8 | Heritage How-To: Wands, Wizards & Cookies | true | family | high |

*Accuracy verified by `npm run calibrate:price` (real-LLM tier).* Tag: [M]

### 13.2 Inference behavior
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 13.2.1 | LLM-primary classifier *(2026-08)* | The LLM's `kid_relevant` decides kid-vs-adult for **every** real event; adult/professional items (call-for-art, receptions, adult workshops) → `false`, excluded, each with a stored `reasoning` | [M] |
| 13.2.2 | Confidence `low` → **fail-closed** *(2026-08)* | `kid_relevant` forced `false` (hidden) — uncertain = don't risk showing an adult event (was: "stored but no badge") | [M] |
| 13.2.3 | Claude returns malformed JSON → fail-closed | Error logged; `kid_relevant:false` (hidden); no ingest failure | [M] |
| 13.2.4 | Claude times out / API error → fail-closed | Error logged; `kid_relevant:false` (hidden); pipeline continues | [M] |
| 13.2.5 | Explicit "adults only / 21+ / 18+" | Hard post-LLM override → `kid_relevant:false` regardless of the model (belt-and-suspenders) | [M] |
| 13.2.6 | Ambiguous same-name events | LLM splits by description — "Cycle the City" greenbelt (family) shown vs civic ride with officials hidden — where a keyword list couldn't | [M] |
| 13.2.7 | Event already inferred in DB | Re-ingest does not re-call Claude (cache); the fail-closed pass is still re-applied to cached rows | [M] |
| 13.2.8 | New Play Frisco event | Next ingest infers only the new event | [M] |

---

## 14. Analytics — GA4 instrumentation
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 14.1 | Base tag loads | `gtag` present; config = Measurement ID | [M] |
| 14.2 | `filter_applied` | Fires on any filter change | [M] |
| 14.3 | `event_card_click` | Fires on card tap (with `source`, `event_id`) | [M] |
| 14.4 | `detail_view` | Fires once when detail opens | [M] |
| 14.5 | `directions_tap` | Fires on Get Directions | [M] |
| 14.6 | `calendar_add` | Fires on Google **and** Apple/ICS | [M] |
| 14.7 | `attending_tap` | Fires on toggle-ON only | [M] |
| 14.8 | `share_tap` | Fires on Share | [M] |
| 14.9 | Consent Mode default | `analytics_storage` defaults to `denied` until the banner grants it | [M] |

---

## 15. Measurement framework (metric definitions)
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 15.1 | WAD | Unique visitors/week with ≥1 conversion, once per visitor/week | [A] [R] · measurement.test.ts |
| 15.2 | Funnel | Cumulative "most advanced step" | [A] [R] · measurement.test.ts |
| 15.3 | Channel segmentation | Funnel scopes to a single channel | [A] [R] · measurement.test.ts |
| 15.4 | Return-visit rate | % of week-1 converters active in week 2 | [A] [R] · measurement.test.ts |
| 15.5 | Referral / top events | Weekly shares; per-event tallies | [A] [R] · measurement.test.ts |

---

## 16. Technical dashboard (`/dashboard`)
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 16.1 | Per-source counts + free/paid/unknown | Real Supabase counts | [A] [R] · technical-metrics.test.ts |
| 16.2 | Inferred-age visibility | 4 buckets summing to Play Frisco total | [A] [R] · technical-metrics.test.ts |
| 16.3 | Ingest pipeline / history / cost | Populated after migration 004 + a run | [M] |
| 16.4 | No `ingest_runs` table yet | Graceful "No runs recorded yet" | [M] |

---

## 17. Functional dashboard (GA4 → BigQuery)
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 17.1 | Row mapping from BigQuery export | `mapBqRow` flattens event_params → AnalyticsRow | [A] [R] · bigquery.test.ts |
| 17.2 | Live read + funnel render | Fills after GA4 daily export + a week of data | [M] |

---

## 18. Error & edge-case states
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 18.1 | Filters match nothing | Empty state + "Clear filters" button | [R] |
| 18.2 | Clear filters | All selections reset; full list restored | [R] |
| 18.3 | One source ingest fails | Other sources shown; amber "temporarily unavailable" banner | [R] |
| 18.4 | All ingests fail | Error state; no crash | [R] |
| 18.5 | Date range with no events | Empty state | [R] |
| 18.6 | Map toggle | Venue pins for all filtered events | [R] |

---

## 19. Zone 3 — automated in CI, backfilled for completeness
Tests that guard shipped work (SEO, calendar, analytics plumbing) but had no PM scenario row until now.

### 19.1 SEO — per-event pages, JSON-LD, sitemap
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 19.1.1 | Event JSON-LD shape | schema.org/Event with name, start/end, offline attendance, canonical url, organizer, geo | [A] [R] · event-jsonld.test.ts |
| 19.1.2 | Price policy in JSON-LD | `isAccessibleForFree:true` + `$0` offer for confirmed **and** inferred free; paid → false, no offer; unknown → omitted | [A] [R] · event-jsonld.test.ts |
| 19.1.3 | typicalAgeRange | Derived from structured ages or inferred buckets | [A] [R] · event-jsonld.test.ts |
| 19.1.4 | Indexable gate | Excludes not-kid-relevant, adults-only, Frisco adult-keyword, past one-off events | [A] [R] · seo-indexable.test.ts |
| 19.1.5 | CT "today" boundary | `startOfTodayCtIso` maps to midnight CT (05:00 UTC), rolls back before 05:00 | [A] [R] · seo-indexable.test.ts |
| 19.1.6 | Canonical URLs / source→org | `eventUrl`/`cityUrl`/`sourceOrg`/`sourceCity` build correct absolute URLs and labels | [A] [R] · site.test.ts |
| 19.1.7 | `/events/[id]` visual parity *(new 2026-08-14)* | The server page uses the Weekend Paper theme — ink masthead + 3px rust rule, Instrument Serif title, token colours, **no emoji** — and carries the same chip row, callouts, and four action buttons as the in-app detail panel | [R] [M] |
| 19.1.8 | `/events/[id]` supervision badge *(new 2026-08-14)* | Renders the drop-off callout for every source via the shared component — see §12.10 | [A] [R] · supervision-surfaces.test.ts |
| 19.1.9 | Sitemap route (`sitemap.ts`) *(gap logged 2026-08-20)* | Lists home + `/frisco` + `/plano` + every indexable event URL, excludes non-indexable, correct priorities, all on the `openeventz.com` origin | ⚠️ **GAP — no automated test yet** |
| 19.1.10 | Robots route (`robots.ts`) *(gap logged 2026-08-20)* | Allows `/`, disallows `/api/` + `/dashboard`, references `sitemap.xml`, host = `openeventz.com` | ⚠️ **GAP — no automated test yet** |
| 19.1.11 | Live rich-result validation *(gap logged 2026-08-20)* | A live `openeventz.com/events/[id]` URL passes Google's Rich Results Test as a valid **Event** with no errors | [M] pending — never run |

### 19.2 Calendar (.ics)
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 19.2.1 | ICS structure | Valid VCALENDAR/VEVENT, CRLF, UID/DTSTAMP/DTSTART/DTEND | [A] [R] · ics.test.ts |
| 19.2.2 | RFC 5545 escaping | Commas/semicolons/newlines escaped in title/location/description | [A] [R] · ics.test.ts |
| 19.2.3 | No end time | DTEND falls back to DTSTART | [A] [R] · ics.test.ts |
| 19.2.4 | Filename slug | Title slugified to a safe `.ics` filename | [A] [R] · ics.test.ts |

### 19.3 Analytics plumbing
| # | Scenario | Expected | Tag |
|---|---|---|---|
| 19.3.1 | BigQuery row mapping | `mapBqRow` extracts session/event_id/method/fields/city + channel | [A] [R] · bigquery.test.ts |

---

*Regression suite = every `[A] [R]` row above (automated in CI) plus the `[R]`-tagged manual/UI rows run before a deploy. Manual `[M]` rows are verified by hand — live ingest, LLM calibration (`npm run calibrate:price`), GA4 realtime, dashboards-with-real-data, and mobile/tooltip behavior.*
