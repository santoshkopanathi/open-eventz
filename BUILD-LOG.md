# Open Eventz — Build Log
*A plain-English record of every build decision, written for a technical PM.*

---

## How to use this file
Each entry explains: **what we built**, **why we built it**, and **how to talk about it**. 
Use this to prep for portfolio conversations, interviews, or stakeholder demos.

---

## Phase 1 — Foundation
*Goal: Get a working skeleton deployed with a real database connection.*

---

### Step 1 — Install Node.js
**Date:** June 2026

**What we did:** Installed Node.js v24 on the local machine.

**Why:** Node.js is the runtime that powers everything — it executes JavaScript outside the browser. npm (Node Package Manager) comes bundled with it and is how we install third-party libraries like Supabase, the XML parser, etc.

**How to talk about it:** *"The entire stack runs on Node.js — both the Next.js frontend and the API routes run in the same Node runtime, which simplifies deployment significantly."*

---

### Step 2 — Scaffold the Next.js App
**Date:** June 2026  
**File created:** entire `06-app/` directory structure

**What we did:** Ran `npx create-next-app@latest` with TypeScript, Tailwind CSS, and the App Router.

**Why each choice:**
- **Next.js 14 App Router** — gives us both the frontend (React UI) and backend (API routes) in one codebase, one deployment. No separate Express server needed.
- **TypeScript** — catches bugs at write time, not runtime. Every event object has a defined shape — if the ingest route tries to save a field that doesn't exist on the Event type, TypeScript flags it before the code runs.
- **Tailwind CSS** — utility-first CSS framework. Speeds up UI development significantly; no separate CSS files to manage.

**How to talk about it:** *"I chose Next.js because it collapses frontend and backend into one deployable unit — the API routes that power the data pipeline live right next to the UI components that consume them. That's a meaningful simplification for a solo-built product."*

---

### Step 3 — Configure the Design System
**Date:** June 2026  
**File modified:** `src/app/globals.css`

**What we did:** Added the Open Eventz brand colors as CSS custom properties and Tailwind theme tokens — deep indigo (`#2D3561`), muted gold (`#C4B068`), periwinkle (`#7B82C2`), etc.

**Why:** Design tokens are the single source of truth for visual identity. By defining them once in CSS, every component automatically uses the right color — no hardcoded hex values scattered across files. Change one token, the whole app updates.

**How to talk about it:** *"I matched the design system exactly to the prototype HTML — same color variables, same typography scale, same spacing. That meant when I built UI components, they matched the prototype on first render rather than requiring visual QA passes."*

---

### Step 4 — Set Up the Database Schema
**Date:** June 2026  
**Location:** Supabase SQL Editor (runs in the cloud, not locally)

**What we did:** Created three tables in PostgreSQL via Supabase:

**`events` table** — the core of the product. Stores every event from all three sources in a normalized format. Key design decisions:
- `id` is `"{source}-{original-id}"` (e.g. `frisco-library-12345`) — composite key that prevents duplicate ingests without needing a separate deduplication query
- `raw_json` column stores the original parsed data — useful for debugging when a source changes its format
- Indexed on `source`, `start_datetime`, and `is_free` — the three most common filter combinations

**`supervision_policies` table** — stores the "can kids attend unattended?" policy per venue. Pre-seeded with verified data:
- Frisco Library: Tier 2 — children 10+ can attend without a parent (sourced from official 2026 Service Policy §8.5)
- Plano Library: Tier 2 — no age requirement, parent's discretion (confirmed via phone)
- Play Frisco: Tier 3 — unverified, always shows "Check with venue"

**`like_counts` table** — stores a shared like counter per event. Separate from `events` so like updates don't lock the main events table.

**How to talk about it:** *"The schema is designed around the read pattern, not the write pattern. Filters are indexed because that's the hot path — 100% of page loads hit those indexes. The supervision policy table is separate because it has a different update cadence from events — it changes maybe once a year when a library updates its policy."*

---

### Step 5 — Set Up Supabase Client
**Date:** June 2026  
**File created:** `src/lib/supabase.ts`

**What we did:** Created two Supabase client connections:
1. **Public client** (`supabase`) — uses the anon key, safe to use in browser-facing code, subject to Row Level Security
2. **Admin client** (`supabaseAdmin`) — uses the service role key, only used in server-side API routes, bypasses RLS

**Why two clients:** The public client is safe to expose — Supabase's anon key is designed to be public. The service role key is secret and only ever runs on the server (in API routes), never in the browser. This separation is a standard security pattern.

**How to talk about it:** *"I followed the principle of least privilege — the browser only ever gets read access via the anon key. The ingest pipeline uses the service role key server-side to write events, and that key never leaves the server."*

---

### Step 6 — Build the Data Pipeline (`/api/ingest`)
**Date:** June 2026  
**File created:** `src/app/api/ingest/route.ts`

**What we did:** Built a POST endpoint that ingests events from all three sources in parallel and upserts them into Supabase.

**Architecture — why database-first:**
The app does NOT fetch live event feeds on every page load. Instead:
```
[Frisco RSS] ──┐
[Plano XML]  ──┤→ /api/ingest (runs daily at 6 AM CT) → Supabase
[Play Frisco iCal] ┘                                         ↑
                                              UI reads only from here
```
This means page loads are fast (DB query, not live HTTP fetch), and if one source's feed goes down, the last ingested data still shows.

**What each ingester does:**

*Frisco Library (BiblioCommons RSS):*  
Fetches RSS feed three times — once per audience segment (Children 0–5, Children 6–12, Teens). Parses XML, extracts title/date/description/URL, guesses category from keywords in the title.

*Plano Library (Communico XML):*  
Fetches Communico's public XML export endpoint. Communico explicitly flags recurring events and includes age group fields — better structured than the RSS feed.

*Play Frisco (iCalendar):*  
Fetches the city's `.ics` calendar file and parses it manually. iCal is a text-based format — each event is a `BEGIN:VEVENT ... END:VEVENT` block. We extract UID, summary, start/end times, location, and URL.

**Security:** The endpoint is protected by a `CRON_SECRET` bearer token. Without it, the endpoint returns 401. This prevents anyone on the internet from triggering a mass ingest.

**How to talk about it:** *"I chose a database-first architecture because the alternative — fetching three live feeds on every page load — would make the app fragile and slow. If BiblioCommons is having a bad day, I don't want that to break the user experience. With daily ingest into Supabase, the UI always has data to show, and source failures are isolated to the pipeline, not the user-facing app."*

---

### Step 7 — Build the Events Query API (`/api/events`)
**Date:** June 2026  
**File created:** `src/app/api/events/route.ts`

**What we did:** Built a GET endpoint that the UI calls to fetch events with filters applied.

**Supported filters:**
- `?source=frisco-library` — filter by source
- `?is_free=true` — only free events
- `?age=7` — only events appropriate for a 7-year-old
- `?date_from=2026-06-24&date_to=2026-06-30` — date range
- Always excludes past events automatically

**Why a dedicated API route instead of querying Supabase directly from the UI:**  
The UI could technically call Supabase directly using the public client. But having an API route in between lets us add rate limiting, logging, and business logic later without touching the UI. It's also cleaner — the UI doesn't need to know anything about how the database is structured.

**How to talk about it:** *"The events endpoint is a thin query layer — it translates URL parameters into Supabase query predicates. It also enforces that only future events are returned, which is a business rule that belongs in the API, not the UI."*

---

### Step 8 — Build the Likes API (`/api/likes/[eventId]`)
**Date:** June 2026  
**File created:** `src/app/api/likes/[eventId]/route.ts`

**What we did:** Built two endpoints:
- `GET /api/likes/[eventId]` — returns current like count
- `POST /api/likes/[eventId]` — increments like count by 1

**Two-layer storage pattern:**
- **Shared like count** → stored in Supabase `like_counts` table, incremented via API call
- **Personal selection** → stored in browser `localStorage` as `liked_{eventId}` — restored on next visit, no server call needed

**Tradeoff acknowledged:** Without user accounts, we can't prevent the same person from liking multiple times across devices or incognito windows. IP-based rate limiting is a lightweight mitigation (on the roadmap). This is the right tradeoff for v1 — no accounts, no friction, just engagement signal.

**How to talk about it:** *"The like feature is a two-layer design — shared state lives on the server (so the count is real and consistent across all users), personal state lives in localStorage (so the button shows as 'liked' when you come back, without needing an account). It's a common pattern for anonymous engagement features."*

---

### Step 9 — Configure Environment Variables
**Date:** June 2026  
**File created:** `.env.local`

**What we did:** Created a local environment file with five secret keys:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The URL of our Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public read key — safe to expose to browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret write key — server-only, never sent to browser |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Key for Google Maps JavaScript API |
| `CRON_SECRET` | Password that protects the `/api/ingest` endpoint |

**`NEXT_PUBLIC_` prefix:** Variables prefixed with `NEXT_PUBLIC_` are bundled into the browser JavaScript. Variables without it are server-only. This is Next.js's built-in secret management — the service role key and cron secret never reach the client.

**How to talk about it:** *"Environment variables separate configuration from code. The same codebase runs in development (pointing at our real Supabase project) and production (same keys, deployed on Vercel) without any code changes — just environment config."*

---

### Step 10 — Configure Vercel Cron Job
**Date:** June 2026  
**File created:** `vercel.json`

**What we did:** Added a cron schedule that tells Vercel to call `/api/ingest` every day at 11:00 UTC (6:00 AM Central Time).

**Why 6 AM CT:** Libraries typically publish new events overnight or early morning. By running the ingest at 6 AM, the app has fresh data before most parents open it during the day.

**How to talk about it:** *"The cron job is the heartbeat of the data pipeline. It's what makes the app 'automatically current' — no one manually updates events. Vercel handles the scheduling infrastructure; we just define the endpoint and the schedule in `vercel.json`."*

---

## Phase 2 — Data Pipeline Debugging
*Goal: Verify all three feeds are ingesting real events into Supabase.*

### Step 11 — Frisco Library: Debugging the Data Feed
**Date:** June 2026  
**Outcome:** ✅ 20 unique events ingesting successfully

**What we expected:** A public RSS feed at a documented URL returning XML event data.

**What we found:** BiblioCommons (the vendor) has quietly retired RSS and serves everything through a JavaScript-rendered web app.

**What we tried — and why each failed:**

1. **RSS URL** (`/events/search.rss`) — 404. The endpoint no longer exists.
2. **Different parameter formats** (`audience[]` vs `audience_id[]`) — still 404. Parameter name wasn't the issue; the endpoint itself is gone.
3. **iCal feed** (`/events/search.ics`) — redirected to the HTML page.
4. **BiblioCommons internal JSON API** (`/api/v1/events/search`) — 404. Not publicly accessible.
5. **`__NEXT_DATA__` extraction** — BiblioCommons looks like a Next.js app from the outside, but events data is NOT in the server-side JSON blob.
6. **XHR interception** — ran JavaScript in DevTools to intercept all network calls. Found nothing — no separate API call is made for events.
7. **Fetch interception** — same result. Only Google Analytics calls, no events API.
8. **HTML scraping** — realized events ARE fully server-rendered in the HTML as plain markup. Used DevTools Console to find the exact CSS class structure: each event lives in a `<li><div class="cp-events-search-item">` block.
9. **Regex on HTML** — wrote regex to split HTML on card boundaries and extract each field. Hit three sub-bugs:
   - Wrong regex boundary → fixed by splitting on the opening tag
   - Date format `10:00am` not parseable by JavaScript's `new Date()` → normalized to `10:00 AM`
   - Same events appearing across all 3 audience segments causing duplicate ID conflict in Supabase → fixed by deduplicating with a Map before upserting

**Final solution:** Fetch the HTML page server-side, split on `<li><div class="cp-events-search-item">`, regex-extract each field. 20 unique events per page load.

**How to talk about it:** *"BiblioCommons retired their RSS feed without notice. Rather than abandon the source, I reverse-engineered the HTML structure the website uses to render events server-side and built a structured parser against that. It's more brittle than an API, but it's what the data reality required — and I built it with graceful error handling so if their HTML structure changes, the app shows a source-unavailable banner rather than crashing."*

---

### Step 12 — Plano Library: Debugging the Data Feed
**Date:** June 2026  
**Outcome:** ✅ 500 events ingesting successfully

**What we expected:** A Communico XML export endpoint at a documented URL.

**What we found:** Communico's public-facing subdomain routes API paths to their library website, not a data API. Their events API requires authentication they don't issue publicly.

**What we tried — and why each failed:**

1. **Communico XML export** (`plano.communico.co/api/attend/events/export.xml`) — routed to the Plano Library website with a 404.
2. **Communico JSON API** (`plano.communico.co/api/attend/events`) — same result.
3. **Direct API** (`api.communico.co/v1/plano/events`) — returned valid JSON (`[]`) but always empty regardless of date parameters tried. The API exists but requires an auth token.
4. **DevTools network inspection** — found two working API calls (`eventstags`, `eventsages`) confirming the base URL pattern, but the events endpoint requires authentication we don't have.
5. **RSS button on the page** — noticed an RSS icon on the Plano events page. Clicked it — revealed a feed URL with a base64-encoded JWT token containing filter settings: `{"feedType":"rss","filters":{"location":["all"],"ages":["all"],"days":1}}`. Default was only 1 day of events.
6. **Decoded and modified the token** — regenerated the base64 token with `"days":365` to get a full year of events.

**Final solution:** `plano.libnet.info/feeds?data={base64-encoded-filter}` — a proper RSS feed returning up to 500 events. Also added a branch lookup table mapping each of Plano's 5 library locations (Davis, Haggard, Harrington, Parr, Schimelpfenig) to its real street address and lat/lng coordinates for accurate map pins.

**How to talk about it:** *"Communico's documented API requires vendor-issued auth tokens they don't provide publicly. Rather than treat this as a dead end, I inspected the network calls the Plano Library website makes and found a public RSS feed URL with base64-encoded filter parameters. I decoded the token, modified the date range from 1 day to 365 days, and had a working feed. This is a pattern that comes up constantly in civic data work — the official path is blocked, but the website itself is always talking to something."*

---

### The Broader Lesson
Both vendors (BiblioCommons and Communico) have documented APIs that are either retired or require authentication tokens they don't issue publicly. The workaround in both cases was finding what the website itself uses — either scraping the rendered HTML or reverse-engineering the RSS feed URL — rather than relying on official documentation. This is a common pattern when building against library vendor platforms, and it's why the ingest route is built with per-source error isolation: if a vendor changes their HTML or URL structure, only that source goes down, not the whole app.

---

## Data Extraction — Full Technical Discussion by Source

*This section documents the full investigation for each source: what we tried, what failed, what we landed on, and why. Written for portfolio and interview use.*

---

### Source 1 — Frisco Public Library (BiblioCommons)

**What we needed:** A list of upcoming events with title, date, time, location, description, and audience/age group.

**Platform:** BiblioCommons — a library events platform used by hundreds of public libraries. Owned by Baker & Taylor.

#### Approaches considered

**Option A — Official BiblioCommons RSS feed**
BiblioCommons historically provided a public RSS feed at `/events/search.rss`. This was the obvious first choice — structured, documented, no scraping needed.
- *Outcome:* 404. The endpoint has been retired with no announcement. Dead end.

**Option B — iCal feed**
BiblioCommons also historically provided `.ics` calendar exports.
- *Outcome:* The URL redirected to the HTML events page. Not available.

**Option C — BiblioCommons internal JSON API**
Inspected network traffic in DevTools looking for an XHR/fetch call that loads event data dynamically.
- *Outcome:* No separate API call exists. Events are fully server-rendered in HTML — the page arrives with all event data already embedded in the markup. No JSON API to intercept.

**Option D — `__NEXT_DATA__` extraction**
BiblioCommons's web app resembles a Next.js app from the outside. Next.js apps typically embed their server-side data in a `<script id="__NEXT_DATA__">` tag in the HTML.
- *Outcome:* The `__NEXT_DATA__` blob exists but does not contain events data. BiblioCommons uses a custom rendering pipeline, not standard Next.js data fetching.

**Option E — HTML scraping (chosen)**
Since events are fully embedded in the server-rendered HTML, we can parse the HTML directly. Used DevTools to identify the card structure: each event lives inside `<li><div class="cp-events-search-item">`. Split the HTML on this boundary and regex-extract each field (title, date, time, location, URL).

*Why we chose this:* It's the only approach that actually works. The data is there in the HTML — we just have to reach it differently than an API. Downsides: brittle to HTML structure changes, requires per-request HTTP fetches. Mitigated by: per-source error isolation and graceful fallback.

#### Challenges encountered
1. **Date parsing** — BiblioCommons formats times as `10:00am` (no space). JavaScript's `Date()` constructor requires `10:00 AM`. Fixed with a normalization step.
2. **Duplicate events** — the same event appears in all three audience feeds (0–5, 6–12, teens). Without deduplication, the same event was upserted 3 times. Fixed with a Map keyed on event ID before upserting.
3. **HTML entities in titles** — event titles like `D&D One-Shot` were stored as `D&amp;D One-Shot` because the HTML entity was not decoded before storing. Fixed by running titles through `decodeHtml()`.
4. **Adult events in children feeds** — BiblioCommons incorrectly tags some adult programs (Write Club, Business Book Club, ESL classes) in the 0–12 audience feeds. These passed through age filters with `age_min=0, age_max=12`. Fixed with a two-layer keyword blocklist at ingest and API level.

#### What we landed on
- Fetch three audience-segmented HTML pages (one per age group) server-side
- Parse each page by splitting on card boundaries
- Fetch individual event pages for the "Suitable for:" block to get authoritative age data
- Deduplicate by event ID, merge age ranges across feeds
- Apply adult keyword exclusion as safety net

---

### Source 2 — Plano Public Libraries (Communico)

**What we needed:** Events from all 5 Plano branch libraries with title, date, time, location, and ideally age group.

**Platform:** Communico — a library events management platform. Provides both a public-facing website and a vendor API.

#### Approaches considered

**Option A — Communico documented API**
Communico has a REST API at `plano.communico.co/api/attend/events`. Standard first choice — structured JSON, proper pagination.
- *Outcome:* Returns valid JSON but always `[]` (empty array). The endpoint exists but requires a vendor-issued auth token that Communico does not provide to the public. Dead end without a library staff contact.

**Option B — Communico XML export endpoint**
Found a reference to `plano.communico.co/api/attend/events/export.xml` in developer documentation.
- *Outcome:* The subdomain routes all traffic to the Plano Library website — not a data endpoint. 404.

**Option C — DevTools API interception**
Opened the Plano Library events page and monitored all network calls. Found two working endpoints: `eventstags` and `eventsages` — confirming the base URL pattern. However, the events endpoint itself requires authentication.
- *Outcome:* Confirmed the API structure but still blocked by auth.

**Option D — RSS feed via page inspection (chosen)**
Noticed an RSS icon on the Plano Library events page. Clicked it — the URL contained a base64-encoded filter token: `{"feedType":"rss","filters":{"location":["all"],"ages":["all"],"days":1}}`. The default was only 1 day of events.

Decoded the token, changed `"days":1` to `"days":365`, re-encoded in base64, and had a full year of events across all branches.

*Why we chose this:* The RSS feed is publicly accessible, properly structured XML, returns real event data, and is filterable by branch (location ID). No auth required — it's what the public-facing website uses.

#### Challenges encountered
1. **Branch disambiguation** — the RSS feed returns a location name but no address or coordinates. Built a lookup table mapping each of the 5 branch names to their real street address and lat/lng for accurate map pins.
2. **No age data in feed** — the RSS items have no `<category>` or age field. Age group is only available on individual event detail pages (see Plano Age Filter section above).
3. **Adult events** — events like Conversational English, Citizenship Classes, SCORE Mentoring appear in the feed with no age signal. With no age filter active these show in the all-events view. Planned fix: per-event page fetch to read the AGE GROUP block.
4. **HTML entities in descriptions** — same issue as Frisco. Descriptions sometimes contain `&amp;`, `&lt;` etc. Fixed with `decodeHtml()`.

#### What we landed on
- Per-branch RSS feeds using base64-encoded filter tokens, `days=365`
- Branch lookup table for address/coordinates
- `parseAgeRange()` on title text as a partial age signal (e.g. "Rhyme Time (0-24 months)")
- Per-event page fetch planned to scrape the AGE GROUP block for reliable age data

---

### Source 3 — Play Frisco (City of Frisco Parks & Recreation — CivicPlus)

**What we needed:** Parks and recreation events including classes, camps, and public programs organized by the City of Frisco.

**Platform:** CivicPlus — a government website platform used by hundreds of US municipalities. Powers `friscotexas.gov`.

#### Approaches considered

**Option A — City API or open data portal**
Many US cities publish open data portals (e.g. data.gov, Socrata). Checked the City of Frisco website for any published API or data download.
- *Outcome:* No open data portal for events. No documented API. The city's website is entirely CivicPlus-managed.

**Option B — iCal / calendar export**
CivicPlus calendar pages sometimes offer `.ics` export links. Checked the Frisco calendar page.
- *Outcome:* No `.ics` export available on the public-facing calendar page.

**Option C — RSS feed**
Checked for RSS feed links on the CivicPlus calendar page.
- *Outcome:* No RSS feed exposed.

**Option D — CivicPlus calendar HTML scraping (chosen)**
The city's calendar page (`friscotexas.gov/calendar.aspx?view=list&CID=85,81`) renders events as HTML. Each event has an `EID` (Event ID) in its URL. Two-step approach:
1. Fetch the calendar listing page month by month to collect all EIDs
2. Fetch each individual event detail page (`/Calendar.aspx?EID=xxx&view=detail`) to get full event data

CivicPlus uses semantic HTML with `itemprop` microdata attributes (Schema.org standard), making field extraction reliable.

*Why we chose this:* Only viable option. The data is publicly visible on the website — we just automate what a user would do manually.

#### Challenges encountered
1. **Adult and non-kids events** — Play Frisco covers all city recreation, including events for adults, seniors, city council meetings, irrigation workshops, etc. Without filtering, these would appear in a kids app. Fixed with `PARKS_REC_EXCLUDE_KEYWORDS` — a blocklist of ~25 keywords (board, council, senior, adult fitness, etc.) applied at ingest time.
2. **End time not in microdata** — CivicPlus's `itemprop="endDate"` is not present. End time is only in a free-text "Time:" detail block (e.g. "2:00 PM - 4:00 PM"). Required a custom regex parser.
3. **Stale events** — unlike Frisco Library (which is deduped by event ID), CivicPlus doesn't guarantee stable EIDs for recurring events. Added a purge step: after each ingest, delete any play-frisco events from the DB whose IDs are not in the current ingest batch.
4. **Price detection** — Play Frisco mixes free and paid events. No structured price field — price is mentioned in the description. Built `parsePriceFromText()` to detect keywords like "cost:", "fee", "buy tickets", "$X".

#### What we landed on
- Two-pass scrape: calendar listing pages (2 months) to collect EIDs, then individual detail pages for full data
- CivicPlus microdata (`itemprop`) for structured fields where available, regex fallback for unstructured fields
- `PARKS_REC_EXCLUDE_KEYWORDS` blocklist + DB purge for stale records
- `parsePriceFromText()` for free/paid detection

---

---

## Frisco Library Age Filtering — Implementation

**Date:** July 2026

### How age data is obtained
BiblioCommons provides three separate audience-segmented event feeds, each fetched independently:

| Audience ID | Segment | Default age range |
|---|---|---|
| `5d93b3bfed969d4f000b6181` | Children (0–5) | age_min=0, age_max=5 |
| `5d93b3c7bfbf9a4400c52504` | Children (6–12) | age_min=6, age_max=12 |
| `5d8a3b0171f1994500ba504b` | Teens (13–17) | age_min=13, age_max=17 |

### Per-event page fetch — the "Suitable for:" block
For every event within the next month, the ingest fetches the individual BiblioCommons event page and scrapes the **"Suitable for:"** section, which lists all audiences the event is tagged for. Example:

```
Suitable for: Children (0–5), Children (6–12), Adults
```

The scraper reads a 600-character window after the "Suitable for" string and checks for audience keywords:
- `hasAdult` — block contains "adult" or "senior"
- `hasChild05` — block contains "children (0"
- `hasChild612` — block contains "children (6"
- `hasTween` — block contains "tween"
- `hasTeen` — block contains "teen"

**Decision logic:**
| Audience combination | Result |
|---|---|
| Adults only | age_min=18, age_max=99 — excluded from all kid filters |
| Adults + teens | age_min=13, age_max=17 |
| Adults + young kids | age_min=0, age_max=17 — shown in all filters |
| Kids/teens only | union of all tagged audiences (min of mins, max of maxes) |
| No "Suitable for:" block found | age_min=0, age_max=17 (treat as all ages) |
| Page fetch fails / event > 1 month away | falls back to audience feed defaults |

### Deduplication — events in multiple feeds
The same event can appear in more than one audience feed (e.g. a family story time in both 0–5 and 6–12 feeds). The ingest deduplicates by event ID and merges age ranges using `min(age_min)` and `max(age_max)` across all feed appearances — so an event in both 0–5 and 6–12 feeds gets age_min=0, age_max=12.

**Edge case discovered:** Adult events (Write Club, Business Book Club, etc.) were incorrectly tagged by BiblioCommons in the children feeds. Their event pages either had no "Suitable for:" block or fetched a page that failed silently, so they inherited the feed's default age range (0–12) and appeared in the Kids filter. 

### Adult keyword exclusion (safety net)
Because BiblioCommons sometimes mislabels adult programs in children feeds, a keyword blocklist is applied at two layers:

1. **Ingest layer** — events with these title keywords are skipped entirely and never stored:
   `book club`, `write club`, `figure club`, `reader's choice`, `entrepreneur's workshop`, `esl book`

2. **API layer** — when `source=frisco-library` and an age filter is active, the same keywords are filtered out of results in JavaScript after the DB query. This catches any events that slipped through before the ingest fix was applied.

### Drop-off policy badge
The supervision badge shown on each Frisco Library event detail is derived from the event's stored `age_min`/`age_max` — not a generic per-source label:

| Event age range | Badge shown |
|---|---|
| age_max ≤ 9 | ❌ No — adult must stay with child |
| Mixed 6–12 (age_min < 10, age_max > 9) | 🔵 Only if child is 10 or older (Frisco Library policy) |
| age_min ≥ 13 | ✅ Yes — teens 13+ may attend alone |
| No age data | ⚠️ Check with Frisco Library |

Policy source: Frisco Public Library Service Policy §8.5 (2026).

### How to talk about it
*"BiblioCommons doesn't expose age data in their HTML event listings — it's only on the individual event detail pages. For every upcoming event we fetch the detail page and scrape the 'Suitable for:' section, which tells us the exact audience combination. We then compute the age range union and store it as structured age_min/age_max fields. This lets us power a real age filter in the UI rather than relying on which feed the event happened to come from. We also discovered that BiblioCommons occasionally mislabels adult programs in children feeds, so we added a keyword blocklist at both the ingest and API layers as a safety net."*

---

## Planned: Plano Libraries Age Filter

**Decision date:** July 2026

### What we discovered
The Communico RSS feed that powers Plano Libraries does **not** include age/audience data in its feed items — no `<category>` field, no structured age tag. However, each individual event detail page (e.g. `plano.libnet.info/event/15756298`) contains a clearly structured **AGE GROUP** block:

```html
<p style="font-size: 0.8em;">AGE GROUP: <small>|</small>
  <a href="/events?a=Older+Adults">Older Adults</a> <small>|</small>
  <a href="/events?a=Adults">Adults</a> <small>|</small>
</p>
```

### Complete audience taxonomy (scraped from 40 real events)
| Communico value | Count observed | Age bucket |
|---|---|---|
| `Babies` | 11 | 0–5 |
| `Toddlers` | 11 | 0–5 |
| `Preschoolers` | 10 | 0–5 |
| `Kids` | 14 | 6–12 |
| `Teens` | 6 | 13–17 |
| `Families (All Ages)` | 11 | 0–17 (show in all buckets) |
| `Adults` | 15 | 18+ (exclude from all kid filters) |
| `Older Adults` | 13 | 18+ (exclude from all kid filters) |

Only 8 distinct values — clean and complete with no ambiguity.

### Planned approach
1. **Per-event page fetch during ingest** — same strategy as Frisco Library's "Suitable for:" scrape. For each Plano event, fetch the detail page and extract all `href="/events?a=VALUE"` links within the AGE GROUP block.
2. **Map to age_min/age_max** — convert Communico audience values to our standard numeric range using the table above. Multiple audiences (e.g. Babies + Toddlers) take the union (min of mins, max of maxes).
3. **Title parsing as fallback** — some events include age in the title (e.g. "Rhyme Time (0-24 months)", "Preschool Storytime (3-5 years)"). Use this as a secondary signal when the AGE GROUP block is absent or ambiguous.
4. **Expose age sub-filter in UI** — once age data is reliable for Plano, show the same 0–5 / 6–12 / Teens chip filter under Plano Libraries (currently only shown for Frisco Library).

### Why title data as a secondary signal
Plano librarians often include the target age in the event title (e.g. "Rhyme Time (0-24 months)"). This is a useful cross-check — if the page-scraped audience says "Kids" but the title says "3-5 years", the title is more specific and should narrow the result. Priority: page-scraped AGE GROUP > title parsing > null.

### How to talk about it
*"Communico's RSS feed doesn't expose age data, but the event detail pages have a structured AGE GROUP section with links. I scraped 40 events across all Plano branches to catalogue the complete set of audience values — there are exactly 8 — and mapped them to our standard age buckets. The ingest now fetches each event page individually, the same pattern we use for Frisco Library, giving us reliable age filtering across both library systems."*

---

## Engineering Learnings

A record of decisions that turned out to be wrong or unnecessary — and what we'd do differently.

---

### Learning 1 — The 1-month window was a premature optimisation

**Date:** July 2026

**What we built:** During the Plano age filter implementation, the ingest code only fetched event detail pages for events starting within 1 month of the ingest run. Events beyond that window fell back to `parseAgeRange(title)` — a regex that looks for age numbers in the event title.

**The original reasoning:** Plano has 5 branches, each with an RSS feed covering up to 365 days of events. Fetching a detail page per event could mean 150–250 HTTP requests per ingest run. The concern was that this would slow the ingest down significantly or risk getting rate-limited by Communico's servers.

**Why it was wrong:** We validated empirically by fetching 10 consecutive live Plano events — every single one had an AGE GROUP block. 10/10, 100% hit rate. Communico treats the age group field as required when librarians create events. The fallback was solving a problem that doesn't exist in practice.

The `parseAgeRange(title)` fallback barely works for Plano titles anyway. Titles like `"Financial Intelligence Training"` or `"Saturday Science Lab"` carry no age signal, so events beyond 1 month silently got no age data and became invisible under any age filter — the exact opposite of what we wanted.

The performance concern was also overstated: ingest runs as a background job, not on a user request. An extra 10–20 seconds of HTTP fetching is completely invisible to users.

**The fix:** Remove the 1-month window entirely. Always fetch the detail page for every Plano event, regardless of how far out it is.

**The lesson:** Don't optimise for scale problems that haven't been measured. The right sequence is: (1) validate data quality empirically first, (2) measure actual performance if it becomes a concern, (3) optimise only then. A premature cut to save HTTP requests cost us correctness across a significant portion of the event catalogue.

---

### Learning 2 — The Frisco Library audience_id filter was never actually working

**Date:** July 2026

**What we built:** The Frisco ingest loops through 3 BiblioCommons audience feeds — one each for Children (0–5), Children (6–12), and Teens — using `audience_id` URL parameters. The assumption was that each feed returned only events tagged for that audience, so we could assign `age_min`/`age_max` at the feed level as a reliable default before fetching individual event pages.

**How we discovered the problem:** We tested all 3 audience-filtered URLs plus the unfiltered URL in parallel. All 4 returned identical results: 252 events, same titles, same order. The `audience_id` parameter is silently ignored by BiblioCommons when fetched server-side — it requires a browser session cookie to honour the filter.

**What was actually happening during ingest:**
- The 3-feed loop was fetching the full unfiltered catalogue of 252 events 3 times over
- Each iteration assigned a different default age range based on which audience feed we *thought* we were in (0–5, 6–12, or Teens)
- For events within 1 month, the "Suitable for:" page scrape overwrote those defaults with the correct value — masking the bug
- For events beyond 1 month, the default age was set to whichever audience happened to come first in the loop (0–5), regardless of what the event actually was. Adult events, teen events, and kids events all got `age_min=0, age_max=5` if they were far enough out

**Why it wasn't caught earlier:** The keyword blocklist (`FRISCO_ADULT_KEYWORDS`) and the `age_min.lt.18` DB filter were catching the most visible adult events before they reached users. The far-future age misclassification only affects events that rarely surface (users don't typically browse 2+ months out), so there was no obvious symptom.

**The fix:** Drop the 3-feed loop entirely. Fetch all events from a single unfiltered paginated endpoint. Treat the "Suitable for:" page scrape as the sole source of age truth for Frisco — it was doing all the real work anyway.

**The lesson:** Validate that an API filter is actually doing what you think it is before building logic on top of it. A quick empirical check — fetch with the filter, fetch without, compare the results — takes 2 minutes and would have caught this immediately. Assumptions about third-party API behaviour should be verified, not inherited.

---

### Learning 3 — Vercel Hobby plan's 10-second function timeout makes cloud ingest impractical

**Date:** July 2026

**What happened:** After deploying to Vercel, we attempted to trigger the ingest via the production URL (`https://open-eventz.vercel.app/api/ingest`). Vercel returned `FUNCTION_INVOCATION_TIMEOUT` immediately. The ingest never completed.

**Root cause:** Vercel's Hobby (free) plan enforces a 10-second maximum execution time on serverless functions. Our ingest now fetches individual event detail pages for every event — approximately 252 Frisco Library pages plus ~150 Plano Library pages across 5 branches. At 1–2 seconds per page fetch, the full run takes 3–5 minutes, which is 18–30x over Vercel's limit.

**Why this only surfaced now:** The timeout was always there, but the original ingest only fetched detail pages for events within 1 month. After removing both the Frisco 3-feed loop and the Plano 1-month window (Learnings 1 and 2), the number of page fetches increased significantly and the timeout became unavoidable.

**Current workaround:** Run ingest locally. Both the local dev environment and the Vercel production deployment connect to the same Supabase database. Running ingest locally writes fresh data to Supabase, which the production site reads immediately — no deployment needed. This is a valid long-term workflow for a solo-operated product with infrequent data updates.

**Options if automated cloud ingest becomes a requirement:**

| Option | Cost | Notes |
|---|---|---|
| Vercel Pro | $20/month | Raises limit to 60s — still likely not enough for full ingest |
| Split by source | Free | `/api/ingest/frisco` and `/api/ingest/plano` as separate endpoints, each completing under 60s |
| GitHub Actions cron | Free | Scheduled workflow calls a cloud function or runs locally on a self-hosted runner; no Vercel timeout applies |
| Dedicated background job service (Railway, Render, Fly.io) | ~$5/month | Runs long-lived processes without serverless timeout constraints |

**The lesson:** Serverless functions are optimised for short-lived request/response cycles — typically under 1–3 seconds. Data pipeline jobs (scraping, ETL, ingest) are long-running by nature and are a poor fit for serverless unless deliberately chunked. Design ingest jobs to run outside the request path from the start.

---

*This log will be updated as each phase is completed.*
