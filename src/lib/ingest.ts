// Ingest implementation — extracted from the /api/ingest route so it can run as a plain
// function (no Next.js, no HTTP request, no serverless timeout). Called two ways:
//   • scripts/ingest.ts  → GitHub Actions, one job per source (runFriscoIngest/…)
//   • /api/ingest route  → local/manual combined run (runAllIngest)
// See INGEST-DESIGN.md for the full architecture.
import { XMLParser } from 'fast-xml-parser'
import { supabaseAdmin } from './supabase'
import { EventCategory } from './types'
import { parseFriscoSuitableFor, parseCommunicoAgeGroup, communicoIsFamily } from './age-parsers'
import { inferPlayFriscoEvent } from './age-inference'
import { fallbackPriceClass, resolvePriceClass, priceClassToFields, interpretCostField } from './price'
import { PER_INFERENCE_COST_USD } from './technical-metrics'
import { markRecurring } from './recurring'

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

async function ingestFriscoLibrary() {
  const errors: string[] = []
  const events: any[] = []
  // Deduplicate — BiblioCommons audience_id filter is ignored server-side (requires browser
  // session cookie), so all paginated fetches return the full unfiltered catalogue
  const seenIds = new Set<string>()

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
        const startDate = new Date(dateStr)
        if (isNaN(startDate.getTime())) continue

        const locationMatch = card.match(/class="cp-event-location[^"]*"[^>]*>([^<]+)</)
        const location = locationMatch?.[1]?.trim() || 'Frisco Public Library'

        const descMatch = card.match(/class="cp-event-description[^"]*"[^>]*>([\s\S]*?)<\//)
        const teaserDescription = descMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || ''

        // "Suitable for:" is the sole source of age truth — audience_id feed filter doesn't work
        let description = teaserDescription
        let pageAgeMin: number | null = null
        let pageAgeMax: number | null = null
        let pageAgeLabel: string | null = null

        try {
          const eventRes = await fetch(eventUrl, {
            next: { revalidate: 0 },
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
            },
          })
          if (eventRes.ok) {
            const eventHtml = await eventRes.text()

            const ageData = parseFriscoSuitableFor(eventHtml)
            if (ageData.age_min !== null) {
              pageAgeMin = ageData.age_min
              pageAgeMax = ageData.age_max
              pageAgeLabel = ageData.age_label
            } else {
              // No "Suitable for:" block — treat as all ages (children + teens)
              pageAgeMin = 0; pageAgeMax = 17
            }

            const descStart = eventHtml.indexOf('event-description-content')
            if (descStart > -1) {
              const descBlock = eventHtml.slice(descStart, descStart + 8000)
              const paragraphs: string[] = []
              const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/g
              let pMatch
              while ((pMatch = pRegex.exec(descBlock)) !== null) {
                const text = decodeHtml(pMatch[1].replace(/<[^>]+>/g, ''))
                if (text && text.length > 5) paragraphs.push(text)
              }
              if (paragraphs.length > 0) description = paragraphs.join('\n\n')
            }
          }
        } catch {
          // page fetch failed — age stays null, event still ingested
        }

        const imgMatch = card.match(/class="cp-event-image[^"]*"[^>]*src="([^"]+)"/)
        const thumbnail = imgMatch?.[1] || null

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
          raw_json: { eventId, title, dateStr, location },
          ingested_at: new Date().toISOString(),
        })
      }

      page++
    }
  } catch (err: any) {
    errors.push(`frisco-library: ${err.message}`)
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

      const startDate = new Date(pubDate.replace(/\s*\+0000$/, ''))

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

const PARKS_REC_EXCLUDE_KEYWORDS = [
  'board', 'council', 'commission', 'meeting', 'senior', 'adult fitness',
  'workshop for adults', 'work session', 'irrigation', 'advisory',
  'planning', 'coffee with mayor', 'coffee with the mayor', 'chunk your junk', 'cycle the city',
  'game room', 'professional', 'ride with', 'taychas trail',
  'bird walk', 'spirit of america', 'reception,', 'harold bacchus',
  'conversational english', 'citizenship class', 'score mentor',
  'vendor application', 'vendor app',
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

  const oneMonthFromNow = new Date()
  oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1)

  // Collect EIDs from the current month + next 2 months
  const eids = new Set<string>()
  const now = new Date()

  for (let i = 0; i < 2; i++) {
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
      if (!startMatch) { errors.push(`play-frisco EID ${eid}: no startDate itemprop`); continue }
      const startDate = new Date(startMatch[1].trim())
      if (isNaN(startDate.getTime()) || startDate > oneMonthFromNow) continue

      // End datetime — CivicPlus has no endDate itemprop; parse from "Time:" detail block
      const endMatch = html.match(/itemprop="endDate"[^>]*>([^<]+)<\//i)
      let endDate: Date | null = endMatch ? new Date(endMatch[1]) : null
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
            endDate = new Date(startDate)
            endDate.setHours(hours24, mins, 0, 0)
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
        thumbnail_url: null,
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
  source: 'frisco-library' | 'plano-library' | 'play-frisco'
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

export async function runFriscoIngest(): Promise<SourceIngestResult> {
  const db = supabaseAdmin()
  const errors: string[] = []
  const t0 = Date.now()

  const frisco = await ingestFriscoLibrary()
  errors.push(...frisco.errors)

  const events = dedupeMerge(frisco.events)
  markRecurring(events)

  let upserted = 0
  if (events.length > 0) {
    const { error } = await db.from('events').upsert(events, { onConflict: 'id' })
    if (error) errors.push(`db upsert (frisco): ${error.message}`)
    else upserted = events.length
  }

  // Remove Frisco Library adult programs mislabeled under children audience feeds
  for (const kw of FRISCO_ADULT_KEYWORDS) {
    const { error } = await db.from('events').delete().eq('source', 'frisco-library').ilike('title', `%${kw}%`)
    if (error) errors.push(`cleanup-frisco-adult/${kw}: ${error.message}`)
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

  let upserted = 0
  if (events.length > 0) {
    const { error } = await db.from('events').upsert(events, { onConflict: 'id' })
    if (error) errors.push(`db upsert (plano): ${error.message}`)
    else upserted = events.length
  }

  await recordRun(db, { plano: plano.events.length, upserted, errors, t0 })
  return { source: 'plano-library', fetched: plano.events.length, upserted, llm_calls: 0, errors }
}

export async function runPlayFriscoIngest(): Promise<SourceIngestResult> {
  const db = supabaseAdmin()
  const errors: string[] = []
  let llmCalls = 0
  const t0 = Date.now()

  const playFrisco = await ingestPlayFrisco()
  errors.push(...playFrisco.errors)

  // LLM inference (age + price) for NEW Play Frisco events only — cached events reuse their
  // stored inference + price (no repeat Claude call). Identical to the original combined pass.
  if (playFrisco.events.length > 0) {
    const ids = playFrisco.events.map((e: any) => e.id)
    const { data: priorRows } = await db
      .from('events')
      .select('id, kid_relevant, age_buckets, age_confidence, age_reasoning, is_free, price_text, price_class, price_confidence, price_reasoning')
      .eq('source', 'play-frisco')
      .in('id', ids)
    const priorMap = new Map<string, any>((priorRows ?? []).map((r: any) => [r.id, r]))

    for (const e of playFrisco.events) {
      const priceLocked = e._priceLocked === true
      delete e._priceLocked
      const prior = priorMap.get(e.id)
      if (prior && prior.kid_relevant !== null) {
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
      }
    }
  }

  const events = dedupeMerge(playFrisco.events)
  markRecurring(events)

  let upserted = 0
  if (events.length > 0) {
    const { error } = await db.from('events').upsert(events, { onConflict: 'id' })
    if (error) errors.push(`db upsert (play-frisco): ${error.message}`)
    else upserted = events.length
  }

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

  await recordRun(db, { playFrisco: playFrisco.events.length, upserted, llmCalls, errors, t0 })
  return { source: 'play-frisco', fetched: playFrisco.events.length, upserted, llm_calls: llmCalls, errors }
}

// Combined run — all three sources sequentially. Used by the /api/ingest route for
// local/manual runs; the scheduled path runs each source as its own GitHub Actions job.
export async function runAllIngest(): Promise<{
  ok: boolean
  upserted: number
  counts: { frisco_library: number; plano_library: number; play_frisco: number }
  errors: string[]
}> {
  const frisco = await runFriscoIngest()
  const plano = await runPlanoIngest()
  const playFrisco = await runPlayFriscoIngest()
  return {
    ok: true,
    upserted: frisco.upserted + plano.upserted + playFrisco.upserted,
    counts: {
      frisco_library: frisco.fetched,
      plano_library: plano.fetched,
      play_frisco: playFrisco.fetched,
    },
    errors: [...frisco.errors, ...plano.errors, ...playFrisco.errors],
  }
}
