// PRE-WRITE ingest guard — the last thing between a scrape and the database.
//
// PRODUCT RULE THIS ENCODES: a wrong event time is worse than a missing event. A parent who
// shows up at the wrong hour is failed harder than one who never saw the event at all. So this
// module is deliberately biased toward writing LESS: it drops individual events it can't vouch
// for, and refuses an entire batch when a source looks systemically wrong — leaving the
// previously-stored (correct) rows untouched rather than overwriting them with bad data.
//
// WHY IT EXISTS. The data-quality gate (data-quality.ts / validate-data.ts) runs AFTER the
// upsert. It turns the pipeline red, but by then production is already serving wrong times —
// which is exactly what happened: the nightly ingest moved to UTC GitHub Actions runners and
// wrote every Frisco and Plano event 5–6 hours early, and the site served 5:00 AM story times
// until a human noticed. Detection after the write is not a guarantee. This runs before it.
//
// Pure functions over plain data — no Supabase import — so every rule here is unit-tested.

import type { Event } from './types'

export interface StoredTime {
  id: string
  start_datetime: string
}

export interface GuardThresholds {
  /** Reject the whole batch if more than this share of events have implausible start times. */
  maxImplausibleShare: number
  /** Minimum overlapping events before a uniform-shift verdict is trustworthy. */
  minOverlapForShift: number
  /** Share of overlapping events that must move by the SAME offset to call it systemic. */
  minShiftAgreement: number
  /** Offsets smaller than this (minutes) are ignored as ordinary source edits. */
  minShiftMinutes: number
  /** Reject the whole batch if it is this much smaller than what is already stored. */
  maxShrinkShare: number
  /** Refuse to purge in one run if more than this share of upcoming rows went missing. */
  maxPurgeShare: number
}

export const DEFAULT_GUARD: GuardThresholds = {
  maxImplausibleShare: 0.1,
  minOverlapForShift: 20,
  minShiftAgreement: 0.8,
  minShiftMinutes: 30,
  maxShrinkShare: 0.5,
  maxPurgeShare: 0.25,
}

const EARLIEST_PLAUSIBLE_HOUR_CT = 7

function centralParts(iso: string): { hour: number; minute: number } | null {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d)
  const hour = p.find(x => x.type === 'hour')?.value
  const minute = p.find(x => x.type === 'minute')?.value
  if (hour === undefined || minute === undefined) return null
  return { hour: +hour % 24, minute: +minute }
}

/**
 * Is this event's start time one we refuse to publish? Unparseable, or in the small hours.
 * Exact midnight is allowed — sources use 00:00 for all-day entries (LIBRARY CLOSED, civic
 * observances), which are legitimate. See data-quality.ts for the same rule post-write.
 */
export function hasImplausibleStart(e: Pick<Event, 'start_datetime'>): boolean {
  const t = centralParts(e.start_datetime)
  if (!t) return true // can't verify it → don't publish it
  if (t.hour === 0 && t.minute === 0) return false
  return t.hour < EARLIEST_PLAUSIBLE_HOUR_CT
}

export interface ShiftVerdict {
  /** Events present in both the incoming batch and the DB. */
  overlap: number
  /** How many of those moved by at least minShiftMinutes. */
  moved: number
  /** The most common non-zero offset, in minutes (positive = incoming is later). */
  dominantOffsetMin: number | null
  /** Share of the overlap that moved by exactly dominantOffsetMin. */
  agreement: number
  /** True when the batch looks like a systematic clock error rather than source edits. */
  systemic: boolean
}

/**
 * Compare incoming start times against what is already stored, for the same event ids.
 *
 * THE KEY INSIGHT: a real schedule change moves ONE event by an arbitrary amount. A timezone
 * or clock bug moves EVERY event by exactly the same amount. So "most overlapping events moved
 * by an identical non-zero offset" is a near-perfect fingerprint for the class of bug we hit —
 * and, unlike a plausible-hours rule, it catches shifts we haven't thought of (a 1-hour DST
 * error, a source switching timezones, an off-by-one-day parse), including ones that land at
 * perfectly reasonable-looking times.
 *
 * This check would have fired on 2026-08-12, the first night the ingest ran on a UTC runner,
 * when every Frisco and Plano event moved by exactly -300 minutes.
 */
export function detectUniformShift(
  incoming: Pick<Event, 'id' | 'start_datetime'>[],
  stored: StoredTime[],
  t: GuardThresholds = DEFAULT_GUARD,
): ShiftVerdict {
  const storedById = new Map(stored.map(s => [s.id, s.start_datetime]))
  const offsets: number[] = []
  let overlap = 0

  for (const e of incoming) {
    const was = storedById.get(e.id)
    if (!was) continue
    const a = new Date(was).getTime()
    const b = new Date(e.start_datetime).getTime()
    if (isNaN(a) || isNaN(b)) continue
    overlap++
    offsets.push(Math.round((b - a) / 60000))
  }

  const moved = offsets.filter(o => Math.abs(o) >= t.minShiftMinutes)
  if (overlap === 0 || moved.length === 0) {
    return { overlap, moved: 0, dominantOffsetMin: null, agreement: 0, systemic: false }
  }

  const counts = new Map<number, number>()
  for (const o of moved) counts.set(o, (counts.get(o) ?? 0) + 1)
  let dominantOffsetMin = 0, top = 0
  for (const [o, n] of counts) if (n > top) { top = n; dominantOffsetMin = o }

  const agreement = top / overlap
  return {
    overlap,
    moved: moved.length,
    dominantOffsetMin,
    agreement,
    systemic: overlap >= t.minOverlapForShift && agreement >= t.minShiftAgreement,
  }
}

/**
 * The stored rows a batch may fairly be compared against: the UPCOMING ones.
 *
 * WHY THIS EXISTS (2026-10-17 outage). A scrape returns a source's forward window only —
 * Frisco published 210 upcoming events. The shrink rule compared that against every row ever
 * written for the source: 525, of which 357 were past events dating back to June that nothing
 * ever deletes. So the denominator grew every night while the numerator stayed the size of the
 * source's forward window, and the guard was guaranteed to call a healthy scrape a partial one
 * eventually. It did, for three nights running, freezing Frisco's data.
 *
 * Comparing like with like fixes the class: past events cannot be in an incoming batch, cannot
 * change, and therefore say nothing about whether this scrape is complete.
 */
export function upcomingStored(stored: StoredTime[], nowIso: string): StoredTime[] {
  const cutoff = Date.parse(nowIso)
  if (isNaN(cutoff)) return stored // unparseable cutoff → compare against everything (fail safe)
  return stored.filter(s => {
    const t = Date.parse(s.start_datetime)
    return isNaN(t) || t >= cutoff // keep unparseable rows; they are not evidence of shrinkage
  })
}

export interface GuardDecision {
  /** Events safe to write. Empty when the batch is rejected. */
  write: Event[]
  /** Individually-rejected events (bad times) — skipped, never written. */
  dropped: Event[]
  /** True when the ENTIRE batch is refused and stored rows must be left alone. */
  abort: boolean
  /** Human-readable reasons, surfaced in ingest_runs + the Actions log. */
  reasons: string[]
  shift: ShiftVerdict
}

/**
 * Screen a scraped batch before it touches the database.
 *
 * Order matters: drop unpublishable events first, then judge the batch on what remains.
 *
 * Abort (write nothing, keep the stored rows) when:
 *  1. too many events have implausible times — the source or our parsing broke wholesale;
 *  2. the batch is a uniform clock shift away from what we already have (see detectUniformShift);
 *  3. the batch collapsed to a fraction of the stored set — a partial scrape would otherwise
 *     look like "these events were cancelled" to the purge step.
 *
 * `allowTimeShift` is the deliberate escape hatch for the one legitimate case: we FIXED a
 * timezone bug and the corrective re-ingest is *supposed* to move every event at once. It must
 * be passed explicitly (INGEST_ALLOW_TIME_SHIFT=1) so it can never be the accidental default.
 */
export function screenBatch(
  incoming: Event[],
  stored: StoredTime[],
  opts: { allowTimeShift?: boolean; thresholds?: GuardThresholds } = {},
): GuardDecision {
  const t = opts.thresholds ?? DEFAULT_GUARD
  const reasons: string[] = []

  const dropped = incoming.filter(hasImplausibleStart)
  const kept = incoming.filter(e => !hasImplausibleStart(e))

  if (dropped.length > 0) {
    reasons.push(`dropped ${dropped.length} event(s) with unpublishable start times, e.g. "${dropped[0].title}"`)
  }

  const shift = detectUniformShift(kept, stored, t)
  const implausibleShare = incoming.length > 0 ? dropped.length / incoming.length : 0
  let abort = false

  if (incoming.length > 0 && implausibleShare > t.maxImplausibleShare) {
    abort = true
    reasons.push(`ABORT: ${(implausibleShare * 100).toFixed(0)}% of events had implausible times (max ${(t.maxImplausibleShare * 100).toFixed(0)}%) — source or parsing looks broken`)
  }

  if (shift.systemic) {
    if (opts.allowTimeShift) {
      reasons.push(`uniform ${shift.dominantOffsetMin}min shift across ${(shift.agreement * 100).toFixed(0)}% of ${shift.overlap} events — ALLOWED by INGEST_ALLOW_TIME_SHIFT`)
    } else {
      abort = true
      reasons.push(`ABORT: uniform ${shift.dominantOffsetMin}min shift across ${(shift.agreement * 100).toFixed(0)}% of ${shift.overlap} existing events — this is a clock/timezone bug, not a reschedule. Set INGEST_ALLOW_TIME_SHIFT=1 only if the shift is an intended correction.`)
    }
  }

  if (stored.length >= t.minOverlapForShift && kept.length < stored.length * (1 - t.maxShrinkShare)) {
    abort = true
    reasons.push(`ABORT: batch has ${kept.length} events vs ${stored.length} stored — looks like a partial scrape; keeping existing rows`)
  }

  return { write: abort ? [] : kept, dropped, abort, reasons, shift }
}

export interface PurgeDecision {
  /** Stored event ids that the source no longer lists — safe to delete. */
  remove: string[]
  /** True when the purge was refused because too much vanished at once. */
  skipped: boolean
  reason?: string
}

/**
 * Which stored events the source has stopped listing — i.e. cancellations.
 *
 * WHY THIS EXISTS. Play Frisco and Kaleidoscope deleted rows that fell out of their batch;
 * the two library sources never did, so an event the library cancelled stayed in our data
 * forever. On 2026-10-20 that was three Frisco "Teen Anime Club" sessions, one of them four
 * days away — exactly the failure the whole pipeline is built to avoid, arrived by omission
 * rather than by a bad write.
 *
 * TWO DELIBERATE NARROWINGS:
 *
 * 1. UPCOMING ONLY. A past event cannot be cancelled, and sources drop old events from their
 *    listings as a matter of course — so absence from a batch says nothing about a past row.
 *
 * 2. COMPARED AGAINST THE WHOLE INCOMING BATCH, including events the guard individually
 *    dropped for an unpublishable time. Those still exist at the source; refusing to publish
 *    this version of one is not a reason to delete the version we already have.
 *
 * The cap is the second opinion. The shrink rule already rejects a batch that collapsed, but a
 * source could plausibly lose a quarter of its listings to a silent scrape fault without
 * tripping it; a mass disappearance is therefore reported for a human rather than executed.
 * Below the cap we delete, because the product rule prefers a missing event to a wrong one —
 * and a cancelled event left on the page is the wrong one.
 */
export function purgeCandidates(
  storedUpcoming: StoredTime[],
  incoming: Pick<Event, 'id'>[],
  t: GuardThresholds = DEFAULT_GUARD,
): PurgeDecision {
  if (storedUpcoming.length === 0) return { remove: [], skipped: false }

  const present = new Set(incoming.map(e => e.id))
  const remove = storedUpcoming.filter(s => !present.has(s.id)).map(s => s.id)
  if (remove.length === 0) return { remove: [], skipped: false }

  const share = remove.length / storedUpcoming.length
  if (share > t.maxPurgeShare) {
    return {
      remove: [],
      skipped: true,
      reason: `PURGE SKIPPED: ${remove.length} of ${storedUpcoming.length} upcoming events (${(share * 100).toFixed(0)}%) are missing from this batch (max ${(t.maxPurgeShare * 100).toFixed(0)}%) — that is a scrape fault more often than a mass cancellation, so nothing was deleted. Check the source.`,
    }
  }
  return { remove, skipped: false }
}
