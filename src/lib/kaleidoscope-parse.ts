// Kaleidoscope Park — parsing the rebuilt (Next.js) site. Pure functions, no I/O.
//
// WHY THIS MODULE EXISTS. The park replaced WordPress; the whole REST API is gone (/wp-json
// 404s, not just the `tribe` namespace), so the old connector cannot be repaired. What the
// new site has is better in one way and worse in another:
//
//   BETTER  every event page carries complete schema.org Event JSON-LD — name, true-UTC
//           start/end, image, description, offers, a named sub-venue and a full address.
//           It is the cleanest source we ingest. NOTE: true UTC. The old site's WordPress
//           timezone was misconfigured as UTC+5, which is why the old code read wall-clock
//           time instead. Carrying that habit across would re-create the 5 AM story-time
//           bug in reverse, so this module reads the instant as given.
//
//   WORSE   one page per PROGRAM, not per occurrence. The JSON-LD states only the next
//           occurrence. Further dates, where they exist at all, are written into the
//           marketing prose ("September 3: Bryan Mayberry  September 10: Jade Nikol …").
//
// So this module does two jobs: trust the JSON-LD, and carefully transcribe the prose.
//
// THE TRANSCRIPTION RULES, and why each one is here. We are reading copy a marketing team
// types by hand; it will be reformatted without warning. Every rule below fails closed — a
// page we cannot read confidently costs us a stale listing, never a wrong time.

export interface ParsedEvent {
  name: string
  startIso: string
  endIso: string | null
  description: string | null
  imageUrl: string | null
  isFree: boolean | null
  locationName: string | null
  address: string | null
}

/** The authoritative next occurrence: schema.org Event JSON-LD, or null if absent. */
export function parseEventJsonLd(html: string): ParsedEvent | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown
    try { parsed = JSON.parse(m[1]) } catch { continue }
    const nodes = Array.isArray(parsed) ? parsed : [(parsed as Record<string, unknown>)]
    for (const raw of nodes) {
      const n = raw as Record<string, unknown>
      if (n?.['@type'] !== 'Event') continue
      const start = typeof n.startDate === 'string' ? n.startDate : null
      if (!n.name || !start || isNaN(Date.parse(start))) continue
      const loc = n.location as Record<string, unknown> | undefined
      const addr = loc?.address as Record<string, unknown> | undefined
      return {
        name: String(n.name),
        startIso: new Date(start).toISOString(),
        endIso: typeof n.endDate === 'string' && !isNaN(Date.parse(n.endDate)) ? new Date(n.endDate).toISOString() : null,
        description: typeof n.description === 'string' ? n.description : null,
        imageUrl: Array.isArray(n.image) ? (typeof n.image[0] === 'string' ? n.image[0] : null) : (typeof n.image === 'string' ? n.image : null),
        isFree: typeof n.isAccessibleForFree === 'boolean' ? n.isAccessibleForFree : null,
        locationName: typeof loc?.name === 'string' ? loc.name : null,
        address: [addr?.streetAddress, addr?.addressLocality, addr?.addressRegion].filter(v => typeof v === 'string').join(', ') || null,
      }
    }
  }
  return null
}

/** The page's own cadence sentence, e.g. "Every Saturday" / "First Saturday of every month". */
export function parseCadence(html: string): string | null {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const m = text.match(/Date\s+(Every [A-Z][a-z]+|First [A-Z][a-z]+ of every month|Select dates)/)
  return m ? m[1] : null
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Central-time parts of an instant — the only safe way to carry a time across a DST boundary. */
function centralParts(iso: string): { hour: number; minute: number; weekday: number } {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
  const p = fmt.formatToParts(d)
  const hour = +(p.find(x => x.type === 'hour')?.value ?? '0') % 24
  const minute = +(p.find(x => x.type === 'minute')?.value ?? '0')
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.find(x => x.type === 'weekday')?.value ?? '')
  return { hour, minute, weekday: wd }
}

/**
 * Build the instant for a Central wall-clock date + time-of-day. Applying the SERIES time
 * per date, rather than copying the confirmed occurrence's instant forward, is what keeps
 * November right: Live After 5 starts at 5:30 PM Central both sides of 1 November, but that
 * is 22:30Z in October and 23:30Z in November.
 */
export function centralDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  // Try both plausible offsets and keep the one that renders back to the wall time we asked for.
  for (const offset of [5, 6]) {
    const guess = new Date(Date.UTC(year, month - 1, day, hour + offset, minute))
    const back = centralParts(guess.toISOString())
    if (back.hour === hour && back.minute === minute) return guess
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 6, minute))
}

export interface ListedDatesResult {
  /** Extra occurrence instants, excluding the confirmed one. Empty when the page has no list. */
  dates: string[]
  /** Why a list was rejected — surfaced in ingest_runs rather than swallowed. */
  rejected?: string
}

/**
 * Transcribe further occurrence dates out of the page prose.
 *
 * VALIDATION, all fail-closed:
 *  1. The confirmed occurrence must appear in the parsed list. The JSON-LD date is the one
 *     thing on the page we trust completely, so it doubles as a checksum: if our reading of
 *     the paragraph does not contain it, our reading is wrong and the whole list is dropped.
 *  2. Every date must fall on the same weekday as the confirmed occurrence. These are series
 *     ("Every Thursday", "first Saturday", and even "Select dates" — all Saturdays). A stray
 *     weekday means we have matched a date that is not an occurrence.
 *  3. Dates carry no year on the page, so the year is inferred as the first one that is not
 *     in the past relative to the confirmed date, and anything more than a year out is
 *     dropped. No list on this site has ever run longer than a season.
 *
 * The time of day comes from the confirmed occurrence, applied as Central wall time.
 */
export function parseListedDates(html: string, confirmedStartIso: string): ListedDatesResult {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const confirmed = centralParts(confirmedStartIso)
  const confirmedDate = new Date(confirmedStartIso)

  const found: string[] = []
  let unresolved = 0
  for (const m of text.matchAll(/\b([A-Z][a-z]+) (\d{1,2})\b/g)) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1
    const day = +m[2]
    if (month === 0 || day < 1 || day > 31) continue

    // The page prints no year ("September 10: Jade Nikol"). The series weekday RESOLVES it:
    // of the years either side of the confirmed occurrence, at most one puts this date on the
    // series' weekday. A date that lands on no candidate year is not an occurrence at all —
    // a date in unrelated copy — and is skipped rather than guessed at.
    const candidates = [confirmedDate.getUTCFullYear() - 1, confirmedDate.getUTCFullYear(), confirmedDate.getUTCFullYear() + 1]
      .map(y => centralDateTimeToUtc(y, month, day, confirmed.hour, confirmed.minute))
      .filter(d => centralParts(d.toISOString()).weekday === confirmed.weekday)
      .filter(d => Math.abs(d.getTime() - confirmedDate.getTime()) <= 400 * 86_400_000)
      .sort((a, b) => Math.abs(a.getTime() - confirmedDate.getTime()) - Math.abs(b.getTime() - confirmedDate.getTime()))

    if (candidates.length === 0) { unresolved++; continue }
    found.push(candidates[0].toISOString())
  }

  const unique = [...new Set(found)]
  if (unique.length === 0) return { dates: [] }

  // The checksum. The JSON-LD date is the one thing on the page we trust completely, so if
  // our reading of the prose does not contain it, the reading is wrong — drop the whole list
  // and publish only the confirmed occurrence.
  if (!unique.includes(confirmedStartIso)) {
    return { dates: [], rejected: `listed dates did not include the confirmed occurrence (${confirmedStartIso.slice(0, 10)}) — the page format has changed, so the list was not trusted` }
  }

  // Mostly-unreadable prose is a reformatted page, not a schedule.
  if (unresolved > unique.length) {
    return { dates: [], rejected: `${unresolved} date(s) in the copy could not be placed on the series weekday against ${unique.length} that could — the list was not trusted` }
  }

  return { dates: unique.filter(d => d !== confirmedStartIso && Date.parse(d) > Date.parse(confirmedStartIso)).sort() }
}

/**
 * Occurrences INFERRED from a weekly cadence, for a page that publishes a rule and no list
 * (SaturYAY: "Every Saturday · through Dec 18, 2027"). These are not transcriptions — nobody
 * published them — so the horizon is deliberately short: the nightly re-read re-anchors on
 * the park's own next date, and a skipped week is corrected within days instead of being
 * advertised for a year. Returns [] for any cadence other than a weekly one.
 */
export function weeklyOccurrences(confirmedStartIso: string, cadence: string | null, horizonWeeks = 8, throughIso: string | null = null): string[] {
  if (!cadence || !/^Every [A-Z][a-z]+$/.test(cadence)) return []
  const confirmed = centralParts(confirmedStartIso)
  const out: string[] = []
  for (let week = 1; week <= horizonWeeks; week++) {
    const naive = new Date(Date.parse(confirmedStartIso) + week * 7 * 86_400_000)
    const when = centralDateTimeToUtc(
      naive.getUTCFullYear(), naive.getUTCMonth() + 1, naive.getUTCDate(), confirmed.hour, confirmed.minute,
    )
    // Re-applying the wall time can shift the UTC date across a DST boundary; verify the
    // occurrence still lands on the right weekday before publishing it.
    if (centralParts(when.toISOString()).weekday !== confirmed.weekday) continue
    // Never past the end of the run the page states.
    if (throughIso && when.getTime() > Date.parse(throughIso)) break
    out.push(when.toISOString())
  }
  return out
}

/** The Central-time calendar date of an instant, 'YYYY-MM-DD' — the date a human would say. */
export function centralDateKey(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso))
  const get = (t: string) => p.find(x => x.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export interface OccurrenceSlot {
  programKey: string
  start_datetime: string
  location_name: string | null
  date_inferred: boolean
}

/**
 * Resolve collisions between occurrences before they are written.
 *
 * WHY (2026-10-21). The park published "SaturYay: Holiday Edition" — the same 10 AM Saturday
 * slot as SaturYAY, running Nov 21 to Dec 19, evidently the seasonal rebrand of it rather
 * than a second event. Both pages state "Every Saturday", so the inferred horizons of the two
 * programmes landed on the same dates and the app showed SaturYAY twice.
 *
 * TWO RULES, both resolving toward what someone actually published:
 *
 *  1. A published occurrence beats an inferred one in the same slot. We were told this event
 *     happens; the other is our extrapolation. Drop the inference.
 *
 *  2. When two different programmes INFER into the same slot, drop both. The pages disagree
 *     about what runs that morning and neither said anything about that date; picking one
 *     would be inventing an answer to a question the source left open. The published
 *     occurrences of both programmes are untouched.
 *
 * A programme never collides with itself: a slot it has already published is its own.
 */
export function resolveOccurrenceCollisions<T extends OccurrenceSlot>(occurrences: T[]): T[] {
  const slotKey = (o: OccurrenceSlot) => `${o.start_datetime}|${o.location_name ?? ''}`

  const published = new Set<string>()
  const inferringProgrammes = new Map<string, Set<string>>()
  for (const o of occurrences) {
    const key = slotKey(o)
    if (o.date_inferred) {
      const set = inferringProgrammes.get(key) ?? new Set<string>()
      set.add(o.programKey)
      inferringProgrammes.set(key, set)
    } else {
      published.add(key)
    }
  }

  return occurrences.filter(o => {
    if (!o.date_inferred) return true
    const key = slotKey(o)
    if (published.has(key)) return false                                  // rule 1
    if ((inferringProgrammes.get(key)?.size ?? 0) > 1) return false       // rule 2
    return true
  })
}

/**
 * The end of the run, as the page states it: "through Dec 18, 2027", "through Nov 19".
 *
 * WHY (2026-10-21). "SaturYay: Holiday Edition" runs "Every Saturday · through Dec 19" — and
 * the first inferred horizon ignored that, generating Saturdays into January for a programme
 * the park had already said ends in December. A cadence without its bound is half a sentence.
 *
 * The year is usually absent; the stated bound is always ahead of the confirmed occurrence,
 * so the first candidate year that is not behind it wins. Returns null when no bound is
 * stated, which means "no clipping", not "runs forever" — the horizon is short regardless.
 */
export function parseThroughDate(html: string, confirmedStartIso: string): string | null {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const m = text.match(/through\s+([A-Z][a-z]{2,8})\.?\s+(\d{1,2})(?:,\s*(20\d\d))?/)
  if (!m) return null

  const monthIdx = MONTHS.findIndex(name => name.startsWith(m[1].toLowerCase()))
  if (monthIdx < 0) return null
  const day = +m[2]
  if (day < 1 || day > 31) return null

  const confirmed = new Date(confirmedStartIso)
  const years = m[3] ? [+m[3]] : [confirmed.getUTCFullYear(), confirmed.getUTCFullYear() + 1]
  for (const year of years) {
    // End of that day in Central terms — an occurrence ON the bound date is still in the run.
    const bound = centralDateTimeToUtc(year, monthIdx + 1, day, 23, 59)
    if (bound.getTime() >= confirmed.getTime()) return bound.toISOString()
  }
  return null
}
