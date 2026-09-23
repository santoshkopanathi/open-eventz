import Link from 'next/link'
import type { Event } from '@/lib/types'
import { getIndexableEvents } from '@/lib/seo-data'
import { cityUrl, eventUrl, type CitySlug } from '@/lib/site'

const TZ = 'America/Chicago'

const CITY_LABEL: Record<CitySlug, string> = { frisco: 'Frisco', plano: 'Plano' }

const CITY_BLURB: Record<CitySlug, string> = {
  frisco:
    'Free and low-cost kids events across Frisco Public Library and Play Frisco parks & recreation — storytimes, STEM programs, arts, and outdoor fun. Updated daily.',
  plano:
    'Free kids events across all Plano Public Library branches — storytimes, maker programs, and family activities. Updated daily.',
}

function shortWhen(event: Event): string {
  const d = new Date(event.start_datetime)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
  return `${day} · ${time}`
}

// ItemList JSON-LD — helps Google understand this as a curated list of events and
// can surface it as a carousel. Each item points at the event's own canonical page.
function buildItemListJsonLd(city: CitySlug, events: Event[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Free kids events in ${CITY_LABEL[city]}, TX`,
    url: cityUrl(city),
    numberOfItems: events.length,
    itemListElement: events.slice(0, 50).map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: eventUrl(e.id),
      name: e.title,
    })),
  }
}

/**
 * The crawlable half of a city route. The app above it is client-rendered, so this server
 * component is what puts the city's name, blurb and actual event titles into the HTML that
 * Google indexes — it is why `/frisco` can serve the real app and still rank for "free kids
 * events in frisco". Visible, not hidden: it sits below the app in normal page flow.
 */
export default async function CityEventIndex({ city }: { city: CitySlug }) {
  const events = await getIndexableEvents(city)
  const label = CITY_LABEL[city]
  const jsonLd = buildItemListJsonLd(city, events)

  return (
    <section
      className="px-4 py-10"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', borderTop: '1px solid var(--color-rule)' }}
    >
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-2xl mx-auto">
        <h1 className="font-display leading-tight mb-3" style={{ fontSize: '30px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
          Free Kids Events in {label}, TX
        </h1>
        <p className="mb-6" style={{ fontSize: '16px', lineHeight: 1.65, color: 'var(--color-ink-70)' }}>{CITY_BLURB[city]}</p>

        <p className="mb-3 font-mono uppercase" style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--color-ink-35)' }}>
          {events.length} upcoming events
        </p>

        {events.length === 0 ? (
          <p style={{ color: 'var(--color-ink-50)' }}>No upcoming events right now — check back soon.</p>
        ) : (
          <ul className="flex flex-col">
            {events.map(event => (
              <li key={event.id} style={{ borderTop: '1px solid var(--color-rule)' }}>
                <Link href={`/events/${event.id}`} className="block py-3">
                  <span className="block leading-snug" style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
                    {event.title}
                  </span>
                  <span className="block mt-0.5 font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.06em', color: 'var(--color-ink-35)' }}>
                    {shortWhen(event)}
                    {event.location_name ? ` · ${event.location_name}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
