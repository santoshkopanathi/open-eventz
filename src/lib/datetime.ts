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
