# Open Eventz — Build Log
*A plain-English record of every build decision, written for a technical PM.*

---

## How to use this file
Each entry explains: **what we built**, **why we built it**, and **how to talk about it**. 
Use this to prep for portfolio conversations, interviews, or stakeholder demos.

---

## High-Level Technical Design

*How the system works end-to-end — written for a technical PM.*

---

### a) What happens every morning (ingest)

Triggered manually via:
```
POST /api/ingest   (Authorization: Bearer <secret>)
```

The ingest route runs three scrapers in sequence:

1. **Frisco Library (BiblioCommons)** — paginates through the event listing, then fetches each event's detail page to scrape the "Suitable for:" block for age data
2. **Plano Libraries (Communico)** — loops through 5 branch RSS feeds, deduplicates cross-branch events, fetches each event detail page to scrape the AGE GROUP block
3. **Play Frisco (CivicPlus)** — scrapes the city calendar listing page, then fetches each event detail page (EID-based two-pass)

For each source:
- **Upsert into Supabase** — if the event already exists (same ID), it updates it; if new, it inserts it
- **Stale event cleanup** — Play Frisco deletes any events from Supabase that weren't in today's batch (they've been removed from the city calendar)

Returns a JSON summary of events ingested and any errors. No automatic scheduling — the DB is now updated and nothing else happens until a user visits the site.

---

### b1) User accesses the site

1. Browser requests `https://open-eventz.vercel.app/`
2. Vercel serves the Next.js page — React renders the shell (header, filter bar, map, empty event list)
3. React immediately calls `GET /api/events` with no filters
4. The API queries Supabase: all events where `start_datetime >= today` and `age_min < 18 OR age_min IS NULL`, ordered by date, limit 1000
5. Supabase returns results → API sends JSON to browser
6. React renders the event list and map pins

---

### b2) User filters by city

1. User clicks "Frisco" or "Plano" tab
2. React updates local filter state (e.g. `sources: ['frisco-library', 'play-frisco']`)
3. UI calls `GET /api/events?source=frisco-library&source=play-frisco`
4. Supabase query adds `WHERE source IN ('frisco-library', 'play-frisco')`
5. Results return — event list and map pins refresh to show only that city's events

No page reload — client-side state change triggers a new API call.

---

### b3) User applies an age filter

1. User clicks an age chip e.g. "Kids (6–12)"
2. React updates filter state (`age: '6-12'`)
3. UI calls `GET /api/events?source=frisco-library&source=play-frisco&age=6-12`
4. API parses `age=6-12` → `ageMin=6, ageMax=12`
5. Supabase query adds overlap check:
   ```sql
   WHERE age_min IS NOT NULL AND age_max IS NOT NULL
   AND age_min <= 12 AND age_max >= 6
   ```
6. Only events whose age range overlaps 6–12 are returned and rendered

---

### b4) User clicks on an event to see details

1. User taps an event card
2. React sets `selectedEvent` in local state — **no API call**
3. `EventDetail` component renders with data already in memory (loaded during the events list call)
4. Separately, React calls `GET /api/likes/{event_id}` to fetch the attending count
5. Like count renders below the event details

The event data itself is never fetched twice.

---

### b5) User clicks "Get directions"

1. User taps "Get directions" on event detail
2. React constructs a Google Maps URL: `https://maps.google.com/?q=<location_address>`
3. Browser opens Google Maps in a new tab — Google handles everything from there
4. **No API call to our backend at all**

---

### b6) User clicks a map pin

1. User taps a pin on the Google Map
2. Google Maps React component fires an `onClick` event with that event's data
3. React sets `selectedEvent` in local state — same as clicking an event card
4. `EventDetail` slides in; `GET /api/likes/{event_id}` fires for the like count

No second fetch for event data — already in memory from the list call.

---

### Key pattern

**The heavy lifting happens at two points only:**
- **Ingest** (writing to DB) — runs once daily, manually triggered
- **Page load / filter change** (reading from DB) — one Supabase query per filter interaction

Everything else (event detail, directions, map pins, like counts) works off data already in memory or calls a lightweight single-row lookup.

> **Note:** This section reflects the current implementation. It will be updated when Play Frisco LLM inference is implemented — that introduces a Claude API call at ingest time and a new `age_source` / `kid_relevant` column in Supabase, which affects both the ingest flow (b1 above) and the adult exclusion logic.

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

### Learning 4 — The Plano "All Ages" tag was silently dropped because the test fixture didn't match the real feed

**Date:** July 2026

**What was broken:** Plano "Families (All Ages)" events never received the 0–17 age range they were supposed to. As a result they never appeared under any age-filter chip — the exact opposite of the intended behavior, where an all-ages event should surface under Toddlers, Kids, *and* Teens.

**How we discovered it:** The v1.1 regression pass (functional-test §5.8) found **zero** Plano events mapping to `age_min=0, age_max=17`, despite the BUILD-LOG audience taxonomy recording 11 "Families (All Ages)" events across 40 sampled. We fetched a live Plano event page and diffed the actual `AGE GROUP` markup against the parser's lookup keys.

**Root cause:** Communico URL-encodes the parentheses. The real audience value in the page is `Families+%28All+Ages%29`, but `COMMUNICO_AUDIENCE` keyed it as `Families+(All+Ages)` with literal parens. The lookup missed, the tag was discarded, and the event fell back to whatever other audiences it happened to carry (or to null). Every other audience value (`Babies`, `Kids`, …) has no special characters, so only the family tag was affected — which is why it went unnoticed.

**Why the test didn't catch it:** the unit test built its fixture with the literal-parens form (`Families+(All+Ages)`), so it validated the parser against a string *we wrote to match the code's assumption* — not against the bytes the feed actually sends. Green test, real bug.

**The fix:** `decodeURIComponent` the audience value before the lookup (a no-op for the unparenthesized values), and add a regression test that uses the real encoded string `Families+%28All+Ages%29`.

**The lesson:** A passing unit test only proves the code matches its fixture. If the fixture is hand-authored to fit the code's assumptions rather than captured from the real source, the fixture and the code can be wrong *together*. Build parser fixtures from real captured payloads — or at minimum keep one real-sample test per source so the encoding reality is pinned.

---

---

### Decision 4 — Play Frisco LLM inference: claude-sonnet-4-6 over claude-haiku-4-5

**Date:** July 2026

**The decision:** Use claude-sonnet-4-6 (not Haiku) for Play Frisco age classification at ingest time.

**The reasoning:** The full Play Frisco backlog (~80 events) costs approximately $0.05 to classify with Haiku and $0.08 with Sonnet — a $0.03 difference on the first run. Subsequent ingest runs cost less than a cent on either model since only new or changed events are re-inferred (typically 2–5 events per day). At this cost profile the difference is operationally irrelevant, making accuracy the deciding factor.

Sonnet's classification quality is meaningfully better on ambiguous event descriptions — exactly where the confidence tier distinction (high vs. medium vs. low) matters most. A borderline event miscalled as "high confidence" when it should be "medium" means surfacing an inferred age badge with false confidence, which undermines the trust framework the product is built on. The `~` prefix and disclosure tooltip only work if the confidence tiers are accurate.

**Rule applied:** When cost difference is trivial, optimize for quality.

**The lesson:** Model selection isn't just about task complexity — it's about where errors are most costly. The confidence tier output is load-bearing UI logic, not just metadata. That's where Sonnet earns the $0.03.

---

### Decision 5 — LLM inference architecture: shared function over HTTP endpoint chain

**Date:** July 2026

**The decision:** Extract the Claude API call for Play Frisco age inference into `src/lib/age-inference.ts` as a shared function, called directly from the ingest route. A separate `/api/infer-age` endpoint also exists but wraps the same function — it does not sit between ingest and Claude.

**What the spec originally said:** Create `/api/infer-age` as a POST endpoint and call it from ingest. This would mean ingest makes an HTTP POST to its own server, which then calls Claude.

**Why we changed it:** Ingest calling its own server over HTTP is an unnecessary round-trip. Both the caller (ingest) and the callee (`/api/infer-age`) live in the same process on the same machine during local runs. The HTTP hop adds latency and a failure surface with no benefit.

**What we built instead:**
```
src/lib/age-inference.ts        ← Claude API call lives here as a pure function
src/app/api/infer-age/route.ts  ← thin wrapper for standalone testing via curl
src/app/api/ingest/route.ts     ← imports and calls age-inference.ts directly
```

The `/api/infer-age` endpoint still exists and is fully testable — you can hit it with curl without running a full ingest. But ingest doesn't go through it. Same pattern as `age-parsers.ts`, which is shared between ingest and the unit test suite.

**The lesson:** Avoid making a service call to yourself when you can import a function. HTTP is the right boundary between independent services — not between two routes in the same Next.js app.

---

---

### Decision 6 — Inference prompt refinement: "family" is mutually exclusive with specific age buckets

**Date:** July 2026

**The decision:** Rewrote the Play Frisco classification prompt so the model tags EITHER a specific age group (when an age is explicitly stated) OR "family" (when it's all-ages) — never both. Also recalibrated the confidence tiers so "high" includes events that clearly use family/child/youth language, not only events with an explicit age.

**Why it was needed:** The first prompt let the model return redundant combinations like `["family", "toddler", "kids"]`. Because "family" already surfaces an event under every age chip (its range is 0–17), the extra specific buckets were dead weight for filtering — and worse, adding "family" to a narrow young-kids event (e.g. Walnut Wednesdays) silently widened it to also appear under the Teens filter, overriding the intended scope. The model was also defaulting soft-signal-but-clearly-child-friendly events to "medium" when "high" was the right call.

**The rule now enforced (prompt-level):**
- Explicit age stated → tag only that specific group; do not add "family".
- No explicit age but clearly family/child-oriented → "family" only; don't infer specific groups from activity type.
- Confidence "high" = explicit age range OR clear family/child/youth language.

Enforcement is prompt-only — no deterministic post-processing was added, to keep the model as the single source of classification truth. The validated test table (spec Section 4) was updated to match: 7 of 8 events are now `family` / `high`, with the one explicit-age event (Painting Dreamscapes, 16+) as `teen` / `high`.

**Cache caveat:** Ingest infers new events only, so existing Play Frisco rows keep their prior inference until re-inferred. To apply the new prompt to the current backlog, clear the inference columns for `play-frisco` rows (or delete the rows) and re-run ingest.

**Provenance note:** The original Section-4 test values were drafted in a chat session and contained inaccuracies (redundant multi-bucket tags, inconsistent confidence tiers). This decision supersedes them with a rule-consistent baseline.

**The lesson:** When an LLM's structured output feeds deterministic downstream logic, the output schema needs rules that make redundant or contradictory combinations impossible — otherwise the model's "helpful extra detail" quietly changes product behavior.

---

---

## Regression Test Checklist

*Run these after every significant code change. Covers the full user flow across all three sources.*

---

### 1. Ingest sanity (run locally after any ingest change)

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/ingest" `
  -Method POST -TimeoutSec 600 `
  -Headers @{ Authorization = "Bearer YOUR_CRON_SECRET" }
```

- [ ] Returns 200 with a JSON summary (events ingested per source, any errors)
- [ ] Frisco Library: events have `age_min` / `age_max` populated (not null) for most events
- [ ] Plano Libraries: events have `age_min` / `age_max` populated for all events
- [ ] Play Frisco: events have `kid_relevant`, `age_buckets`, `age_confidence` populated (post-inference build)
- [ ] No duplicate events in Supabase (check by running ingest twice, count should not increase)

---

### 2. Events API (run after any change to `/api/events`)

```powershell
# All events
Invoke-WebRequest "http://localhost:3000/api/events" | ConvertFrom-Json | Select-Object -Expand events | Measure-Object

# Frisco Library only
Invoke-WebRequest "http://localhost:3000/api/events?source=frisco-library" | ConvertFrom-Json | Select-Object -Expand events | Measure-Object

# Age filter — Kids 6-12
Invoke-WebRequest "http://localhost:3000/api/events?age=6-12" | ConvertFrom-Json | Select-Object -Expand events | Select-Object title, age_min, age_max

# Plano + branch filter
Invoke-WebRequest "http://localhost:3000/api/events?source=plano-library&branch=haggard" | ConvertFrom-Json | Select-Object -Expand events | Measure-Object
```

- [ ] All events returns > 0 results
- [ ] `age=6-12` returns no events where `age_max < 6` or `age_min > 12`
- [ ] `age=6-12` DOES return events with `age_min=0, age_max=17` (All Ages / Family overlap)
- [ ] No adult-only events appear (age_min >= 18)
- [ ] Play Frisco events with `kid_relevant=false` never appear (post-inference build)

---

### 3. UI smoke test (run the dev server, check in browser)

```powershell
npm run dev
```

Open `http://localhost:3000` and verify:

**Default state**
- [ ] Event list loads with events from all three sources
- [ ] Date range pre-populated to today → today+7 (post v1.1 build)
- [ ] Event count shown above list

**Frisco tab (post v1.1 build)**
- [ ] Frisco tab active by default, gold accent visible
- [ ] Shows only Frisco Library + Play Frisco events
- [ ] Age chips (Toddlers / Kids / Teens) visible in sub-filter
- [ ] Selecting "Kids (6–12)" hides toddler-only and teen-only events
- [ ] Family/All Ages events remain visible under any age chip
- [ ] Play Frisco events with `kid_relevant=false` never appear

**Plano tab (post v1.1 build)**
- [ ] Switching to Plano tab shows blue accent
- [ ] Shows only Plano Libraries events
- [ ] Branch chips visible (Harrington, Haggard, Schimelpfenig, Davis, Memorial)
- [ ] Selecting a branch filters to that branch only
- [ ] Age chips work correctly against Communico structured data

**Event cards**
- [ ] Age badge visible on cards where age data exists (gold for structured, blue+~ for inferred)
- [ ] Recurring badge (`↻ Recurring`) visible on recurring events only
- [ ] Free / Paid / Reg. badges correct
- [ ] No age badge on events with no age data

**Event detail**
- [ ] Opens on card click (desktop: right panel; mobile: full screen)
- [ ] Supervision badge correct for Frisco Library events
- [ ] Inferred age badge shows disclosure text for Play Frisco events
- [ ] Add to Google Calendar, Apple Calendar, Get Directions all present
- [ ] Attending toggle increments/decrements count

**Map**
- [ ] Map toggle shows venue pins
- [ ] Get Directions from detail opens map panel

---

### 4. Unit tests (run after any change to parsing or inference logic)

```powershell
npm test
```

- [ ] All 25 existing tests pass (`parseFriscoSuitableFor`, `parseCommunicoAgeGroup`)
- [ ] All inference tests pass (post v1.1 build — `inferPlayFriscoEvent`, renamed from `inferPlayFriscoAge` in v1.2 when price classification was folded in)

---

### 5. Age inference spot check (post v1.1 build only)

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/infer-age" -Method POST `
  -ContentType "application/json" `
  -Body '{"title":"Toddler Storytime","description":"Songs and stories for children ages 0-3 and their caregivers."}'
```

- [ ] Returns `kid_relevant: true`
- [ ] Returns `age_buckets: ["toddler"]`
- [ ] Returns `confidence: "high"`

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/infer-age" -Method POST `
  -ContentType "application/json" `
  -Body '{"title":"Senior Fitness Class","description":"Low-impact exercise for adults 55 and older."}'
```

- [ ] Returns `kid_relevant: false`
- [ ] Returns `age_buckets: []`

---

*This checklist will be updated as new features are added.*

---

## v1.1 — City Nav, LLM Age Inference, Badges, Multi-Select Filters, Testing & CI/CD

*Date: July 2026. Consolidated record for the v1.1 release.*

### a) Challenges

**Functional challenges**
- **"Family" label ambiguity.** Deciding when an event is labeled "Family" — only from an explicit source signal (Plano's "Families (All Ages)" tag) or LLM-inferred family (Play Frisco), *never* derived from a numeric age span. Confirmed vs. inferred needed distinct visual treatment (gold vs. indigo `~ Family ✦`).
- **What belongs at scan level vs. detail.** Structured age ranges added clutter on cards without aiding the open/skip decision, so they were removed from cards (detail-only); only Family + the inference marker + Free/Paid/Reg/Recurring remain.
- **Price without a source of truth.** Play Frisco has no structured price. Detecting free/paid from prose is genuinely ambiguous; decided never to show an extracted amount (send users to the event page) and never to default to "free" (a wrong "Free" is the worst outcome).
- **Inference accuracy variance.** LLM confidence tiers aren't perfectly reproducible (2/8 validated events came back medium vs. an expected high) — acceptable because the tier only gates badge visibility, not correctness.

**Technical challenges**
- **Communico URL-encoded parentheses.** The real feed sends `Families+%28All+Ages%29`; the parser keyed on literal parens and silently dropped every family tag.
- **Adult-range bleed.** "Kids + Adults" resolved to a numeric `6–99`, which spuriously overlapped the Teens (13–17) band. Fixed by excluding adult audiences from the kid-facing range.
- **Substring keyword false-positives.** `parsePriceFromText` matched `"fee"` inside `"feeling"` → false "Paid" (e.g. History of Play 2026).
- **Vercel 10s function timeout.** Full ingest (~1,800 detail-page fetches + LLM calls) can't run on Vercel — ingest is run locally against the shared Supabase.
- **Non-interactive git auth.** `git push` from the tool shell fails (HTTPS password auth deprecated, no interactive credential flow).
- **Playwright browser dependency in the pre-push hook.** E2E needs the browser binary installed; a missing/mismatched `chrome-headless-shell` blocked the push. *Resolved:* E2E is now CI-only; `pre-push` runs typecheck + unit instead.
- **Jest discovering Playwright specs.** Fixed by scoping Jest to `roots: ['<rootDir>/src']`.
- **Supabase outage mid-work** — external dependency; blocked DB writes until it recovered.

### b) Lessons learned

**Functional**
- **Don't guess where a wrong answer is costly.** For price, "unknown / no badge → check the event" beats a wrong "Free." Asymmetric-cost outcomes should bias toward the honest non-answer.
- **LLM > keyword heuristics for extracting structured facts from messy free-text** (age relevance, price). Keyword lists are a losing maintenance game (every new keyword risks a new false positive).
- **Honest beats precise.** Disclose inference (`~ … ✦` + "estimated from description"); don't assert exact prices or over-confident tiers.
- **Simplify to decision-relevant signals.** A card badge earns its place only if it changes the open/skip decision *and* has no filter equivalent.

**Technical**
- **Test fixtures must be captured from real payloads, not hand-authored to match the code's assumptions.** The encoded-parens bug hid behind a fixture written with literal parens — a green test over a real bug.
- **Keyword matching needs word boundaries** (`\bfees?\b`, require a digit after "cost").
- **Keep pure logic in `src/lib` and thin the UI** — `getAgeBadge`/`cardAgeBadge`/`detailAgeBadge`, `passesAgeFilter`, `markRecurring` are all pure and unit-tested; components just call them.
- **When LLM output feeds deterministic logic, the schema needs rules that make redundant/contradictory combos impossible** (mutual-exclusivity of `family` vs. specific buckets).
- **Local pre-push E2E is fragile** (browser dependency); CI is the reliable place for E2E. *(Applied: E2E moved to CI-only; pre-push now runs typecheck + unit.)*

### c) CI strategy

- **GitHub Actions** (`.github/workflows/ci.yml`), triggered on **push and pull_request**.
- **Two jobs:** `unit` (`npm ci` → `typecheck` → `jest`, 68 tests) and `e2e` (`playwright install --with-deps chromium` → `test:e2e`, browsers installed in CI).
- **Local git hooks** (`core.hooksPath=.githooks`, auto-wired by the `prepare` npm script): `pre-commit` = typecheck + unit (fast); `pre-push` = typecheck + unit (browser-free safety net). E2E is **CI-only** — it depended on a locally-installed Playwright browser and would block a push when `chrome-headless-shell` was missing/mismatched, so it was dropped from `pre-push`.
- **Test layers:** unit (Jest, pure logic) → E2E (Playwright, all `/api` mocked, deterministic) → manual scenario docs (live ingest, LLM accuracy, map).

### d) CD strategy

- **Vercel is connected to GitHub and auto-deploys from `master`.** Push to `master` → Vercel runs `next build` → production swap. Branch/PR pushes → preview deploys.
- **Instant Rollback** in the Vercel dashboard is the safety net.
- **Data vs. code are decoupled:** the app reads Supabase live; local and production share the same DB. Running ingest locally updates production data immediately without a deploy. Code changes go live only via a push to `master`.
- **Env vars on Vercel:** Supabase URL/anon/service, Google Maps key, `CRON_SECRET`; `ANTHROPIC_API_KEY` only needed if `/api/infer-age` is called in prod (ingest is local, so not required for the user-facing path).
- **Production build verified clean** (`npm run build`) before deploy.

### e) Pending test cases

- ~~**Price parser:** extract `parsePriceFromText` to `src/lib` and add tests with false-positive fixtures.~~ **Done (v1.2)** — logic in `src/lib/price.ts`, tested in `src/lib/price.test.ts` (`detectPriceSignal` never trips on `"feeling"`/`"coffee"`; whole-word paid keywords).
- ~~**Price-via-LLM (when built):** 3-way `free / paid / unknown`.~~ **Done (v1.2) — free-by-default, six-layer risk model, Definition A display.** Price rides the Play Frisco inference call (`inferPlayFriscoEvent`), which returns `price` + `price_confidence` + `price_reasoning`. Free-by-default (no paid signal ⇒ free) with six layers guarding the sole failure mode (paid slipping through as free): (1) **torn ⇒ unknown** (revised from "tie-break to paid" — unknown guards wrong-free *and* avoids wrong-paid); (2) structurally-paid keywords (camp/class/clinic/…) + no signal ⇒ unknown; (3) `registration_required` + no signal ⇒ unknown; (4) **Definition A** display — since CivicPlus has no structured fee field, *every* Play Frisco price is an LLM read, so `getPriceBadge` marks both free and paid with the `✦` (`Free ✦` / `Paid ✦`); library stays plain `Free`; (5) raw `price_class`/`price_confidence`/`price_reasoning` stored separately (reversible without re-ingest; `price_confidence` still powers the dashboard "free by assumption" metric even though it no longer drives the `✦`); (6) growing calibration set (`src/lib/__fixtures__/price-calibration.ts`) — deterministic tier in CI, real-LLM tier via `npm run calibrate:price`. Detail view shows ONE combined age+price disclosure line (`src/lib/inference-disclosure.ts`, 8 scenarios); cards show a single `Estimated from description` hover tooltip on `✦`. Both LLM and keyword-fallback paths run through one `resolvePriceClass()`. `is_free` nullable + derived (migration `003`). **Structured `Cost:` field override (v1.2.1):** ingest now scrapes the CivicPlus `itemprop="price"` field (~11% of events) — when present it's AUTHORITATIVE (confirmed free/paid), overrides the LLM/Layers, and renders a plain `Free`/`Paid` with NO `✦` (**Option A** — `✦` marks only inferred prices); fixes the "Learn to Fish (Cost: Free)" class. `interpretCostField()` maps `Free`→free, `$35`/`Paid`→paid. Paid-keyword additions (**Option 2**): only unambiguous phrases (`purchase a ticket`, `tickets on sale`). Calibration set grown with 5 real events (`price-calibration.ts`) + 2 documented known-gaps. Verified live: extraction + interpretation correct on real pages. Pending: user runs migration `003`, re-ingests, and runs `npm run calibrate:price`.
- ~~**Pre-push hook:** cover/redesign so a missing Playwright browser doesn't block a push (move E2E to CI-only).~~ **Done** — E2E is CI-only; `pre-push` now runs typecheck + unit.
- **Analytics — GA4 instrumentation + measurement framework (v1.2 Part 1) — Done (not the dashboards yet).** GA4 base tag wired via `next/script` in `layout.tsx` (env `NEXT_PUBLIC_GA_MEASUREMENT_ID`, no-ops when absent); `src/lib/analytics.ts` `trackEvent()` helper; all **7 spec events** fired at their points (`filter_applied`, `event_card_click`, `detail_view`, `directions_tap`, `calendar_add` ×google/ics, `attending_tap` toggle-on-only, `share_tap`), each carrying `source` + `event_id`. **Measurement framework** `src/lib/measurement.ts` (pure): `weeklyActiveDiscoverers` (WAD), `computeFunnel` (cumulative most-advanced-step, channel-segmentable), sub-metrics, KPIs, `returnVisitRate`, `referral`, `topEvents` — tested against a fabricated fixture stream (`__fixtures__/measurement-fixtures.ts`, `measurement.test.ts`). **Verified live in-browser**: gtag loads (config `G-MBPV3X42LK`), `event_card_click`+`detail_view` fire into `dataLayer` with correct params. Acquisition = GA4 channel segmentation (auto from `session_start`); GSC search-funnel panel deferred to the SEO phase. **Still pending:** Technical dashboard (needs an `ingest_runs` table), Functional dashboard UI + live GA4 read (needs the Data API/BigQuery credential, #3), and one week of data validation.
- **Manual scenario doc** for the price feature once shipped (new versioned `functional-test-scenarios-vX.md`).

### f) Technical design details

- **LLM age inference** — `src/lib/age-inference.ts`, model `claude-sonnet-4-6`, called at ingest for **new Play Frisco events only** (cached in DB; re-ingest reuses stored inference). Returns `kid_relevant`, `age_buckets`, `confidence`, `reasoning`. Mutual-exclusivity prompt rule: explicit age → specific bucket only; no explicit age but clearly child/family → `family` only.
- **Badge system** — `getAgeBadge(event)` returns one of 5 kinds (`structured-specific`, `structured-multi`, `confirmed-family`, `inferred-family`, `inferred-specific`); `cardAgeBadge`/`detailAgeBadge` are pure render helpers so the card and detail render different subsets from one source of truth.
- **Family signal** — carried uniformly as `age_buckets = ['family']` for both Plano (explicit Communico tag, detected by `communicoIsFamily`) and Play Frisco (LLM); never derived from a numeric span.
- **Age filtering** — `src/lib/age-filter.ts` `passesAgeFilter(event, ranges[])`, multi-select OR across selected chips; library events overlap-match, Play Frisco events match by inferred bucket + confidence gate.
- **Recurring** — `src/lib/recurring.ts` `markRecurring(events)`, source-scoped title repetition.
- **Data model** — added columns `kid_relevant boolean`, `age_buckets text[]`, `age_confidence text`, `age_reasoning text` (migration `002`); v1.2 added `is_free` nullable + `price_class`/`price_confidence`/`price_reasoning` (migration `003`); `ingest_runs` table (migration `004`).

**v1.2 — Technical dashboard** (`/dashboard`, server-rendered):
- **Architecture** — server component reads live Supabase via the service-role client (server-side only; `ingest_runs` is only ever touched by the service role — the ingest write and this dashboard read — never the anon key). *(Correction: this originally claimed `ingest_runs` "has RLS on"; it did not — migration 004 created it without RLS. RLS was actually enabled later in migration 006 — see the RLS entries below.)* All metric logic is pure functions in `src/lib/technical-metrics.ts` (fixture-tested).
- **Ingest instrumentation** — `POST /api/ingest` writes one `ingest_runs` row per run (timing, per-source fetched, upserted, `llm_calls`, `llm_cost_usd`, status, errors). Best-effort — logging failure never fails the ingest. Status: `err` if `total_upserted = 0`, else `warn` if any errors, else `ok`.
- **Counts via exact `COUNT` queries** — a plain PostgREST `.select()` caps at **1000 rows** (this caused an early "Play Frisco 0 / Total 1000" bug); fixed by using `{ count: 'exact', head: true }` per predicate. Only the small Play Frisco set is fetched in full for the visibility buckets.
- **Metrics** — `perSourceCounts` (+ free/paid/unknown), `inferredAgeVisibility` (4 buckets), `inferredPriceVisibility` (5 buckets: free/paid × confirmed-Cost-field/inferred-`✦`, + unknown; the `Free ✦` inferred count = "free by assumption" exposure), `lastIngest`, `ingestHistory` (14-day worst-status-per-day), `llmCost` (last/cumulative/calls). Cost = `llm_calls × PER_INFERENCE_COST_USD` ($0.006/call estimate).
- **Data caveat** — DB counts ≠ ingest-log counts: log = scraped-this-run (pre-dedup), counts = total DB rows; libraries accumulate (not purged), Play Frisco is purged to the current batch (so its two numbers match). LLM caching: a re-ingest of already-cached events makes 0 calls → $0.00 last run.

**v1.2 — Analytics instrumentation + measurement framework** — GA4 base tag (`next/script`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`), `src/lib/analytics.ts` `trackEvent()`, and all **7 custom events** fired at their points (`filter_applied` with `city`+`fields`, `event_card_click`, `detail_view`, `directions_tap`, `calendar_add` with `method`, `attending_tap` toggle-on only, `share_tap`) — each carrying `source`+`event_id`; `detail_view` fires from the page's single instance (EventDetail double-renders). Pure metric logic in `src/lib/measurement.ts` over `AnalyticsRow[]`: `weeklyActiveDiscoverers` (WAD), `computeFunnel` (cumulative most-advanced-step, channel-segmentable, sub-metrics under **Engaged**/Intent/Converted), `conversionActionBreakdown` (Google / Apple-ICS / Attending), `filterUsage` (by field + city), `returnVisitRate`, `referral`, `topEvents`. Acquisition = GA4 channel segmentation; GSC search-funnel panel deferred to the SEO phase.

**v1.2 — Functional dashboard (GA4 → BigQuery)** — `src/lib/bigquery.ts`: `@google-cloud/bigquery` client from `GCP_SA_KEY_B64` (base64 service-account JSON in env; SA `openeventz-dashboard-reader` with *BigQuery Data Viewer* + *Job User*). Queries `open-eventz.analytics_546304403.events_*` (last 90 days), flattens `event_params` (ga_session_id, event_id, method, fields, city) + `traffic_source.medium` → `AnalyticsRow[]`; pure `mapBqRow` (tested); graceful `no-key`/`no-data` states. Feeds the `measurement.ts` functions; top-event names joined from Supabase. GA4→BigQuery **Daily** export (~24h lag; free — streaming would need billing). So the Functional tab refreshes ~daily; the Technical tab reflects the last (manual) ingest; both re-query live on each browser refresh (`force-dynamic`, no auto-poll).

**v1.2 — Unified tabbed dashboard** — `/dashboard` is one page with **Functional | Technical** tabs (branded header, charts), built from a prototype (`02-product/open-eventz-dashboards_12.html`): server `page.tsx` fetches Supabase + BigQuery and computes all metrics, client `DashboardTabs.tsx` renders. `/dashboard/functional` redirects here. Kept OUR price model (Definition A + inferred-free-vs-paid tile); dropped the prototype's old Free/Paid/Unknown-only price section, per-source-status table, stale-removed count, and North Star target. Deployed to Vercel; verified live (dashboards + GA4 firing + price badges in prod).

### g) Build-log status

This section *is* the v1.1 build-log update. Prior related entries: Decision 4 (Sonnet over Haiku), Decision 5 (shared inference function over HTTP chain), Decision 6 (mutual-exclusivity prompt rule), Learning 4 (fixture-didn't-match-reality parser bug).

---

## SEO Foundation — Per-Event Pages, Event JSON-LD, City Pages, Sitemap/Robots, Consent

*Date: July 2026. Full concept + functional + technical design lives in **[`SEO-DESIGN.md`](./SEO-DESIGN.md)** — this is the concise log entry.*

### What we built & why
The app was a single client-rendered page — invisible to crawlers at the event level (one URL, one static `<title>`, events only in a JS-driven detail panel). The gating decision was **per-event indexable URLs**; everything else depends on it. Shipped the full foundation **plus** city landing pages and a consent banner (both PM-confirmed in scope):

- **Per-event pages** `src/app/events/[id]/page.tsx` — React Server Component, `generateMetadata` (title/description/canonical/OG/Twitter), `notFound()` on a missing id, `robots: noindex` for non-indexable rows, `revalidate = 3600`. Content is fully server-rendered (the opposite of the `'use client'` home page — that's the point: crawlable HTML).
- **Event JSON-LD** `src/lib/event-jsonld.ts` (pure) — schema.org/Event: name, start/end, Offline attendance, canonical `url`, `organizer`, HTML-stripped description, `image`, `location` (Place + `geo`), `typicalAgeRange`, price fields (see decision below). Highest-leverage surface — makes each event eligible for Google's Event rich card.
- **City landing pages** `/frisco`, `/plano` — shared `src/components/CityLanding.tsx` (server): keyword-relevant intro + server-rendered event list + **ItemList** JSON-LD. Catch the broad local queries; event pages catch the long-tail.
- **Sitemap + robots** `src/app/sitemap.ts` (home + 2 city + all upcoming indexable events, hourly ISR) and `src/app/robots.ts` (allow `/`, disallow `/api/` + `/dashboard`, link sitemap).
- **Consistency gate** `src/lib/seo-indexable.ts` (pure, **no Supabase import** so it's unit-testable): `isIndexableEvent` mirrors the app's list gates (not-kid-relevant Play Frisco, `age_min ≥ 18`, Frisco adult-keyword list, past one-offs). Sitemap, city pages, and per-event `noindex` all call the one gate — they can never disagree. Supabase access split into `src/lib/seo-data.ts` (`getEventById`, `getIndexableEvents`).
- **Consent Mode v2** — `layout.tsx` now sets `metadataBase`, a `title.template` (`%s | Open Eventz`), and an inline `gtag('consent','default',{analytics_storage:'denied'})` **before** the GA `config`; `src/components/ConsentBanner.tsx` (client) + `updateConsent`/`CONSENT_KEY` in `analytics.ts` flip consent on accept and remember it in `localStorage`. GA still runs cookieless when denied — the standard compliant pattern.

### Decision — price in structured data (supersedes the scoping-doc rule)
Emit the **free** signal whenever the app treats an event as free — **both confirmed AND inferred "Free ✦"** (`is_free === true` → `isAccessibleForFree: true` + `$0` Offer). Paid → `isAccessibleForFree: false`, no Offer (no numeric price stored). Unknown → price omitted. **Policy-safe** because the event page **visibly** shows the same "Free ✦" badge, so the markup matches the visible page (Google's requirement). The residual guessed-free risk is the accepted trade-off; reversible via one condition (`price_confidence === 'confirmed'`) — no re-ingest. This overrides the earlier "only emit price when confirmed" line in `02-product/open-eventz-seo-scoping.md`.

### Verification
Typecheck + `next build` clean (14 routes). **+28 unit tests → 216 total, green** (`event-jsonld.test.ts`, `seo-indexable.test.ts`, `site.test.ts`). Live (local dev, DOM-level): `/frisco` = 275 events + ItemList JSON-LD w/ canonical URLs; inferred-free event page = valid Event JSON-LD `isAccessibleForFree: true` + `$0` offer + visible "Free ✦"; paid event = `false`/no-offer; `robots.txt` correct; `sitemap.xml` = 721 URLs; consent banner shows, default `denied`.

### Deployment + Google Search Console (done, 2026-07-23)
**Deployed:** `da37b54` (foundation) + `de46100` (GSC HTML verification file) pushed to `master` → Vercel auto-built → live. Verified on prod: `/sitemap.xml` 200/`application/xml`/721 URLs, `/robots.txt` 200, `/frisco` 200, event JSON-LD valid. **GSC:** URL-prefix property `https://open-eventz.vercel.app` (Domain property N/A — no DNS control over `vercel.app`); **verified via HTML file** `public/google8c83c891625775ad.html` (served at root by `public/`; **must stay** or the property un-verifies); **sitemap `sitemap.xml` submitted.**

**Ops notes:** "Couldn't fetch" immediately after submitting is Google's normal async placeholder (blank "Last read"), resolves in hours-to-a-day — don't delete/resubmit; the dynamic sitemap's cold-start first-fetch can time out once then succeed on the ISR-cached retry. URL Inspection "Request Indexing"/"Test Live URL" share a small per-property daily quota ("Quota Exceeded" is Google-side) — optional nudges, NOT required (the sitemap is the discovery mechanism). Monitor: Pages (indexing, days) → Enhancements→Events (rich-result eligibility, after first crawl) → Performance (queries/impressions/clicks, ~1–3 weeks; feeds the future dashboard GSC panel).

### Still open / optional
Set `NEXT_PUBLIC_SITE_URL` on Vercel only if the prod domain ever changes from the default. Later: GSC search-funnel panel on the dashboard. Optional: rewire in-app event cards to `/events/[id]` (today they open the in-app panel).

### How to talk about it
*"The app was invisible to search at the event level. I gave every event its own server-rendered indexable URL, layered schema.org Event structured data on top — the highest-leverage move, because it makes each event eligible for Google's rich card — added city landing pages for broad local queries, and a dynamic sitemap. One pure, unit-tested gate decides what's indexable, so the sitemap and pages can't disagree. The one judgement call was price: we assert 'free' for confirmed and inferred-free alike, which is safe because the page visibly shows the same badge — and it's a one-line reversal."*

---

## Add to Apple Calendar — text/calendar route (iOS fix)

*Date: July 2026. Deployed (`ef6837d`, `859ea80`).*

### The problem
On iPhone, "Add to Apple Calendar" was a dead end. The button built the `.ics` as a client-side **Blob** and triggered it with an `<a download>`; iOS treats a blob download as a *file*, so it routed to the Files/Share sheet — where **Calendar isn't a share target**, so the user could never actually add the event.

### The fix — serve it from a real URL as `text/calendar`
- **New route `GET /api/ics/[eventId]`** (`src/app/api/ics/[eventId]/route.ts`): fetches the event (`getEventById`) and returns the ICS with `Content-Type: text/calendar; charset=utf-8` and `Content-Disposition: inline`. Because it's a real URL of a recognized calendar type (not a blob download), **iOS opens it straight into the Add-to-Calendar screen**. A 404 is returned for unknown ids.
- **`src/lib/ics.ts`** (pure, extracted from the old inline builder): `buildIcs(event)` + `icsFilename(event)`. Hardened with **RFC 5545 TEXT escaping** (backslash, semicolon, comma, newlines — the old builder only escaped newlines, so any comma in a title/location like "…Library, Frisco" would have corrupted the field) and a `DTSTAMP`. Unit-tested (`ics.test.ts`, 8 cases; `dtstamp` injectable for determinism).
- **EventDetail**: the button became an `<a href="/api/ics/[id]">` (analytics `calendar_add` / method `ics` preserved).

### Follow-up — same-tab open
First cut used `target="_blank"`, which on iOS opened the `.ics` in a **new tab** and left a stray `about:blank` tab after the Add sheet closed. Removed it → **same-tab**: iOS shows the Add overlay without navigating the app away (no leftover tab), and desktop just downloads the `.ics` (a non-displayable type, so the page doesn't navigate either). Verified end-to-end on a real iPhone.

### The lesson
An `<a download>` on a `blob:` URL and a link to a real `text/calendar` URL are handled very differently by iOS — the former is a file (→ Files/Share, no Calendar), the latter is a calendar document (→ Add-to-Calendar). For "add to calendar" links, serve a real URL with the right content type; don't generate the file client-side. And avoid `target="_blank"` for it, or iOS leaves an orphan tab.

---

## Nav — logo/title resets to home

*Date: 2026-07-23.*

The header logo/title (desktop top bar **and** the mobile detail-view header) now performs a **full reset to the home state** — city → Frisco, all filters cleared, any open event closed, map off — the universal "click the logo to start over" affordance. Kept **distinct** from the mobile "‹ Back" button, which returns to the *current filtered* list: two different intents (Back = "return to my list"; logo = "start over"). The logos became real `<button>`s with aria-labels. Verified end-to-end in production (dirtied state → one logo click → home).

---

## Row Level Security (RLS) hardening — migration `005`

*Date: 2026-07-23. Migration `supabase/migrations/005_enable_rls.sql`.*

**The problem.** Supabase's linter flagged three **Critical** "RLS Disabled in Public" advisories on `events`, `like_counts`, and `supervision_policies`. These tables are reachable through PostgREST with the **anon key**, which is public by design (it ships in the site's client bundle). With RLS off, anyone holding it could read *and write* those tables directly, bypassing the app.

**The fix (least privilege).** Traced how the app touches each table, then enabled RLS with the minimum policy each needs:
- **events** — read by the anon key (events/venues/branches APIs + the SEO data layer). Enable RLS + a `SELECT`-only policy for `anon`. Writes (ingest) use the service-role key, which **bypasses RLS**, so they still work; anon cannot write.
- **like_counts** — read/written **only** via the service role (`/api/likes`). Enable RLS with **no** anon policy → fully locked to the public; the server is unaffected.
- **supervision_policies** — not queried by the app today. Enable RLS, no policy (locked). Add a `SELECT` policy later only if it's ever read client-side.

**Verified after applying (production):** `/api/events` (1000), `/api/venues` (7), `/sitemap.xml` (721), `/api/likes/*` (200), `/dashboard` (200) all still work. The RLS change is user-applied in the Supabase SQL Editor (DB security is not changed from code); `005` is the record.

**The lesson.** RLS state is independent of GitHub repo visibility — the anon key is already public via the deployed site, so "wide-open tables" is a live risk regardless of whether the source is public. Enable RLS on every PostgREST-exposed table and grant the anon role only what the client genuinely needs (usually read-only, often nothing).

### Migration `006` — the table `005` missed (`ingest_runs`)

*Date: 2026-07-26. Migration `supabase/migrations/006_enable_rls_ingest_runs.sql`.*

Supabase re-flagged a Critical `rls_disabled_in_public` advisory *after* `005`. Root cause: `005` only covered the three tables the linter had flagged at that time (events, like_counts, supervision_policies); **`ingest_runs` (created in `004`) was never RLS-enabled** — and an earlier note in this log wrongly implied it was (now corrected above). `ingest_runs` is written by the ingest route and read by `/dashboard`, both via the service role, so the fix mirrors `like_counts`: **enable RLS, no policy** → locked to the public, service role bypasses, app unaffected. **The lesson (again): the RLS sweep must cover *every* PostgREST-exposed table, not just the ones a single linter run happened to list — re-run the advisor after any migration that adds a table.**

---

## CI fix — Jest config to plain JS (undeclared `ts-node`)

*Date: 2026-07-26.*

**The failure.** The CI "Type-check & unit tests" job was **red on every push** (E2E + doc-parity were green). `jest.config.ts` is a TypeScript config, which Jest parses via `ts-node` — but `ts-node` was never a declared dependency, so CI's clean `npm ci` didn't install it and Jest died before running a single test (`Cannot find package 'ts-node'`). It passed **locally** (and in the pre-commit/pre-push hooks) only because the local `node_modules` happened to have `ts-node` — a classic works-on-my-machine gap, and proof that **a green local hook is not a green CI**.

**The fix.** Converted both Jest configs to plain JS (`jest.config.js`, `jest.calibration.config.js`) so nothing needs to compile the config file; updated the `calibrate:price` script to the `.js` path. `ts-jest` (the preset) still compiles the TypeScript *test* files — only the config format changed. 224 unit tests still pass; the calibration config validated via `--listTests` (no LLM call). No new dependency added.

**The lesson.** Design away (or declare) every dependency the CI environment needs, and verify against a *clean* environment — not a local `node_modules` that has accumulated transitive packages. A `.ts` config quietly requires `ts-node`; a `.js` config requires nothing.

---

## Security — gated `/api/infer-age` before going public

*Date: 2026-07-26.*

`/api/infer-age` (a thin wrapper over the Play Frisco inference function, kept for curl/regression testing — *not* in the ingest→Claude path) was **unauthenticated** and calls the **paid Claude API** — an open **cost-DoS vector** on the live deployment: anyone could script POSTs to run up the Anthropic bill. Gated it behind the same `CRON_SECRET` bearer token as `/api/ingest` (401 without it). This vector existed **regardless of GitHub visibility** — it's a property of the live app, not the source — but it was fixed before making the code public, which lowers the bar to discover it. **Companion recommendation: rotate `CRON_SECRET` to a strong random value**, since the public source now shows the bearer-token scheme and the old value follows a guessable pattern.

**The lesson.** Before making source public, audit every endpoint that costs money or writes data for auth — public code doesn't create the vulnerability, but it removes the obscurity that was accidentally hiding it. Security-through-obscurity is not security; the endpoint has to actually be gated.

---

## Test-scenario consolidation + doc↔test parity CI check

*Date: 2026-07-23.*

**Why.** Functional test scenarios had fragmented into three versioned docs (`02-product/functional-test-scenarios{,-v1.1-badges-filters,-v1.2-price-analytics}.md`), and the "covered by" links between a scenario and its test were prose maintained by hand — nothing stopped them drifting as code changed.

**What we did.**
- **Consolidated** all three into a single `06-app/TEST-SCENARIOS.md` (newest-wins, no duplication; tags `[A]`/`[R]`/`[M]` preserved). It lives in the **app repo** (next to the tests) so a CI job can verify it. Each `[A]` row names its covering test file inline. Added a **Zone 3** section backfilling scenarios that were automated but previously undocumented (SEO/JSON-LD, calendar/ICS, BigQuery). The three originals are archived under `02-product/*_archived.md`, with a pointer left at `02-product/functional-test-scenarios.md`.
- **`doc-parity` CI job** (`scripts/check-doc-parity.mjs`, wired into `ci.yml` as a third job + `npm run test:docs`). It parses every `[A]` row, extracts the named test file, and fails CI if any no longer exists (or if an `[A]` row names none). First run: **66 `[A]` references, all present.**
- Also corrected a stale scenario during the merge: base §6.4.2 ("Apple Calendar downloads a file") → now "opens the `/api/ics` `text/calendar` route" (`ics.test.ts`).

**The lesson.** A test plan that claims coverage is only trustworthy if something enforces the claim. Co-locating the doc with the tests and adding a tiny parity check turns "we think this is covered" into "CI proves the named test still exists."

---

## CI result capture + observability posture

*Date: 2026-07-23.*

**Test results are now captured per run** (previously ephemeral — console + Actions logs only). `ci.yml` now:
- runs unit tests with **coverage** (`--coverage`, currently **~96% lines / 94% statements**) and uploads the HTML + lcov report as a `coverage` artifact (30-day retention);
- uploads the **Playwright HTML report** (+ `test-results/`) as an artifact;
- writes a **per-job summary** (`$GITHUB_STEP_SUMMARY`) so each run shows type-check / unit / e2e / doc-parity outcomes at a glance;
- a **CI status badge** is surfaced in the PM-repo README once the repo is public.

**Observability — what's captured vs. the gap.** Persistent traces already exist for the two things that matter most operationally: the **ingest pipeline** (`ingest_runs` table, migration `004` — per-run timing, per-source counts, LLM calls + cost, status, errors → Technical dashboard) and **product usage** (GA4 → BigQuery → Functional dashboard). The gap is **production application-error tracking**: API-route exceptions currently live only in Vercel's ephemeral function logs. **Next step: Sentry** (`@sentry/nextjs`) — deferred because it needs a user-created Sentry project + DSN (a secret, stored in Vercel env, never in the repo). Scaffolding will land once the DSN exists.

**The lesson.** "Tests pass" is only credible if the evidence is retrievable after the run. Uploading coverage + reports as artifacts and surfacing a per-run summary turns a green checkmark into an auditable record — and the honest observability story separates *what we already trace* (pipeline, usage) from *what's still a gap* (app errors).

---

## Nav — event cards are shareable links; Share uses the event's own page

*Date: 2026-07-31.*

Connected the in-app browsing UX to the SEO per-event pages so a shareable link is reachable from anywhere, **without** sacrificing the list/panel/map flow:
- **`EventCard` is now an `<a href="/events/[id]">`** (was a `<button>`). A plain left-click still `preventDefault()`s and opens the in-app detail panel (unchanged UX); **modifier / middle / right-click fall through** to native link behavior, so a user can open the event's own page in a new tab or copy its link. This also adds real internal links from the list into the indexable event pages.
- **The detail Share button now shares `/events/[id]`** (via `eventUrl(event.id)`) instead of `event.event_url` (the original source page) — so sharing from the app produces *our* shareable, indexable event page.

Verified on production: cards render as anchors, plain left-click opens the panel with no navigation, and Share copies the `open-eventz.vercel.app/events/…` URL.

**The lesson.** To make a client-app view shareable without turning every click into a full navigation, make the element a real link and enhance the left-click (`preventDefault` → in-app view) while letting modifier-clicks pass through — you get SEO internal-linking, right-click "copy link", and open-in-new-tab for free, and the app UX is untouched.
