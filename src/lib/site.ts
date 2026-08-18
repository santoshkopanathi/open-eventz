import type { EventSource } from './types'

// Canonical production origin. Used for canonical URLs, OpenGraph, JSON-LD, and the
// sitemap. Override with NEXT_PUBLIC_SITE_URL (e.g. a preview deploy) when needed; the
// default is the live custom-domain production origin. Never a trailing slash.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://openeventz.com'
).replace(/\/$/, '')

export type CitySlug = 'frisco' | 'plano'

/** Absolute URL of an event's own indexable page (`/events/[id]`). */
export function eventUrl(id: string): string {
  return `${SITE_URL}/events/${id}`
}

/** Absolute URL of a city landing page (`/frisco`, `/plano`). */
export function cityUrl(city: CitySlug): string {
  return `${SITE_URL}/${city}`
}

// Human-facing organizer name + homepage per source, reused in JSON-LD `organizer`
// and in visible page copy so the structured data matches what the page shows.
interface SourceOrg {
  name: string
  url: string
}

const SOURCE_ORG: Record<EventSource, SourceOrg> = {
  'frisco-library': { name: 'Frisco Public Library', url: 'https://www.friscolibrary.com/' },
  'plano-library': { name: 'Plano Public Library', url: 'https://library.plano.gov/' },
  'play-frisco': { name: 'Play Frisco (Frisco Parks & Recreation)', url: 'https://www.friscotexas.gov/291/Parks-Recreation' },
  'kaleidoscope-park': { name: 'Kaleidoscope Park', url: 'https://kaleidoscopepark.org/events/' },
}

export function sourceOrg(source: EventSource): SourceOrg {
  return SOURCE_ORG[source]
}

// Short, human-facing source name for buttons/links (e.g. "View on Frisco Library ↗").
const SOURCE_SHORT_LABEL: Record<EventSource, string> = {
  'frisco-library': 'Frisco Library',
  'plano-library': 'Plano Libraries',
  'play-frisco': 'Play Frisco',
  'kaleidoscope-park': 'Kaleidoscope Park',
}

export function sourceShortLabel(source: EventSource): string {
  return SOURCE_SHORT_LABEL[source]
}

/** The city a source belongs to — drives which landing page an event links back to. */
export function sourceCity(source: EventSource): CitySlug {
  return source === 'plano-library' ? 'plano' : 'frisco'
}
