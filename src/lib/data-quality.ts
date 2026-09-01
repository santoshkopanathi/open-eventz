import type { Event } from './types'
import { passesAgeFilter } from './age-filter'

// Pure data-quality checks run against REAL ingested events (post-ingest gate). These exist
// because the unit/E2E suites are logic-only (mocked) and never see real data — so an upstream
// source change (e.g. BiblioCommons going client-side-rendered → every Frisco age collapsed to
// 0–17) passed every test while corrupting production. See INGEST-DESIGN.md §Data-quality gate.

export interface QualityCheck {
  name: string
  pass: boolean
  detail: string
}

/**
 * Share of events collapsed into a single (age_min,age_max) bucket. A proxy for "age extraction
 * broke and everything fell to one value" (the 0–17 fallback). Healthy data has variety; a near-1
 * share is the fingerprint of the break we just fixed.
 */
export function dominantAgeBucketShare(events: Event[]): { share: number; bucket: string } {
  if (events.length === 0) return { share: 0, bucket: 'n/a' }
  const counts = new Map<string, number>()
  for (const e of events) {
    const k = `${e.age_min}-${e.age_max}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let bucket = '', top = 0
  for (const [k, v] of counts) if (v > top) { top = v; bucket = k }
  return { share: top / events.length, bucket }
}

// Titles that clearly target adults. Deliberately narrow (whole-word, explicit phrases) to avoid
// false positives like "Young Adult" fiction — this flags a stored-age bug, not a taxonomy call.
const ADULT_TITLE = /\bfor adults\b|\badult['’]?s?\b|\bseniors?\b|\b18\+\b/i

/**
 * Events whose title clearly targets adults but are stored kid-visible (age_min < 18). This is the
 * exact symptom of the age break — "D&D for Adults" stored as 0–17 leaks past the `age_min < 18`
 * gate into a kids app. Should be zero.
 */
export function adultTitleLeaks(events: Event[]): Event[] {
  return events.filter(e => ADULT_TITLE.test(e.title) && (e.age_min ?? 0) < 18)
}

/**
 * Fraction of events that pass the Toddlers (0–5) filter. A kid age-filter must actually NARROW —
 * if selecting Toddlers returns ~everything, the age data is meaningless (the filter-no-op bug).
 */
export function ageFilterNarrowShare(events: Event[]): number {
  if (events.length === 0) return 0
  return events.filter(e => passesAgeFilter(e, [[0, 5]])).length / events.length
}

// Nothing a family attends starts between these hours, Central. A kids storytime at 5:00 AM is not
// an odd event — it is a timezone bug. Late-evening is left alone (concerts, tree lightings).
const EARLIEST_PLAUSIBLE_HOUR_CT = 7

function centralParts(iso: string): { hour: number; minute: number } | null {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso))
  const hour = p.find(x => x.type === 'hour')?.value
  const minute = p.find(x => x.type === 'minute')?.value
  if (hour === undefined || minute === undefined) return null
  return { hour: +hour % 24, minute: +minute }
}

/**
 * Events starting implausibly early in Central time — the fingerprint of a wall-clock time parsed
 * in the wrong timezone. The ingest used a bare `new Date(str)` on offset-less source strings, so
 * the nightly UTC Actions runner stored every Frisco/Plano event 5–6 hours early and production
 * showed 5:00 AM story times. Correct data has effectively none of these; a whole source shifting
 * at once produces dozens.
 *
 * EXACT MIDNIGHT IS EXCLUDED. Sources use 00:00 as "all day, no meaningful time" — library
 * closures, civic observances ("Unplug Texas Day"), application windows. Those are legitimate and
 * would otherwise be flagged forever. The exclusion is safe because the bug's signature is
 * early-morning-but-not-midnight (the incident produced 4:30 / 5:00 / 5:30 / 6:00 AM), and because
 * a shift moves an entire source at once — dozens of events land in the 1–7 AM window, so the
 * check still fires loudly even if one masked event slips through.
 */
export function implausiblyEarlyEvents(events: Event[]): Event[] {
  return events.filter(e => {
    const t = centralParts(e.start_datetime)
    if (!t) return false
    if (t.hour === 0 && t.minute === 0) return false // all-day marker, not a shifted time
    return t.hour < EARLIEST_PLAUSIBLE_HOUR_CT
  })
}

/**
 * Per-source start-time sanity. Kept separate from the age checks so a red line names the source
 * whose timezone handling broke. Tolerates a stray outlier; fails when a source shifts wholesale.
 */
export function startTimeChecks(events: Event[], sourceLabel: string, maxShare = 0.05): QualityCheck {
  if (events.length === 0) return { name: `${sourceLabel}: start times plausible`, pass: true, detail: 'no events' }
  const early = implausiblyEarlyEvents(events)
  const share = early.length / events.length
  return {
    name: `${sourceLabel}: start times plausible`,
    pass: share <= maxShare,
    detail: early.length
      ? `${early.length}/${events.length} start between 12:01 and ${EARLIEST_PLAUSIBLE_HOUR_CT}:00 AM CT, e.g. "${early[0].title}" — check timezone handling`
      : `none between 12:01 and ${EARLIEST_PLAUSIBLE_HOUR_CT}:00 AM CT (exact-midnight all-day events excluded)`,
  }
}

export interface FriscoAgeThresholds {
  minCount: number
  maxDominantShare: number
  maxToddlerShare: number
}

export const DEFAULT_FRISCO_THRESHOLDS: FriscoAgeThresholds = {
  minCount: 30,        // a near-empty Frisco set means the listing scrape broke
  maxDominantShare: 0.85, // >85% in one age bucket ⇒ age extraction collapsed
  maxToddlerShare: 0.9,   // Toddlers(0–5) matching >90% of events ⇒ filter is a no-op
}

/**
 * The Frisco age-health checks — the ones that would have caught this incident. Pure over the
 * event set so it's unit-tested; the script wires it to the live DB and turns failures red.
 */
export function friscoAgeChecks(friscoEvents: Event[], t: FriscoAgeThresholds = DEFAULT_FRISCO_THRESHOLDS): QualityCheck[] {
  const dom = dominantAgeBucketShare(friscoEvents)
  const leaks = adultTitleLeaks(friscoEvents)
  const toddlerShare = ageFilterNarrowShare(friscoEvents)
  return [
    { name: 'frisco: non-empty', pass: friscoEvents.length >= t.minCount, detail: `${friscoEvents.length} events (min ${t.minCount})` },
    { name: 'frisco: age variety', pass: dom.share <= t.maxDominantShare, detail: `top bucket ${dom.bucket} = ${(dom.share * 100).toFixed(0)}% (max ${(t.maxDominantShare * 100).toFixed(0)}%)` },
    { name: 'frisco: no adult-title leaks', pass: leaks.length === 0, detail: leaks.length ? `${leaks.length} leaked, e.g. "${leaks[0].title}"` : 'none' },
    { name: 'frisco: toddler filter narrows', pass: toddlerShare <= t.maxToddlerShare, detail: `Toddlers(0–5) matches ${(toddlerShare * 100).toFixed(0)}% (max ${(t.maxToddlerShare * 100).toFixed(0)}%)` },
  ]
}

// ---------------------------------------------------------------------------
// Per-source write freshness (added 2026-08-22, after the Kaleidoscope Park outage)
// ---------------------------------------------------------------------------

// The nightly ingest runs every 24h, so 48h tolerates exactly one missed night before it is
// worth waking someone. Tighter would go red on a single transient source hiccup.
export const MAX_INGEST_AGE_HOURS = 48

export interface SourceFreshness {
  source: string
  /** Newest `ingested_at` for that source, or null when the source has no rows at all. */
  lastIngestedAt: string | null
}

/**
 * Per-source freshness — "did THIS source write anything recently?"
 *
 * PER SOURCE is the entire point. The original check took the newest `ingested_at` across the
 * WHOLE table, which meant it could never fail: Plano writes ~700 rows a night, so the newest
 * timestamp is always minutes old. Kaleidoscope Park's API returned 404 for three consecutive
 * nights (the source dropped The Events Calendar plugin) and the gate reported
 * "last ingest 0.1h ago ✅" every single time.
 *
 * This is deliberately NOT the same question as "non-empty". Stale rows still satisfy a minimum
 * count, so a volume check cannot see a dead source until its events age past their start dates —
 * four months later, in this case. Freshness measures the WRITE; non-empty measures the STOCK.
 */
export function sourceFreshnessChecks(
  sources: SourceFreshness[],
  now: Date = new Date(),
  maxAgeHours: number = MAX_INGEST_AGE_HOURS,
): QualityCheck[] {
  return sources.map(({ source, lastIngestedAt }) => {
    const name = `${source}: freshness`
    if (!lastIngestedAt) {
      return { name, pass: false, detail: 'no events stored — the source has never written, or every row was purged' }
    }
    const ts = new Date(lastIngestedAt)
    if (isNaN(ts.getTime())) {
      return { name, pass: false, detail: `unreadable ingested_at "${lastIngestedAt}"` }
    }
    const ageHrs = (now.getTime() - ts.getTime()) / 3.6e6
    return {
      name,
      pass: ageHrs <= maxAgeHours,
      detail: `last write ${ageHrs.toFixed(1)}h ago (max ${maxAgeHours}h)`,
    }
  })
}

// ---------------------------------------------------------------------------
// Unclassified-but-published (added 2026-09-01, after it happened in production)
// ---------------------------------------------------------------------------

/**
 * Finds LLM-classified events left with `kid_relevant = null` — never successfully classified.
 *
 * `null` means two different things depending on the source. A library event has no LLM
 * inference at all, so null is expected and correct. An event from a source we *do* classify
 * has null only because the classification never completed — a failed model call, a cleared
 * row, an interrupted run. Those are unclassified, not exempt.
 *
 * **Why this is a data check and not a unit test.** The visibility gate lives in a PostgREST
 * filter, not in JavaScript. Re-implementing it as a JS predicate would create a second copy
 * that can silently disagree with the real one — which is the class of bug this whole check
 * exists to catch. So the gate is asserted against the actual database instead.
 *
 * **What happened.** On 2026-09-01 a re-classification cleared these columns, then one Play
 * Frisco event's model call returned malformed JSON. The ingest correctly excluded it from the
 * write — but the row already existed, so "write nothing" left the null in place, and the old
 * gate served it. The event reached parents unclassified. The gate is now source-aware; this
 * check is the second line, and it names the events rather than only failing.
 *
 * Defence in depth: the gate stops exposure, this reports that it happened at all.
 */
export function unclassifiedLlmEvents(
  events: Pick<Event, 'id' | 'title' | 'source' | 'kid_relevant'>[],
  llmSources: readonly string[],
): Pick<Event, 'id' | 'title' | 'source' | 'kid_relevant'>[] {
  return events.filter(e => llmSources.includes(e.source) && e.kid_relevant === null)
}

export function unclassifiedCheck(
  events: Pick<Event, 'id' | 'title' | 'source' | 'kid_relevant'>[],
  llmSources: readonly string[],
): QualityCheck {
  const bad = unclassifiedLlmEvents(events, llmSources)
  const names = bad.slice(0, 3).map(e => e.title).join('; ')
  return {
    name: 'no unclassified LLM events stored',
    pass: bad.length === 0,
    detail: bad.length === 0
      ? 'none'
      : `${bad.length} event(s) with kid_relevant = null from an LLM-classified source — never classified, and only the API gate is keeping them hidden: ${names}${bad.length > 3 ? ' …' : ''}`,
  }
}
