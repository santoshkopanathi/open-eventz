// Convert an America/Chicago wall-clock time ("YYYY-MM-DD HH:MM:SS") to a UTC Date, DST-aware
// (CDT = UTC-5 / CST = UTC-6). Pure + unit-tested — separate from ingest.ts (which imports Supabase).
//
// Why it exists: do NOT trust a source's own `utc_*` field. Kaleidoscope Park's WordPress timezone
// is misconfigured as a fixed "UTC+5", so its reported UTC is 10 hours wrong; the local wall time
// is the reliable field. Playbook principle: verify a source's UTC against a known event time.
export function centralWallTimeToUtc(local: string): Date | null {
  const m = local?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] ?? 0)
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s) // treat the wall time as if it were UTC…
  // …then measure how America/Chicago renders that instant and correct by the difference.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcGuess))
  const g = (t: string) => +(parts.find(p => p.type === t)?.value ?? 0)
  const asChicago = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'))
  return new Date(utcGuess + (utcGuess - asChicago))
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')

function to24h(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour
  const pm = meridiem.toUpperCase().startsWith('P')
  if (pm) return hour === 12 ? 12 : hour + 12
  return hour === 12 ? 0 : hour
}

/**
 * Parse a naive (offset-less) wall-clock string from a source as America/Chicago.
 *
 * WHY THIS EXISTS — the bug it fixes. Every source publishes local wall-clock times, and the
 * ingest used to parse them with a bare `new Date(str)`. A date string with no offset is
 * resolved in the **runtime's** timezone, so the same feed produced different instants
 * depending on where ingest ran: correct from a Central dev machine, but **5–6 hours early**
 * from the nightly GitHub Actions runner, which is UTC. The tell was a 5:00 AM story time on
 * production. Timezone must come from the venue, never from the machine.
 *
 * Handles the three shapes our sources emit, all treated as Central wall time:
 *   - ISO-ish, no offset — `2026-08-15T08:00:00` (Play Frisco / CivicPlus `itemprop="startDate"`)
 *   - RFC-822-ish       — `Fri, 14 Aug 2026 09:30:00 +0000` (Plano RSS `pubDate`)
 *   - long-form         — `August 14, 2026 10:00 AM` (Frisco Library card date + time)
 * A missing time-of-day resolves to midnight Central.
 *
 * NOTE on the Plano case: its feed stamps `+0000` on times that are plainly local (a 9:30 AM
 * storytime is published as `09:30:00 +0000`). Any trailing offset is therefore **ignored on
 * purpose** — same call as Kaleidoscope's misconfigured `utc_*`. Don't trust a source's UTC.
 */
export function parseCentralWallTime(input: string): Date | null {
  const s = input?.trim()
  if (!s) return null

  // ISO-ish — already the shape centralWallTimeToUtc wants.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return centralWallTimeToUtc(s)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return centralWallTimeToUtc(`${s} 00:00:00`)

  // RFC-822-ish: "Fri, 14 Aug 2026 09:30:00 +0000" → day month year time
  let m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo) {
      return centralWallTimeToUtc(
        `${m[3]}-${pad(mo)}-${pad(+m[1])} ${pad(+(m[4] ?? 0))}:${pad(+(m[5] ?? 0))}:${pad(+(m[6] ?? 0))}`,
      )
    }
  }

  // Long-form: "August 14, 2026 10:00 AM" / "Aug 14, 2026" (time optional)
  m = s.match(/\b([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?)?/)
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    if (mo) {
      const hour = to24h(+(m[4] ?? 0), m[7])
      return centralWallTimeToUtc(
        `${m[3]}-${pad(mo)}-${pad(+m[2])} ${pad(hour)}:${pad(+(m[5] ?? 0))}:${pad(+(m[6] ?? 0))}`,
      )
    }
  }

  return null
}
