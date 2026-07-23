import { supabase } from './supabase'
import type { Event } from './types'
import type { CitySlug } from './site'
import { CITY_SOURCES, isIndexableEvent, startOfTodayCtIso } from './seo-indexable'

// ===========================================================================
// Server-only data access for the crawlable SEO surfaces (event pages, city
// landing pages, sitemap). Kept separate from the client-facing /api/events so
// the two can share one definition of "which events are indexable" (see
// ./seo-indexable) without the client bundle pulling in the service query.
// ===========================================================================

/** Fetch a single event by id (any date), or null if it doesn't exist. */
export async function getEventById(id: string): Promise<Event | null> {
  const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return data as Event
}

/**
 * All upcoming, indexable events — optionally scoped to a city. Feeds the sitemap
 * and the city landing pages. Ordered soonest-first.
 */
export async function getIndexableEvents(city?: CitySlug): Promise<Event[]> {
  const todayIso = startOfTodayCtIso()
  let query = supabase
    .from('events')
    .select('*')
    .gte('start_datetime', todayIso)
    .order('start_datetime', { ascending: true })
    .limit(2000)

  if (city) query = query.in('source', CITY_SOURCES[city])

  const { data, error } = await query
  if (error || !data) return []
  return (data as Event[]).filter(e => isIndexableEvent(e, todayIso))
}
