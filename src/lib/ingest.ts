// Ingest implementation — extracted from the /api/ingest route so it can run as a plain
// function (no Next.js, no HTTP request, no serverless timeout). Called two ways:
//   • scripts/ingest.ts  → GitHub Actions, one job per source (runFriscoIngest/…)
//   • /api/ingest route  → local/manual combined run (runAllIngest)
// See INGEST-DESIGN.md for the full architecture.
import { XMLParser } from 'fast-xml-parser'
import { supabaseAdmin } from './supabase'
import { EventCategory, EventSource } from './types'
import { parseCommunicoAgeGroup, communicoIsFamily, mapFriscoAudienceIds } from './age-parsers'
import { inferPlayFriscoEvent } from './age-inference'
import { fallbackPriceClass, resolvePriceClass, priceClassToFields, interpretCostField } from './price'
import { PER_INFERENCE_COST_USD } from './technical-metrics'
import { markRecurring } from './recurring'
import { centralWallTimeToUtc, parseCentralWallTime } from './datetime'
import { screenBatch } from './ingest-guard'

// Adult programs that BiblioCommons incorrectly includes in children audience feeds
const FRISCO_ADULT_KEYWORDS = [
  'book club', 'write club', 'figure club', "reader's choice",
  "entrepreneur's workshop", 'esl book',
]


function guessCategory(title: string, description: string): EventCategory {
  const text = `${title} ${description}`.toLowerCase()
  if (text.match(/story|read|book|librar/)) return 'library'
  if (text.match(/art|craft|paint|draw|creat/)) return 'arts'
  if (text.match(/stem|science|tech|robot|code|maker/)) return 'stem'
  if (text.match(/sport|soccer|basket|swim|run|athlet/)) return 'sports'
  if (text.match(/music|sing|danc|choir/)) return 'music'
  if (text.match(/park|nature|outdoor|garden|trail/)) return 'parks-rec'
  return 'library'
}

function decodeHtml(str: string): string {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#\d+;/g, c => String.fromCharCode(parseInt(c.slice(2, -1))))
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAgeRange(text: string): { age_min: number | null; age_max: number | null; age_label: string | null } {
  if (!text) return { age_min: null, age_max: null, age_label: null }
  const match = text.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (match) return { age_min: parseInt(match[1]), age_max: parseInt(match[2]), age_label: text }
  const single = text.match(/(\d+)\+/)
  if (single) return { age_min: parseInt(single[1]), age_max: null, age_label: text }
  return { age_min: null, age_max: null, age_label: text }
}

// Frisco audience taxonomy (id -> name), fetched once per run from BiblioCommons' JSON API.
// The /v2 pages are client-side-rendered, so age lives here (and in each event's audience_ids),
// not in the server-rendered HTML. Content-negotiated: needs Accept: application/json.
async function fetchFriscoAudiences(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const res = await fetch('https://friscolibrary.bibliocommons.com/events/event_audiences?client_scope=events&limit=0', {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (res.ok) {
      const j: any = await res.json()
      const arr: any[] = j.audiences || j.event_audiences || j.data || (Array.isArray(j) ? j : Object.values(j)[0]) || []
      for (const a of arr) if (a?.id && (a.name || a.title)) map.set(a.id, a.name || a.title)
    }
  } catch {
    // leave empty — every event then hits the all-ages fallback, which the data-quality gate flags
  }
  return map
}

async function ingestFriscoLibrary() {
  const errors: string[] = []
  const events: any[] = []
  const seenIds = new Set<string>()
  let ageResolved = 0
  let ageFallback = 0

  // Age source (2026-08-13): the JSON API `definition.audience_ids` mapped via this taxonomy.
  // Replaces the "Suitable for:" HTML scrape, which the client-side-rendered /v2 pages left empty.
  const audienceTax = await fetchFriscoAudiences()
  if (audienceTax.size === 0) errors.push('frisco-library: audience taxonomy empty (ages may fall back to all-ages)')

  try {
    let page = 1
    let keepPaging = true

    while (keepPaging) {
      const url = `https://friscolibrary.bibliocommons.com/v2/events?page=${page}`
      const res = await fetch(url, {
        next: { revalidate: 0 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://friscolibrary.bibliocommons.com/v2/events',
        },
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const html = await res.text()

      if (!html.includes(`page=${page + 1}`)) keepPaging = false

      const cardChunks = html.split('<li><div class="cp-events-search-item">').slice(1)
      if (cardChunks.length === 0) break

      for (const card of cardChunks) {
        const linkMatch = card.match(/href="(https:\/\/friscolibrary\.bibliocommons\.com\/events\/([a-zA-Z0-9]+))"/)
        if (!linkMatch) continue
        const eventUrl = linkMatch[1]
        const eventId = linkMatch[2]

        if (seenIds.has(eventId)) continue
        seenIds.add(eventId)

        const titleMatch = card.match(/data-key="event-link">([\s\S]*?)<\/a>/)
        if (!titleMatch) continue
        const title = decodeHtml(titleMatch[1].replace(/<[^>]+>/g, '').trim())

        const monthMatch = card.match(/class="date-stamp__month"[^>]*>([^<]+)</)
        const dayMatch = card.match(/class="date-stamp__day"[^>]*>([^<]+)</)
        const yearMatch = card.match(/on ([A-Za-z]+ \d+, \d{4})/)
        const timeMatch = card.match(/class="event-time"[^>]*>([^<]+)/)

        const month = monthMatch?.[1]?.trim()
        const day = dayMatch?.[1]?.trim()
        const year = yearMatch ? yearMatch[1].split(', ')[1] : new Date().getFullYear().toString()
        const timeStr = timeMatch?.[1]?.trim()

        const rawTime = timeStr?.split('–')[0]?.trim() || ''
        const normalizedTime = rawTime.replace(/(\d+:\d+)(am|pm)/i, (_, t, p) => `${t} ${p.toUpperCase()}`)
        const dateStr = `${month} ${day}, ${year} ${normalizedTime}`.trim()
        // BiblioCommons publishes local wall-clock time with no offset. Resolve it as
        // America/Chicago, not as the runtime's timezone — a bare `new Date(dateStr)` was
        // correct on a Central dev machine but 5–6h early on the UTC Actions runner.
        const startDate = parseCentralWallTime(dateStr)
        if (!startDate || isNaN(startDate.getTime())) continue

        const locationMatch = card.match(/class="cp-event-location[^"]*"[^>]*>([^<]+)</)
        const location = locationMatch?.[1]?.trim() || 'Frisco Public Library'

        const descMatch = card.match(/class="cp-event-description[^"]*"[^>]*>([\s\S]*?)<\//)
        const teaserDescription = descMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || ''

        // Age + full description from the JSON API (the /v2 detail HTML is JS-rendered → empty).
        // Default to the all-ages (0–17) fallback; overwrite when the API resolves a real audience.
        let description = teaserDescription
        let pageAgeMin: number | null = 0
        let pageAgeMax: number | null = 17
        let pageAgeLabel: string | null = null
        let featuredImageId: string | null = null
        try {
          const apiRes = await fetch(`https://friscolibrary.bibliocommons.com/events/events/${eventId}?client_scope=events`, {
            headers: {
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          })
          if (apiRes.ok) {
            const def: any = (await apiRes.json())?.event?.definition ?? null
            if (def) {
              featuredImageId = def.featured_image_id ?? null
              const age = mapFriscoAudienceIds(Array.isArray(def.audience_ids) ? def.audience_ids : [], audienceTax)
              if (age.age_min !== null) {
                pageAgeMin = age.age_min; pageAgeMax = age.age_max; pageAgeLabel = age.age_label
                ageResolved++
              } else {
                ageFallback++ // no known audience → keep the 0–17 all-ages fallback
              }
              if (typeof def.description === 'string' && def.description.trim()) {
                description = decodeHtml(def.description.replace(/<[^>]+>/g, ' '))
              }
            } else {
              ageFallback++
            }
          } else {
            ageFallback++
          }
        } catch {
          ageFallback++ // API fetch failed — event still ingested at the all-ages fallback
        }

        // Card event image — the /v2 markup dropped the old `cp-event-image` class, so match the
        // BiblioCommons uploads image URL directly. These are category banners (Story Time, Arts,
        // ESL, …) shared across events of a type — decorative, shown only in the detail view.
        // The card HTML puts `&amp;` and raw spaces in the filename (e.g. "Arts &amp; Culture 760x230.jpg"),
        // which 404 if stored verbatim — decode the entity and percent-encode so the URL resolves.
        const rawImg = card.match(/src="(https:\/\/friscolibrary\.bibliocommons\.com\/events\/uploads\/images\/[^"]+)"/i)?.[1]
        const thumbnail = rawImg ? encodeURI(decodeHtml(rawImg)) : null

        events.push({
          id: `frisco-library-${eventId}`,
          source: 'frisco-library',
          title,
          description,
          start_datetime: startDate.toISOString(),
          end_datetime: null,
          location_name: location,
          location_address: null,
          location_lat: getFriscoVenueCoords(location).lat,
          location_lng: getFriscoVenueCoords(location).lng,
          is_free: true,
          price_text: 'Free',
          age_min: pageAgeMin,
          age_max: pageAgeMax,
          age_label: pageAgeLabel,
          is_recurring: card.includes('View all dates'),
          recurrence_label: card.includes('View all dates') ? 'Recurring' : null,
          thumbnail_url: thumbnail,
          event_url: eventUrl,
          category: guessCategory(title, description),
          registration_required: requiresRegistration(`${title} ${description}`),
          raw_json: { eventId, title, dateStr, location, featured_image_id: featuredImageId },
          ingested_at: new Date().toISOString(),
        })
      }

      page++
    }
  } catch (err: any) {
    errors.push(`frisco-library: ${err.message}`)
  }

  // Layer-2 guard: if most events couldn't resolve a real audience, the source likely changed
  // shape again — surface it as a run warning (the data-quality gate turns it into a red job).
  const ageTotal = ageResolved + ageFallback
  if (ageTotal >= 20 && ageFallback / ageTotal > 0.5) {
    errors.push(`frisco-library: age fallback rate ${Math.round((ageFallback / ageTotal) * 100)}% (${ageFallback}/${ageTotal}) — audience source may have changed`)
  }

  return { events, errors }
}

const PLANO_BRANCHES: { name: string; locationId: string; address: string; lat: number; lng: number }[] = [
  { name: 'Davis Library',         locationId: '3218', address: '7501 Independence Pkwy, Plano, TX 75025', lat: 33.0871, lng: -96.7499 },
  { name: 'Haggard Library',       locationId: '3219', address: '2501 Coit Rd, Plano, TX 75075',           lat: 33.0198, lng: -96.7234 },
  { name: 'Harrington Library',    locationId: '3220', address: '1501 18th St, Plano, TX 75074',           lat: 33.0157, lng: -96.6989 },
  { name: 'Parr Library',          locationId: '3221', address: '6200 Windhaven Pkwy, Plano, TX 75093',    lat: 33.0551, lng: -96.8235 },
  { name: 'Schimelpfenig Library', locationId: '3222', address: '5024 Custer Rd, Plano, TX 75023',         lat: 33.0635, lng: -96.7499 },
  { name: 'Virtual',               locationId: '4074', address: 'Online',                                  lat: 33.0198, lng: -96.7234 },
]

function planoFeedUrl(locationId: string): string {
  const filter = { feedType: 'rss', filters: { location: [locationId], ages: ['all'], types: ['all'], tags: [], term: '', days: 365 } }
  return `https://plano.libnet.info/feeds?data=${Buffer.from(JSON.stringify(filter)).toString('base64')}`
}

async function fetchPlanoEventAge(eventUrl: string): Promise<{ age_min: number | null; age_max: number | null; age_label: string | null; is_family: boolean }> {
  try {
    const res = await fetch(eventUrl, {
      next: { revalidate: 0 },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) return { age_min: null, age_max: null, age_label: null, is_family: false }
    const html = await res.text()
    return { ...parseCommunicoAgeGroup(html), is_family: communicoIsFamily(html) }
  } catch {
    return { age_min: null, age_max: null, age_label: null, is_family: false }
  }
}

async function ingestPlanoLibrary() {
  const errors: string[] = []
  const events: any[] = []
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

  // Deduplicate across branches — same event can appear in multiple branch feeds
  const seenIds = new Set<string>()

  for (const branch of PLANO_BRANCHES) {
   try {
    const url = planoFeedUrl(branch.locationId)
    const res = await fetch(url, {
      next: { revalidate: 0 },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenEventzBot/1.0)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const xml = await res.text()
    const parsed = parser.parse(xml)
    const items = parsed?.rss?.channel?.item
    const itemList = items ? (Array.isArray(items) ? items : [items]) : []

    for (const item of itemList) {
      const pubDate = item.pubDate || item['dc:date']
      if (!pubDate) continue

      const title = decodeHtml(item.title || '')
      const description = item.description || ''
      const link = item.link || item.guid || 'https://plano.libnet.info/events'
      const eventId = link.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || Buffer.from(title).toString('base64').slice(0, 20)

      if (seenIds.has(eventId)) continue
      seenIds.add(eventId)

      // The feed stamps `+0000` on times that are plainly LOCAL (a 9:30 AM storytime is
      // published as `09:30:00 +0000`), so the offset is ignored and the wall time is resolved
      // as America/Chicago. Previously the offset was stripped and parsed in the runtime's
      // timezone — right locally, 5–6h early on the UTC Actions runner.
      const startDate = parseCentralWallTime(pubDate)
      if (!startDate || isNaN(startDate.getTime())) continue

      // Fetch event page for authoritative age data — AGE GROUP block is present on 100% of
      // Plano events (validated across 42 events, all 5 branches), so no fallback needed
      const ageData = await fetchPlanoEventAge(link)

      // Clean RSS description — strip leading date/time line and trailing "Read on" marker
      let cleanDescription = description
        .replace(/<[^>]+>/g, '')
        .replace(/^[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2}[ap]m\s*-\s*\d{1,2}:\d{2}[ap]m\s*/i, '')
        .replace(/\s*Read on\s*$/i, '')
        .trim() || null

      events.push({
        id: `plano-library-${eventId}`,
        source: 'plano-library',
        title,
        description: cleanDescription,
        start_datetime: startDate.toISOString(),
        end_datetime: null,
        location_name: branch.name,
        location_address: branch.address,
        location_lat: branch.lat,
        location_lng: branch.lng,
        is_free: true,
        price_text: 'Free',
        age_min: ageData.age_min,
        age_max: ageData.age_max,
        age_label: ageData.age_label || null,
        // Explicit "Families (All Ages)" tag → confirmed-family signal for the badge (spec §2/§3).
        // Distinct from a 0–17 numeric range, which a non-family multi-audience event can also have.
        age_buckets: ageData.is_family ? ['family'] : null,
        is_recurring: false,
        recurrence_label: null,
        thumbnail_url: item.enclosure?.['@_url'] || null,
        event_url: link,
        category: guessCategory(title, description),
        registration_required: requiresRegistration(`${title} ${description}`),
        raw_json: item,
        ingested_at: new Date().toISOString(),
      })
    }
   } catch (err: any) {
    errors.push(`plano-library/${branch.name}: ${err.message}`)
   }
  }

  return { events, errors }
}

const FRISCO_VENUE_COORDS: Record<string, { lat: number; lng: number }> = {
  'frisco athletic center':      { lat: 33.1461, lng: -96.8097 },
  'frisco heritage center':      { lat: 33.1503, lng: -96.8276 },
  'frisco discovery center':     { lat: 33.1534, lng: -96.7855 },
  'frisco commons park':         { lat: 33.1401, lng: -96.8152 },
  'frisco public library':       { lat: 33.1429, lng: -96.8259 },
  'frisco square':               { lat: 33.1429, lng: -96.8259 },
  'george a. purefoy':           { lat: 33.1429, lng: -96.8259 },
  'toyota stadium':              { lat: 33.1548, lng: -96.8354 },
  'dr pepper ballpark':          { lat: 33.1548, lng: -96.8354 },
  'frisco isd':                  { lat: 33.1508, lng: -96.8236 },
}

function getFriscoVenueCoords(locationName: string): { lat: number; lng: number } {
  const lower = locationName.toLowerCase()
  for (const [key, coords] of Object.entries(FRISCO_VENUE_COORDS)) {
    if (lower.includes(key)) return coords
  }
  return { lat: 33.1506, lng: -96.8236 } // center of Frisco as fallback
}

// Cheap pre-filter for city-government / administrative items that are never community events,
// so we don't pay the LLM to classify obvious noise. Deliberately SHORT and multi-word (to avoid
// false positives like "Board Game Night") — the actual kid-vs-adult decision is the LLM's job
// (inferPlayFriscoEvent), which generalises without per-source keyword upkeep. See BUILD-LOG
// "Play Frisco classifier: LLM-primary".
const PARKS_REC_EXCLUDE_KEYWORDS = [
  'city council', 'council meeting', 'commission meeting', 'board meeting',
  'board of', 'work session', 'advisory board', 'advisory committee',
  'planning commission', 'coffee with the mayor', 'coffee with mayor',
]

// CID=85 (Cultural Affairs) + CID=81 (Parks & Rec) — same combined URL the city uses
const PLAY_FRISCO_CALENDAR = 'https://www.friscotexas.gov/calendar.aspx?view=list&CID=85,81&showPastEvents=false'

const REGISTRATION_KEYWORDS = [
  'register', 'registration', 'sign up', 'sign-up', 'signup',
  'reserve your spot', 'reserve a spot', 'limited space', 'limited seats',
  'limited enrollment', 'space is limited', 'seats are limited',
  'rsvp', 'enroll', 'enrollment', 'ticket', 'pre-register',
]

function requiresRegistration(text: string): boolean {
  const lower = text.toLowerCase()
  return REGISTRATION_KEYWORDS.some(kw => lower.includes(kw))
}

async function ingestPlayFrisco() {
  const errors: string[] = []
  const events: any[] = []

  // Horizon: include events up to ~6 months out. Was 1 month, which hid most CID=85/81
  // (Cultural Affairs / Parks & Rec) events since those are often scheduled a few months ahead.
  const horizon = new Date()
  horizon.setMonth(horizon.getMonth() + 6)

  // Collect EIDs from the current month + the next ~6 months of calendar pages
  const eids = new Set<string>()
  const now = new Date()

  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const month = d.getMonth() + 1
    const year = d.getFullYear()
    try {
      const res = await fetch(`${PLAY_FRISCO_CALENDAR}&month=${month}&year=${year}`, {
        next: { revalidate: 0 },
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenEventzBot/1.0)' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()

      for (const m of html.matchAll(/EID=(\d+)/gi)) eids.add(m[1])
    } catch (err: any) {
      errors.push(`play-frisco calendar month +${i}: ${err.message}`)
    }
  }

  // Fetch each event detail page

  for (const eid of eids) {
    try {
      const url = `https://www.friscotexas.gov/Calendar.aspx?EID=${eid}&view=detail`
      const res = await fetch(url, {
        next: { revalidate: 0 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      })
      if (!res.ok) { errors.push(`play-frisco EID ${eid}: HTTP ${res.status}`); continue }
      const html = await res.text()

      // Title — use <title> tag; CivicPlus format is "Calendar • Event Name | City of Frisco"
      const pageTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const rawTitle = pageTitleMatch ? decodeHtml(pageTitleMatch[1]) : ''
      // Strip "Calendar • " prefix then strip " | City of Frisco" suffix
      const title = rawTitle.replace(/^Calendar\s*[•·]\s*/i, '').split(/\s*\|\s*/)[0].trim()
      if (!title) continue

      // Skip non-kid events
      if (PARKS_REC_EXCLUDE_KEYWORDS.some(kw => title.toLowerCase().includes(kw))) continue

      // Start datetime — CivicPlus puts date as text content of a hidden div with itemprop="startDate"
      const startMatch = html.match(/itemprop="startDate"[^>]*>([^<]+)<\//i)
      // No startDate → not a real event page (low EIDs like 1/37/58 are calendar nav links that
      // the EID regex also catches). Skip silently; a real parser break shows up as a bulk drop
      // the data-quality gate would catch, not as per-EID noise that marks every run 'warn'.
      if (!startMatch) continue
      // CivicPlus emits an offset-less local time (`2026-08-15T08:00:00`) → resolve as
      // America/Chicago, not as the runtime's timezone (5–6h early on the UTC Actions runner).
      const startWall = startMatch[1].trim()
      const startDate = parseCentralWallTime(startWall)
      if (!startDate || isNaN(startDate.getTime()) || startDate > horizon) continue

      // End datetime — CivicPlus has no endDate itemprop; parse from "Time:" detail block
      const endMatch = html.match(/itemprop="endDate"[^>]*>([^<]+)<\//i)
      let endDate: Date | null = endMatch ? parseCentralWallTime(endMatch[1]) : null
      if (!endDate) {
        const timeBlockMatch = html.match(/specificDetailHeader[^>]*>\s*Time:[\s\S]{0,100}?specificDetailItem[^>]*>([\s\S]*?)<\/div>/i)
        if (timeBlockMatch) {
          const timeText = timeBlockMatch[1].replace(/&thinsp;/g, ' ').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim()
          const endTimeMatch = timeText.match(/[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/i)
          if (endTimeMatch) {
            const endTimeStr = endTimeMatch[1].trim()
            const [timePart, meridiem] = endTimeStr.split(/\s+/)
            const [hrs, mins] = timePart.split(':').map(Number)
            const hours24 = meridiem.toUpperCase() === 'PM' && hrs !== 12 ? hrs + 12 : (meridiem.toUpperCase() === 'AM' && hrs === 12 ? 0 : hrs)
            // Same Central calendar day as the start (taken from the raw wall string, not from
            // startDate — `setHours` would apply the runtime's timezone, not the venue's).
            endDate = parseCentralWallTime(`${startWall.slice(0, 10)} ${String(hours24).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`)
          }
        }
      }

      // Location — try CivicPlus specificDetail "Location:" block first, then itemprop fallback
      const locationDetailMatch = html.match(/specificDetailHeader[^>]*>\s*Location:[\s\S]{0,50}?specificDetailItem[^>]*>([\s\S]*?)<\/div>/i)
      const locationItempropMatch = html.match(/itemprop="location"[\s\S]{0,1000}?itemprop="name"[^>]*>([\s\S]*?)<\//i)
      const locationFromDetail = locationDetailMatch
        ? decodeHtml(locationDetailMatch[1].replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '').replace(/<[^>]+>/g, '').trim())
        : ''
      const locationFromItemprop = locationItempropMatch
        ? decodeHtml(locationItempropMatch[1].replace(/<[^>]+>/g, '').trim())
        : ''
      const location = locationFromDetail || locationFromItemprop || 'Frisco Parks & Recreation'

      // Description — itemprop="description" class="fr-view"
      let description = ''
      const descStart = html.indexOf('itemprop="description" class="fr-view"')
      if (descStart > -1) {
        const descBlock = html.slice(descStart, descStart + 5000)
        const paragraphs: string[] = []
        const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/g
        let pMatch
        while ((pMatch = pRegex.exec(descBlock)) !== null) {
          const t = decodeHtml(pMatch[1].replace(/<[^>]+>/g, ''))
          if (t && !t.startsWith('http') && t.length > 10) paragraphs.push(t)
        }
        description = paragraphs.join('\n\n')
      }

      const registration_required = requiresRegistration(`${title} ${description}`)

      // Structured Cost: field (CivicPlus itemprop="price"). When present it is AUTHORITATIVE
      // — a source-confirmed price the LLM never sees — so it wins over the description pipeline
      // and locks the price (the LLM pass will not override it).
      const priceFieldMatch = html.match(/itemprop="price"[^>]*>([\s\S]*?)<\/div>/i)
      const rawCost = priceFieldMatch ? decodeHtml(priceFieldMatch[1].replace(/<[^>]+>/g, '').trim()) : null
      const costFieldClass = interpretCostField(rawCost)

      // Price: Cost field (confirmed) if present, else the keyword FALLBACK (used only if the
      // LLM call later fails; the LLM pass in POST overwrites the fallback for new events).
      const priceLocked = costFieldClass !== null
      const resolved = priceLocked
        ? { price_class: costFieldClass!, price_confidence: 'confirmed' as const }
        : fallbackPriceClass({ title, description, registration_required })
      const priceFields = priceClassToFields(resolved.price_class)

      // Event image — CivicPlus exposes it as og:image on the detail page. A real per-event image
      // lives under /ImageRepository/Document; events WITHOUT one fall back to a generic calendar
      // icon (/Images/SocialMedia/IconModuleCalendar.png), which we drop so we never show a boring
      // placeholder as a hero. Hotlinked, detail-view only, graceful when absent.
      const ogRaw = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] ?? null
      const ogImage = ogRaw && /ImageRepository\/Document/i.test(ogRaw) ? ogRaw : null

      events.push({
        id: `play-frisco-${eid}`,
        source: 'play-frisco',
        title,
        description: description || null,
        start_datetime: startDate.toISOString(),
        end_datetime: endDate?.toISOString() ?? null,
        location_name: location,
        location_address: null,
        location_lat: getFriscoVenueCoords(location).lat,
        location_lng: getFriscoVenueCoords(location).lng,
        is_free: priceFields.is_free,
        price_text: priceFields.price_text,
        price_class: resolved.price_class,
        price_confidence: resolved.price_confidence,
        price_reasoning: priceLocked ? `Cost field: "${rawCost}"` : null, // LLM sets this otherwise
        _priceLocked: priceLocked, // transient (not a DB column): tells the LLM pass to keep this price
        age_min: null,
        age_max: null,
        age_label: null,
        // Populated by the LLM inference pass in POST (new events only)
        kid_relevant: null,
        age_buckets: null,
        age_confidence: null,
        age_reasoning: null,
        is_recurring: false,
        recurrence_label: null,
        thumbnail_url: ogImage,
        event_url: url,
        category: guessCategory(title, description),
        registration_required,
        raw_json: { eid, title, start: startMatch[1], location },
        ingested_at: new Date().toISOString(),
      })
    } catch (err: any) {
      errors.push(`play-frisco EID ${eid}: ${err.message}`)
    }
  }

  return { events, errors }
}


// ---------------------------------------------------------------------------
// Per-source runners — each scrapes ONE source, upserts it, runs that source's own
// cleanup/purge, and records its own ingest_runs row. Independent by design so one
// source failing or stalling never blocks the others (GitHub Actions runs one job per
// source). IDs are namespaced `{source}-{id}`, so per-source dedup + per-source upsert
// is equivalent to the old single combined pass.
// ---------------------------------------------------------------------------

export interface SourceIngestResult {
  source: EventSource
  fetched: number
  upserted: number
  llm_calls: number
  errors: string[]
}

// Merge events sharing an id (same event across audience feeds / branches): widen the age
// range, never override an adult (18) floor. Identical to the original combined dedup pass.
function dedupeMerge(events: any[]): any[] {
  const map = new Map<string, any>()
  for (const e of events) {
    const existing = map.get(e.id)
    if (existing) {
      if (existing.age_min !== 18 && e.age_min !== null && e.age_max !== null) {
        existing.age_min = Math.min(existing.age_min ?? e.age_min, e.age_min)
        existing.age_max = Math.max(existing.age_max ?? e.age_max, e.age_max)
      }
    } else {
      map.set(e.id, { ...e })
    }
  }
  return Array.from(map.values())
}

// One ingest_runs row per source run. The Technical dashboard reads these as an array
// (lastIngest/ingestHistory/llmCost tolerate multiple rows) and gets per-source counts from
// the events table, so one row per source is safe. Best-effort — never fails the ingest.
async function recordRun(
  db: ReturnType<typeof supabaseAdmin>,
  o: { frisco?: number; plano?: number; playFrisco?: number; upserted: number; llmCalls?: number; errors: string[]; t0: number },
): Promise<void> {
  const status = o.upserted === 0 ? 'err' : o.errors.length > 0 ? 'warn' : 'ok'
  const { error } = await db.from('ingest_runs').insert({
    ran_at: new Date().toISOString(),
    duration_ms: Date.now() - o.t0,
    status,
    frisco_fetched: o.frisco ?? 0,
    plano_fetched: o.plano ?? 0,
    play_frisco_fetched: o.playFrisco ?? 0,
    total_upserted: o.upserted,
    llm_calls: o.llmCalls ?? 0,
    llm_cost_usd: Number(((o.llmCalls ?? 0) * PER_INFERENCE_COST_USD).toFixed(4)),
    errors: o.errors,
  })
  if (error) o.errors.push(`ingest_runs insert: ${error.message}`)
}

/**
 * The ONLY way this module writes events. Screens a scraped batch against what is already
 * stored and refuses to publish anything it can't vouch for.
 *
 * Product rule: a wrong event time is worse than a missing event. So individually-bad events
 * are dropped, and a systemically-bad batch is rejected wholesale — leaving the previously
 * stored (correct) rows in place rather than overwriting them. Callers MUST also skip their
 * purge/cleanup steps when `aborted` is true, or a rejected batch would still delete rows.
 *
 * Escape hatch: INGEST_ALLOW_TIME_SHIFT=1 permits an intended mass time correction (e.g. the
 * re-ingest that fixes a timezone bug). Explicit by design — never the default.
 */
async function guardedUpsert(
  db: ReturnType<typeof supabaseAdmin>,
  source: EventSource,
  events: any[],
  errors: string[],
): Promise<{ upserted: number; aborted: boolean; dropped: number }> {
  if (events.length === 0) return { upserted: 0, aborted: false, dropped: 0 }

  const { data: stored, error: readErr } = await db
    .from('events')
    .select('id,start_datetime')
    .eq('source', source)
  if (readErr) {
    // Can't compare against the current state → refuse rather than write blind.
    errors.push(`guard (${source}): could not read stored events (${readErr.message}) — refusing to write`)
    return { upserted: 0, aborted: true, dropped: 0 }
  }

  const decision = screenBatch(events, stored ?? [], {
    allowTimeShift: process.env.INGEST_ALLOW_TIME_SHIFT === '1',
  })
  for (const r of decision.reasons) {
    console.warn(`[ingest] guard (${source}): ${r}`)
    errors.push(`guard (${source}): ${r}`)
  }

  if (decision.abort) {
    console.error(`[ingest] guard (${source}): BATCH REJECTED — ${stored?.length ?? 0} stored events left untouched`)
    return { upserted: 0, aborted: true, dropped: decision.dropped.length }
  }

  const { error } = await db.from('events').upsert(decision.write, { onConflict: 'id' })
  if (error) {
    errors.push(`db upsert (${source}): ${error.message}`)
    return { upserted: 0, aborted: true, dropped: decision.dropped.length }
  }
  return { upserted: decision.write.length, aborted: false, dropped: decision.dropped.length }
}

export async function runFriscoIngest(): Promise<SourceIngestResult> {
  const db = supabaseAdmin()
  const errors: string[] = []
  const t0 = Date.now()

  const frisco = await ingestFriscoLibrary()
  errors.push(...frisco.errors)

  const events = dedupeMerge(frisco.events)
  markRecurring(events)

  const { upserted, aborted } = await guardedUpsert(db, 'frisco-library', events, errors)

  // Remove Frisco Library adult programs mislabeled under children audience feeds.
  // Skipped when the batch was rejected — cleanup must not act on data we refused to trust.
  if (!aborted) {
    for (const kw of FRISCO_ADULT_KEYWORDS) {
      const { error } = await db.from('events').delete().eq('source', 'frisco-library').ilike('title', `%${kw}%`)
      if (error) errors.push(`cleanup-frisco-adult/${kw}: ${error.message}`)
    }
  }

  await recordRun(db, { frisco: frisco.events.length, upserted, errors, t0 })
  return { source: 'frisco-library', fetched: frisco.events.length, upserted, llm_calls: 0, errors }
}

export async function runPlanoIngest(): Promise<SourceIngestResult> {
  const db = supabaseAdmin()
  const errors: string[] = []
  const t0 = Date.now()

  const plano = await ingestPlanoLibrary()
  errors.push(...plano.errors)

  const events = dedupeMerge(plano.events)
  markRecurring(events)

  const { upserted } = await guardedUpsert(db, 'plano-library', events, errors)

  await recordRun(db, { plano: plano.events.length, upserted, errors, t0 })
  return { source: 'plano-library', fetched: plano.events.length, upserted, llm_calls: 0, errors }
}

export async function runPlayFriscoIngest(): Promise<SourceIngestResult> {
  const db = supabaseAdmin()
  const errors: string[] = []
  const t0 = Date.now()

  const playFrisco = await ingestPlayFrisco()
  errors.push(...playFrisco.errors)

  // LLM-primary classification (age + price), fail-closed — the shared helper (also used by Kaleidoscope).
  const llmCalls = await classifyEvents(db, 'play-frisco', playFrisco.events)

  const events = dedupeMerge(playFrisco.events)
  markRecurring(events)

  const { upserted, aborted } = await guardedUpsert(db, 'play-frisco', events, errors)

  // Cleanup + purge are skipped when the batch was rejected: deleting "everything not in this
  // batch" against a batch we refused to trust would wipe good rows.
  if (!aborted) {
    // Remove Play Frisco events matching exclusion keywords (stale records from before the filter)
    for (const kw of PARKS_REC_EXCLUDE_KEYWORDS) {
      const { error } = await db.from('events').delete().eq('source', 'play-frisco').ilike('title', `%${kw}%`)
      if (error) errors.push(`cleanup/${kw}: ${error.message}`)
    }

    // Purge stale Play Frisco records — delete any play-frisco event not in this batch
    if (playFrisco.events.length > 0) {
      const currentIds = playFrisco.events.map((e: any) => e.id)
      const { error } = await db.from('events').delete().eq('source', 'play-frisco').not('id', 'in', `(${currentIds.join(',')})`)
      if (error) errors.push(`purge-stale-play-frisco: ${error.message}`)
    }
  }

  await recordRun(db, { playFrisco: playFrisco.events.length, upserted, llmCalls, errors, t0 })
  return { source: 'play-frisco', fetched: playFrisco.events.length, upserted, llm_calls: llmCalls, errors }
}

// Combined run — all sources sequentially. Used by the /api/ingest route for local/manual runs;
// the scheduled path runs each source as its own GitHub Actions job.
export async function runAllIngest(): Promise<{
  ok: boolean
  upserted: number
  counts: { frisco_library: number; plano_library: number; play_frisco: number; kaleidoscope_park: number }
  errors: string[]
}> {
  const frisco = await runFriscoIngest()
  const plano = await runPlanoIngest()
  const playFrisco = await runPlayFriscoIngest()
  const kaleidoscope = await runKaleidoscopeIngest()
  return {
    ok: true,
    upserted: frisco.upserted + plano.upserted + playFrisco.upserted + kaleidoscope.upserted,
    counts: {
      frisco_library: frisco.fetched,
      plano_library: plano.fetched,
      play_frisco: playFrisco.fetched,
      kaleidoscope_park: kaleidoscope.fetched,
    },
    errors: [...frisco.errors, ...plano.errors, ...playFrisco.errors, ...kaleidoscope.errors],
  }
}

// ---------------------------------------------------------------------------
// Shared LLM classifier pass — LLM-primary + fail-closed. Used by every source whose events
// carry no structured age (Play Frisco, Kaleidoscope Park). Cached per event (a re-ingest of
// known events makes 0 calls). Low-confidence or explicitly-adult events are hidden
// (`kid_relevant=false`). Returns the number of Claude calls made. See SOURCE-ONBOARDING.md.
// ---------------------------------------------------------------------------
async function classifyEvents(db: ReturnType<typeof supabaseAdmin>, source: EventSource, events: any[]): Promise<number> {
  if (events.length === 0) return 0
  let llmCalls = 0
  const ids = events.map((e: any) => e.id)
  const { data: priorRows } = await db
    .from('events')
    .select('id, kid_relevant, age_buckets, age_confidence, age_reasoning, is_free, price_text, price_class, price_confidence, price_reasoning')
    .eq('source', source)
    .in('id', ids)
  const priorMap = new Map<string, any>((priorRows ?? []).map((r: any) => [r.id, r]))

  for (const e of events) {
    const priceLocked = e._priceLocked === true
    delete e._priceLocked
    const prior = priorMap.get(e.id)
    if (prior && prior.kid_relevant !== null) {
      // Cache hit — carry forward the stored inference + price (no repeat Claude call).
      e.kid_relevant = prior.kid_relevant
      e.age_buckets = prior.age_buckets
      e.age_confidence = prior.age_confidence
      e.age_reasoning = prior.age_reasoning
      e.price_class = prior.price_class
      e.price_confidence = prior.price_confidence
      e.price_reasoning = prior.price_reasoning
      e.is_free = prior.is_free
      e.price_text = prior.price_text
      continue
    }
    llmCalls++
    const result = await inferPlayFriscoEvent({ title: e.title, description: e.description ?? '' })
    if (result) {
      e.kid_relevant = result.kid_relevant
      e.age_buckets = result.age_buckets
      e.age_confidence = result.confidence
      e.age_reasoning = result.reasoning
      if (!priceLocked) {
        const resolved = resolvePriceClass({
          price: result.price,
          price_confidence: result.price_confidence,
          title: e.title,
          description: e.description ?? '',
          registration_required: e.registration_required,
        })
        const priceFields = priceClassToFields(resolved.price_class)
        e.price_class = resolved.price_class
        e.price_confidence = resolved.price_confidence
        e.price_reasoning = result.price_reasoning
        e.is_free = priceFields.is_free
        e.price_text = priceFields.price_text
      }
    } else {
      // LLM call failed — fail-closed: hide rather than default-show an unclassified event.
      e.kid_relevant = false
      e.age_reasoning = 'classification unavailable (hidden)'
    }
  }

  // Fail-closed pass (covers cached events too): hide anything low-confidence (explicitly uncertain
  // per the prompt) or explicitly adults-only — belt-and-suspenders on top of the LLM.
  const ADULT_OVERRIDE = /\badults?\s*only\b|\b21\s*\+|\b18\s*\+|\bmust be 21\b/i
  for (const e of events) {
    if (e.age_confidence === 'low') e.kid_relevant = false
    if (ADULT_OVERRIDE.test(`${e.title} ${e.description ?? ''}`)) e.kid_relevant = false
  }
  return llmCalls
}

// ---------------------------------------------------------------------------
// Kaleidoscope Park (Frisco signature park) — WordPress + The Events Calendar REST API.
// Best-case source: fully structured JSON. The bare API is WAF-blocked (403); it returns 200
// with a browser UA + Accept: application/json + Referer. All events are at the park, so
// sub-venues share the park's coordinates. See SOURCE-ONBOARDING.md worked example.
// ---------------------------------------------------------------------------
const KALEIDOSCOPE_API = 'https://kaleidoscopepark.org/wp-json/tribe/events/v1/events'
const KALEIDOSCOPE_COORDS = { lat: 33.0978, lng: -96.8230 } // Kaleidoscope Park @ Hall Park, Frisco
const KALEIDOSCOPE_HEADERS = {
  'Accept': 'application/json',
  'Referer': 'https://kaleidoscopepark.org/events/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

async function ingestKaleidoscope() {
  const errors: string[] = []
  const events: any[] = []
  const startDate = new Date().toISOString().slice(0, 10) // upcoming events only

  try {
    let page = 1
    let totalPages = 1
    do {
      const res = await fetch(`${KALEIDOSCOPE_API}?per_page=50&page=${page}&start_date=${startDate}`, {
        headers: KALEIDOSCOPE_HEADERS,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: any = await res.json()
      totalPages = json.total_pages ?? 1

      for (const e of (json.events ?? [])) {
        // Use the LOCAL wall time (start_date) as America/Chicago — the source's utc_* is 10h wrong
        // (its WordPress TZ is misconfigured as UTC+5). See centralWallTimeToUtc above.
        const start = centralWallTimeToUtc(e.start_date ?? '')
        if (!start || isNaN(start.getTime())) continue
        const end = e.end_date ? centralWallTimeToUtc(e.end_date) : null
        const title = decodeHtml(e.title ?? '')
        if (!title) continue
        const description = e.description ? decodeHtml(String(e.description).replace(/<[^>]+>/g, ' ')) : null
        const image = e.image?.url ? encodeURI(decodeHtml(String(e.image.url))) : null

        // Price: the Tribe `cost` string ("Free" / "$X" / "") is authoritative when present;
        // an empty cost → free-by-default inference (same six-layer model as Play Frisco).
        const costText = typeof e.cost === 'string' ? e.cost.trim() : ''
        const costFieldClass = interpretCostField(costText)
        const priceLocked = costFieldClass !== null
        const resolved = priceLocked
          ? { price_class: costFieldClass!, price_confidence: 'confirmed' as const }
          : fallbackPriceClass({ title, description: description ?? '', registration_required: requiresRegistration(`${title} ${description ?? ''}`) })
        const priceFields = priceClassToFields(resolved.price_class)

        events.push({
          id: `kaleidoscope-park-${e.id}`,
          source: 'kaleidoscope-park',
          title,
          description,
          start_datetime: start.toISOString(),
          end_datetime: end && !isNaN(end.getTime()) ? end.toISOString() : null,
          location_name: e.venue?.venue ? decodeHtml(String(e.venue.venue)) : 'Kaleidoscope Park',
          location_address: e.venue?.address ? decodeHtml(String(e.venue.address)) : '6635 Warren Parkway, Frisco, TX',
          location_lat: e.venue?.geo_lat ? Number(e.venue.geo_lat) : KALEIDOSCOPE_COORDS.lat,
          location_lng: e.venue?.geo_lng ? Number(e.venue.geo_lng) : KALEIDOSCOPE_COORDS.lng,
          is_free: priceFields.is_free,
          price_text: priceFields.price_text,
          price_class: resolved.price_class,
          price_confidence: resolved.price_confidence,
          price_reasoning: priceLocked ? `Cost field: "${costText}"` : null,
          _priceLocked: priceLocked,
          age_min: null,
          age_max: null,
          age_label: null,
          kid_relevant: null, // set by classifyEvents (LLM pass) in runKaleidoscopeIngest
          age_buckets: null,
          age_confidence: null,
          age_reasoning: null,
          is_recurring: false,
          recurrence_label: null,
          thumbnail_url: image,
          event_url: e.url || 'https://kaleidoscopepark.org/events/',
          category: guessCategory(title, description ?? ''),
          registration_required: requiresRegistration(`${title} ${description ?? ''}`),
          raw_json: { id: e.id, venue: e.venue?.venue ?? null },
          ingested_at: new Date().toISOString(),
        })
      }
      page++
    } while (page <= totalPages)
  } catch (err: any) {
    errors.push(`kaleidoscope-park: ${err.message}`)
  }

  return { events, errors }
}

export async function runKaleidoscopeIngest(): Promise<SourceIngestResult> {
  const db = supabaseAdmin()
  const errors: string[] = []
  const t0 = Date.now()

  const kaleidoscope = await ingestKaleidoscope()
  errors.push(...kaleidoscope.errors)

  // LLM-primary classification (age + price), fail-closed — the shared helper.
  const llmCalls = await classifyEvents(db, 'kaleidoscope-park', kaleidoscope.events)

  const events = dedupeMerge(kaleidoscope.events)
  markRecurring(events)

  const { upserted, aborted } = await guardedUpsert(db, 'kaleidoscope-park', events, errors)

  // Purge stale — delete any kaleidoscope-park event not in this batch (Tribe events can be
  // removed). Skipped on a rejected batch, which would otherwise delete good rows.
  if (!aborted && kaleidoscope.events.length > 0) {
    const currentIds = kaleidoscope.events.map((e: any) => e.id)
    const { error } = await db.from('events').delete().eq('source', 'kaleidoscope-park').not('id', 'in', `(${currentIds.join(',')})`)
    if (error) errors.push(`purge-stale-kaleidoscope: ${error.message}`)
  }

  // ingest_runs has no kaleidoscope column; log with upserted + llm_calls (per-source counts on the
  // dashboard come from the events table, so this is fine).
  await recordRun(db, { upserted, llmCalls, errors, t0 })
  return { source: 'kaleidoscope-park', fetched: kaleidoscope.events.length, upserted, llm_calls: llmCalls, errors }
}
