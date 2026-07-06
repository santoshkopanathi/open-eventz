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

*This log will be updated as each phase is completed.*
