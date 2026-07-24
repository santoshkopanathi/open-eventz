import type { Event } from './types'

// ===========================================================================
// iCalendar (.ics) builder — pure, so it can run in the /api/ics route handler
// (server) and be unit-tested. Serving the event from a real URL as text/calendar
// is what lets iOS open it straight into the "Add to Calendar" screen; the old
// client-side Blob + `download` attribute instead forced a Files/Share detour.
// ===========================================================================

// ISO datetime → ICS UTC timestamp, e.g. "20260724T150000Z".
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

// Escape a TEXT value per RFC 5545: backslash, semicolon, comma, and newlines.
// (The old inline builder only escaped newlines — a stray comma in a title or
// "Library, Frisco" location would have corrupted the field.)
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** A safe, human-readable filename for the event's .ics (used on desktop downloads). */
export function icsFilename(event: Pick<Event, 'title'>): string {
  const slug = event.title
    .slice(0, 40)
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'event'}.ics`
}

/**
 * Build a VCALENDAR string with a single VEVENT for the event. `dtstamp` defaults
 * to the current time (the route passes the request time); tests pass a fixed value
 * for determinism.
 */
export function buildIcs(event: Event, opts?: { dtstamp?: string }): string {
  const start = toIcsUtc(event.start_datetime)
  const end = event.end_datetime ? toIcsUtc(event.end_datetime) : start
  const dtstamp = opts?.dtstamp ? toIcsUtc(opts.dtstamp) : toIcsUtc(new Date().toISOString())
  const location = [event.location_name, event.location_address].filter(Boolean).join(', ')
  const description = [event.description, event.event_url].filter(Boolean).join('\n\nMore info: ')

  const lines: (string | null)[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Eventz//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@openeventz`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(event.title)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    location ? `LOCATION:${escapeText(location)}` : null,
    event.event_url ? `URL:${event.event_url}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.filter((l): l is string => l !== null).join('\r\n')
}
