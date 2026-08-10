# Open Eventz — SEO Design (Concept, Functional & Technical)

*Date: July 2026. Status: **shipped — deployed to production and submitted to Google Search Console**. Written for a technical PM — concept first, then functional design, then technical design, then the decisions and how to talk about them.*

---

## 1. Concept — why SEO, and the one decision that gated everything

### Why SEO is the right acquisition engine for this product
Open Eventz is a **local, time-sensitive, event-discovery** product for parents in Frisco/Plano. That is almost a best-case SEO profile, because it sits at the intersection of two high-intent search behaviours:

- **Local search** — "free kids events in Frisco this weekend", "plano library storytime", "toddler activities near me".
- **Event-specific search** — someone who already knows an event name ("Walnut Wednesdays Frisco Heritage Center").

Google also runs a dedicated **Events experience** in Search: well-marked events can surface as a visual card (date, place, price) *above* the normal blue links, and in the "events near me" box. For an events product this is the single highest-leverage channel — and it is unlocked purely by structured data.

SEO is the **acquisition** engine that feeds the top of the funnel the analytics work measures. The two are complementary: analytics measures the funnel; SEO fills it.

### The problem we started from
The app was a **single client-rendered page**. Functionally:
- One URL (`/`), one static `<title>` for the whole app.
- Events were fetched in the browser via `useEffect → /api/events` and shown in a **client-side detail panel** — there was no URL per event and no server-rendered event content.
- To a crawler, the site was **one page with an empty shell**: no per-event content, no per-event metadata, no sitemap, no robots file.

So there was nothing for Google to index or rank at the event level. A parent googling a specific event would never find us.

### The gating decision: per-event indexable URLs
Search engines rank **pages**, and Event rich results need a **canonical page per event**. Everything else (structured data, per-page titles, sitemap) depends on this existing first. So the foundational decision was:

> Introduce real server-rendered routes — one indexable page per event — while keeping the existing list/panel app UX untouched for in-app browsing.

**Scope chosen for this build (all confirmed with the PM):**
1. Per-event pages `/events/[id]` — the gate.
2. Event JSON-LD (schema.org/Event) — highest leverage.
3. Per-page metadata (title, description, canonical, OpenGraph/Twitter).
4. Dynamic `sitemap.xml` + `robots.txt`.
5. City landing pages `/frisco`, `/plano` — for the broad local queries.
6. Cookie-consent banner (GA4 Consent Mode v2) — chosen to build now, not defer.

---

## 2. Functional design — what changes, for whom

The key mental model: **SEO work is mostly new URLs and invisible `<head>` data, not edits to the existing app screen.** The in-app experience (list + detail panel + map) is deliberately unchanged. What we added is a set of **crawlable surfaces** that live alongside the app.

### Before vs. after

| | Before | After |
|---|---|---|
| Addresses Google can see | 1 (`/`) | ~720 (home + 2 city pages + every upcoming event) |
| Event content in HTML | none (JS-only) | each event fully **server-rendered** |
| Title/description | one static tag | **unique per event and per city page** |
| Rich-result eligibility | none | every event emits **Event JSON-LD** |
| Sitemap / robots | none | **dynamic sitemap** + robots rules |

### The two-layer acquisition model
- **Event pages** (`/events/[id]`, ~718 of them) catch the **long-tail**: specific event-name and very-specific searches. Many pages, each a small trickle, each ranking on *its own* words.
- **City pages** (`/frisco`, `/plano`) catch the **high-volume broad** queries ("free kids events in Frisco this weekend"). One strong, ever-fresh page aimed at each city.

Each page carries its own title, description, body text and structured data, so pages compete in **different** searches independently — that is the "separate URL, separately indexed" property in practice.

### What each new surface does
- **`/events/[id]`** — a clean, standalone event page: title (H1), date/time (Central Time), location, hosted-by, price/age/recurring badges, the estimate disclosure line, registration notice, full description, and action links (original event page, Add to Google Calendar, Get directions, back to the city page). Fully functional without JavaScript. Also emits the Event JSON-LD.
- **`/frisco`, `/plano`** — a headline ("Free Kids Events in Frisco, TX"), a keyword-relevant intro paragraph, and a server-rendered list of upcoming events (each linking to its event page), plus **ItemList** JSON-LD so Google can read it as a curated list.
- **`/sitemap.xml`** — home + both city pages + every upcoming, indexable event, regenerated hourly.
- **`/robots.txt`** — allow everything except `/api/` and `/dashboard`; points crawlers at the sitemap.
- **Consent banner** — a bottom bar on the app (only when GA is configured) letting the user accept/decline analytics cookies; remembered in `localStorage`.

### Honest scope notes (what this does *not* do)
- **Indexing is Google's call, not ours.** We made every page eligible and well-marked; ranking still depends on competition, freshness, and Google's crawl schedule (days-to-weeks after submission). SEO is a slow-burn channel.
- **Time-sensitivity is real.** A one-off event that has already passed is auto-`noindex`'d and drops from the sitemap. The durable long-tail value concentrates in **recurring** events and the **always-fresh city pages**.
- **The in-app event cards still open the in-app panel** — they were *not* rewired to navigate to `/events/[id]`. That was intentional (keeps the app UX identical). Linking cards to the new pages is a small optional follow-up.

---

## 3. Technical design — how it's built

### Rendering model
All new surfaces are **React Server Components** (App Router), so their HTML — including event content and metadata — is produced **on the server** and is present in the initial response a crawler sees. This is the opposite of the existing `'use client'` home page, and it's the whole point: crawlable HTML.

- Event pages: `export const revalidate = 3600` (ISR) — server-rendered on demand, cached an hour.
- City pages & sitemap: also `revalidate = 3600` — regenerated hourly so fresh events appear and stale ones drop **without a redeploy**.
- Metadata is produced by `generateMetadata` (event pages) or a static `metadata` export (city pages), so titles/canonical/OG are in the server HTML.

> This is a customised Next.js 16.2.9 (App Router). Per `AGENTS.md`, the routing/metadata/sitemap conventions were read from `node_modules/next/dist/docs/` before writing code — `params` is an async `Promise`, `generateMetadata` is Server-Component-only, `sitemap.ts`/`robots.ts` return `MetadataRoute.*`, and `metadataBase` resolves relative canonical/OG URLs.

### File map (what each file is responsible for)

| File | Kind | Responsibility |
|---|---|---|
| `src/lib/site.ts` | pure | Canonical origin (`SITE_URL`, override via `NEXT_PUBLIC_SITE_URL`) and URL/label helpers: `eventUrl`, `cityUrl`, `sourceOrg`, `sourceCity`. |
| `src/lib/event-jsonld.ts` | pure | `buildEventJsonLd(event)` → a schema.org/Event object ready to serialise. The highest-leverage surface. |
| `src/lib/seo-indexable.ts` | pure | `isIndexableEvent(event, todayIso)` + `startOfTodayCtIso()` + `CITY_SOURCES`. The single definition of "what may be indexed." **No I/O**, so it's unit-testable and shared. |
| `src/lib/seo-data.ts` | server | Supabase access: `getEventById(id)`, `getIndexableEvents(city?)`. Applies the pure gate. |
| `src/app/events/[id]/page.tsx` | server route | The per-event page + `generateMetadata` + JSON-LD script; `notFound()` on a missing id; `noindex` on non-indexable rows. |
| `src/components/CityLanding.tsx` | server | Shared city-page component: intro copy, event list, ItemList JSON-LD. |
| `src/app/frisco/page.tsx`, `src/app/plano/page.tsx` | server routes | Thin wrappers rendering `CityLanding` + each city's `metadata`. |
| `src/app/sitemap.ts` | server route | `MetadataRoute.Sitemap`: home + city pages + all upcoming indexable events. |
| `src/app/robots.ts` | server route | `MetadataRoute.Robots`: allow `/`, disallow `/api/` + `/dashboard`, link the sitemap. |
| `src/components/ConsentBanner.tsx` | client | Consent Mode v2 UI; writes the choice to `localStorage`, calls `updateConsent`. |
| `src/app/layout.tsx` | modified | Added `metadataBase`, a `title.template` (`%s \| Open Eventz`), the Consent Mode **default-denied** script, and renders `ConsentBanner`. |
| `src/lib/analytics.ts` | modified | Added `updateConsent(granted)` + `CONSENT_KEY` for the banner. |

### The Event JSON-LD (highest leverage)
`buildEventJsonLd` emits a schema.org/Event with: `name`, `startDate`/`endDate`, `eventAttendanceMode: Offline`, `eventStatus: Scheduled`, canonical `url` (our page, not the source), `organizer` (the library / Play Frisco), `description` (HTML-stripped), `image` (thumbnail if present), `location` (Place + address + `geo` when we have coordinates), `typicalAgeRange` (from structured ages or inferred buckets), and the price fields (see §4). It's a **pure function**, so it's unit-tested and can never silently diverge from what the page renders.

### The consistency guarantee (why the sitemap and pages never disagree)
`isIndexableEvent` is the **one** gate, and it mirrors the app's own list filters: it excludes not-kid-relevant Play Frisco events, adults-only programs (`age_min ≥ 18`), Frisco Library's mislabeled adult programs (keyword list), and **past** one-off events. The sitemap, the city pages, and the per-event `noindex` decision all call the same function, so a URL is never listed in the sitemap that the page would `noindex`, and vice-versa. Keeping it I/O-free (`seo-indexable.ts`, no Supabase import) is what lets it be unit-tested like the rest of `src/lib`.

### Consent Mode v2 (privacy)
GA4 loads with `analytics_storage` **defaulted to `denied`** via an inline `gtag('consent','default',…)` in `layout.tsx` that runs *before* the GA `config` call. Nothing is stored until the user accepts. `ConsentBanner` reads/writes the choice in `localStorage`, calls `updateConsent(true|false)` to flip Consent Mode, and re-applies a prior grant on each load (the default is denied every load). Analytics still functions in cookieless mode when denied — the standard, compliant GA4 pattern.

---

## 4. The price-in-structured-data decision (2026-07-23)

**Context.** schema.org/Event has optional price fields (`offers`, `isAccessibleForFree`). When generating the markup we must decide whether to assert a price. The product already distinguishes **confirmed** price (libraries; the CivicPlus `Cost:` field; explicit text) from **inferred** "Free ✦" (Play Frisco free-by-default) via `price_confidence`.

**The decision (PM call).** Emit the **free signal whenever the app treats the event as free — for BOTH confirmed and inferred-free** (i.e. whenever `is_free === true`): `isAccessibleForFree: true` + a `$0` `Offer`. This *supersedes* the SEO-scoping doc's earlier "only emit price when confirmed" rule.

| App state (`is_free`) | JSON-LD emitted |
|---|---|
| `true` (confirmed **or** inferred "Free ✦") | `isAccessibleForFree: true` + `$0` Offer |
| `false` (paid) | `isAccessibleForFree: false`, **no** Offer (we store no numeric price) |
| `null` (unknown) | price fields **omitted entirely** |

**Why it stays within Google's policy.** Google's structured-data policy requires the markup to **match the visible page**. The event page **visibly renders the same "Free ✦" badge** (verified in-browser), so the JSON-LD reflects what the page shows — not a hidden claim. The residual product risk (a guessed-free event that's actually paid) is the trade-off the PM chose to accept; it is **fully reversible** by tightening one condition (`price_confidence === 'confirmed'`) — no re-ingest, no data migration.

---

## 5. Testing & verification

- **Unit tests (pure logic):** `event-jsonld.test.ts` (shape + the price policy, incl. the explicit "inferred-free still asserts free" case), `seo-indexable.test.ts` (every gate + the CT "today" boundary), `site.test.ts` (URL/label helpers). **+28 tests → 216 total, all green.**
- **Typecheck + production build:** clean; `next build` lists all 14 routes including `/events/[id]` (dynamic), `/frisco`, `/plano`, `/sitemap.xml`, `/robots.txt`.
- **Live verification (local dev, DOM-level):**
  - `/frisco` renders 275 events + ItemList JSON-LD with canonical event URLs.
  - An **inferred-free** Play Frisco event page emits valid Event JSON-LD with `isAccessibleForFree: true` + `$0` offer, correct canonical/OG/robots, and **visibly** shows "Free ✦" (markup matches page).
  - A **paid** event emits `isAccessibleForFree: false` and no offer.
  - `robots.txt` correct; `sitemap.xml` returns **721 URLs** of valid XML.
  - Consent banner shows on the app; Consent Mode default = `denied`.

---

## 6. Deployment & operations

### Shipped
- **Data vs. code decoupling holds:** the SEO surfaces read live Supabase; local and production share the same DB. Pages reflect real data immediately.
- **Deployed to production (2026-07-23):** commit `da37b54` (SEO foundation) + `de46100` (Search Console HTML verification file), pushed to `master` → Vercel auto-built → live. Verified on the real domain: `/sitemap.xml` → 200, `application/xml`, **721 URLs**; `/robots.txt` → 200; `/frisco` → 200; event pages render valid Event JSON-LD.

### Google Search Console (done)
- **Property type: URL-prefix** `https://open-eventz.vercel.app` — *not* a Domain property (a Domain property needs DNS on the apex, and we don't control `vercel.app`'s DNS).
- **Ownership verified via the HTML-file method** — `public/google8c83c891625775ad.html` (served at the site root by Next's `public/`, committed in `de46100`). **This file must stay in the repo** — deleting it un-verifies the property.
- **Sitemap submitted:** `sitemap.xml`.

### Operational notes (expected Search-Console behaviour)
- **"Couldn't fetch" right after submitting a sitemap is normal, not a failure.** Google processes sitemaps **asynchronously** — a same-day submission shows a placeholder status with a blank "Last read" until Google's first pass (hours to ~a day), then flips to "Success." Our sitemap is also **dynamically generated** (queries the DB for all 721 events), so Google's very first fetch can hit a cold serverless function and time out once, then succeed on retry against the ISR-cached copy. Don't delete-and-resubmit; just wait.
- **URL Inspection → "Request Indexing" / "Test Live URL" share a small per-property daily quota** ("Quota Exceeded" is Google-side, resets ~daily). These are optional *nudges* for individual URLs — **not required for indexing**; the submitted sitemap is the real discovery mechanism.

### What to monitor (Google's clock from here)
| Report | Signal | Timeline |
|---|---|---|
| **Pages** (Indexing) | how many URLs indexed vs. excluded, and why | days |
| **Enhancements → Events** | is the Event JSON-LD valid + rich-result eligible | after first crawl |
| **Performance** | queries / impressions / clicks (the search funnel) | ~1–3 weeks |

### Still open / optional
- ~~Set `NEXT_PUBLIC_SITE_URL` on Vercel *only if* the production domain ever changes from `https://open-eventz.vercel.app`.~~ **Done (2026-08-10):** production moved to the custom domain `https://openeventz.com` — full migration record in **§8**.
- **Later:** a GSC search-funnel panel on the dashboard, once Performance data exists.
- **Optional follow-up:** rewire the in-app event cards to link to `/events/[id]` (today they open the in-app detail panel; the SEO pages are reached via direct URL / city pages / Google).

---

## 7. How to talk about it

*"The app was a single client-rendered page — invisible to search engines at the event level. The foundational SEO decision was to give every event its own server-rendered, indexable URL, while leaving the app's UX untouched. On top of that I added schema.org Event structured data — the highest-leverage move, because it makes each event eligible for Google's rich Event card — plus per-event metadata, city landing pages for the broad local queries, and a dynamic sitemap. I kept one pure, unit-tested gate deciding what's indexable, so the sitemap and the pages can never disagree. The one judgement call was price: we assert 'free' in the structured data for both confirmed and inferred-free events, which is safe because the page visibly shows the same 'Free' badge, and it's a one-line reversal if we ever want to tighten it."*

---

## 8. Custom domain migration — `openeventz.com` (2026-08-10)

*Status: DNS + Vercel + the app's canonical origin cut over to `https://openeventz.com`; Google Search Console re-setup is the remaining follow-up (below).*

### Why move off `*.vercel.app`
A shared `*.vercel.app` subdomain is **the single biggest structural SEO limitation** the project had: (1) it carries no domain authority you can build on and inherits none you can control; (2) you **cannot create a GSC *Domain* property** for it (no DNS control over `vercel.app`), only a weaker URL-prefix property; (3) it reads as less trustworthy to users. Moving now was deliberately timed — the site **is not yet ranking for competitive terms**, so there is almost no search equity at risk. Waiting only raises the future migration cost.

### DNS (Cloudflare Registrar — Approach A, records at the registrar)
The apex `openeventz.com` was registered at Cloudflare, so DNS lives in Cloudflare's dashboard (**DNS → Records**). Two records, both **"DNS only" (grey cloud), not Proxied**:

| Type | Name | Value | Proxy |
|---|---|---|---|
| `A` | `@` (apex) | `76.76.21.21` | DNS only |
| `CNAME` | `www` | `cname.vercel-dns.com` | DNS only |

**Why grey-cloud (DNS only) matters:** Vercel terminates SSL and runs the CDN/redirects. Orange-clouding (Cloudflare proxy) puts a *second* SSL/redirect layer in front, which commonly produces "too many redirects" or a cert that never issues. Cloudflare nags to enable proxying — ignore it here; Vercel already provides SSL + global CDN + DDoS protection. (Vercel also shows a soft *"DNS Change Recommended"* suggesting its newer `…vercel-dns-017.com` target; the legacy `76.76.21.21` **continues to work**, so the A record was left as-is — don't touch a working record for a cosmetic badge.)

### Vercel
- Both `openeventz.com` **and** `www.openeventz.com` added to the project (Production).
- **Canonical = apex.** `www.openeventz.com` is a **308 Permanent Redirect → `openeventz.com`** (permanent, so Google consolidates to the apex — *not* a 307/302 temporary). The "Redirect apex → www" option was deliberately left **unchecked**.
- **SSL is automatic** (Let's Encrypt, auto-renew) once DNS resolves. The `*.vercel.app` URL keeps working as the deployment address.

### The one code lever — `NEXT_PUBLIC_SITE_URL`
The whole canonical surface derives from `SITE_URL` in `src/lib/site.ts` (`process.env.NEXT_PUBLIC_SITE_URL ?? 'https://open-eventz.vercel.app'`). Setting **`NEXT_PUBLIC_SITE_URL = https://openeventz.com`** (Production, no trailing slash) repoints, in one change:
- `metadataBase` → canonical + OpenGraph/Twitter base (`layout.tsx`),
- `robots.txt` `host` + `sitemap` link (`robots.ts`),
- every `sitemap.xml` URL (`sitemap.ts`),
- every event/city/JSON-LD `url` (`eventUrl`, `cityUrl`, `buildEventJsonLd`).

**It must be a clean rebuild.** `NEXT_PUBLIC_*` is **inlined at build time**, so the existing deployment does not pick up the new value — a redeploy with the **build cache off** guarantees the new origin is baked into every bundle. (No code change was needed; the override hook already existed from the SEO foundation.)

### Google Search Console — post-cutover follow-up (TODO)
Now that we control the apex's DNS, do the stronger setup:
1. **Create a new GSC *Domain* property** for `openeventz.com` — verified by a **DNS TXT record** (add it in Cloudflare DNS). A Domain property covers apex + `www` + http/https in one.
2. **Resubmit `sitemap.xml`** under the new property (it now emits `openeventz.com` URLs).
3. **Keep the old** `https://open-eventz.vercel.app` URL-prefix property for now to watch the transition; optionally request-index `/`, `/frisco`, `/plano` on the new property.
4. **GA4 is unaffected** — same measurement ID works across domains; optionally update the data-stream URL + referral-exclusion to `openeventz.com` (cosmetic).
5. The existing `public/google…​.html` verification file can stay (harmless); the DNS Domain property is the better long-term verification.

### The lesson
A single well-placed indirection (`SITE_URL` reading one env var) turns what could be a find-and-replace across sitemap, robots, metadata, and JSON-LD into a **one-value cutover with a rebuild** — and because `NEXT_PUBLIC_*` inlines at build time, the only gotcha is remembering the redeploy must be a clean build, not a config-only save.
