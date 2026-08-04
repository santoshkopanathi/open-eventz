# Open Eventz — Functional Test Scenarios
Version: consolidated (base + v1.1 + v1.2)
Last updated: 2026-07-23

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

---

## 1. Data Ingest Pipeline

### 1.1 Frisco Library (BiblioCommons HTML scrape)
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.1.1 | Ingest runs against the live Frisco Library calendar | Events table populated; no ingest errors | [R] [M] |
| 1.1.2 | Time formatted `10:00am` (no space) | Parsed as 10:00 AM; no date-parse error | [R] [M] |
| 1.1.3 | Same event in multiple audience feeds | One record per event; no duplicate IDs | [R] [M] |
| 1.1.4 | Detail page scraped for age data | `age_label` populated from "Suitable for:" block | [R] [M] |
| 1.1.5 | No "Suitable for:" block on detail page | `age_label` null; event still ingested | [R] [M] |
| 1.1.6 | Detail-page fetch returns HTTP error | Error logged for that event; others continue; other sources unaffected | [R] [M] |

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

### 1.4 Ingest security & architecture
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 1.4.1 | `/api/ingest` without bearer token | 401; no ingest runs | [R] [M] |
| 1.4.2 | `/api/ingest` with valid token | Runs; 200 with summary | [R] [M] |
| 1.4.3 | Composite ID for existing event | Upsert updates; no duplicate row | [R] [M] |

---

## 2. Event Display — List View (core)
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 2.1 | App loads, no filters | All upcoming events, date-ascending | [R] |
| 2.2 | Events from all three sources present | Unified list shows all three | [R] |
| 2.3 | Card content | Title, time, location, source visible without opening detail | [R] |
| 2.4 | Registration required | "Reg." badge on card | [R] |
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
| 9.7 | Date inputs placement | Same filter row on desktop; wrap on narrow widths | [M] |
| 9.8 | Click outside an open dropdown | Dropdown closes | [M] |

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
| 11.1 | Title on 2+ future dates within a source | `↻ Recurring` badge on card + detail | [A] [R] · recurring.test.ts |
| 11.2 | Single-occurrence event | No recurring badge | [A] [R] · recurring.test.ts |
| 11.3 | Same title in two sources | Not merged (source-scoped) | [A] · recurring.test.ts |
| 11.4 | Pre-flagged recurring at scrape time | Flag preserved; label not overwritten | [A] · recurring.test.ts |

---

## 12. Event detail view — core, supervision, actions
| # | Scenario | Expected result | Tag |
|---|---|---|---|
| 12.1 | Click a card (desktop) | Detail panel opens (title, date, time, location, description) | [R] |
| 12.2 | Click a card (mobile) | Full-screen overlay; back button visible | [R] |
| 12.3 | Tap mobile back button | Overlay closes; list visible (filters preserved) | [R] |
| 12.4 | Click close (desktop) | Panel closes; welcome panel shown | [R] |
| 12.5 | Free / paid detail | "Free admission" / "Paid" pill (see §6 for `✦` rules) | [R] |
| 12.6 | Registration required | Yellow registration banner | [R] |
| 12.7 | Supervision "can kids be dropped off?" badge | Per-source drop-off badge — fully specified in **§12A. Supervision Badge** below | [A] [R] · supervision.test.ts |
| 12.11 | Add to Google Calendar | Opens Google Calendar link, event pre-filled | [R] |
| 12.12 | Add to Apple Calendar | Opens the `/api/ics/[id]` `text/calendar` route → iOS opens Add-to-Calendar (no file download) | [A] [R] · ics.test.ts |
| 12.13 | Get directions | Opens directions with venue address | [R] |
| 12.14 | Attending toggle + persistence | Count increments/decrements; state persists (localStorage) | [R] |

---

## 12A. Supervision Badge (detail view)

The "can kids be dropped off?" badge is resolved per source by `getSupervisionBadge` (`src/lib/supervision.ts`) and rendered in the event detail panel. All six rows run automatically on every push (Jest unit job). **History:** originally shown for all three sources; silently narrowed to Frisco-only in a pre-git refactor; rediscovered via product review; restored 2026-08-04 (see BUILD-LOG "Drop-off policy badge" / "Learning 5").

| # | Scenario | Expected result | Tag |
|---|---|---|---|
| S.1 | Frisco Library, age 0–5 | Red "adult must stay with child" badge | [A] [R] · supervision.test.ts |
| S.2 | Frisco Library, age 6–12 | Blue "only if child is 10 or older" (drop-off OK at 10+) badge | [A] [R] · supervision.test.ts |
| S.3 | Frisco Library, teens 13–17 | Green "teens 13+ may attend alone" badge | [A] [R] · supervision.test.ts |
| S.4 | Plano Libraries, any age | Blue "Plan to stay" badge + "no formal Plano Library policy" sub-line (never a hard age cutoff) | [A] [R] · supervision.test.ts |
| S.5 | Play Frisco, any event | Grey "Check with venue" badge + "before dropping off" sub-line | [A] [R] · supervision.test.ts |
| S.6 | No source match (unrecognised source) | No supervision badge rendered (null) | [A] [R] · supervision.test.ts |

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
| 13.2.1 | Adult-only event (e.g. board meeting) | `kid_relevant:false`; excluded from all views | [M] |
| 13.2.2 | Confidence low | Buckets stored but not shown; no badge | [M] |
| 13.2.3 | Claude returns malformed JSON | Error logged; event stored without age data; no ingest failure | [M] |
| 13.2.4 | Claude times out | Error logged; event stored; pipeline continues | [M] |
| 13.2.5 | Event already inferred in DB | Re-ingest does not re-call Claude (cache) | [M] |
| 13.2.6 | New Play Frisco event | Next ingest infers only the new event | [M] |

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
