import Link from 'next/link'
import type { Event } from '@/lib/types'
import { getIndexableEvents } from '@/lib/seo-data'
import { cardPriceBadge } from '@/lib/price'
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

export default async function CityLanding({ city }: { city: CitySlug }) {
  const events = await getIndexableEvents(city)
  const label = CITY_LABEL[city]
  const jsonLd = buildItemListJsonLd(city, events)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header style={{ backgroundColor: 'var(--color-primary)' }} className="px-4 py-3">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <span className="text-2xl">🎈</span>
          <div>
            <div className="text-white font-bold text-xl tracking-tight leading-tight">Open Eventz</div>
            <div className="text-white/60 text-xs leading-tight">Free kids events in Frisco &amp; Plano, TX</div>
          </div>
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="font-bold text-2xl leading-snug mb-2" style={{ color: 'var(--color-text)' }}>
          Free Kids Events in {label}, TX
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-6">{CITY_BLURB[city]}</p>

        <p className="text-sm text-gray-500 mb-3">{events.length} upcoming events</p>

        {events.length === 0 ? (
          <p className="text-gray-400">No upcoming events right now — check back soon.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map(event => {
              const price = cardPriceBadge(event)
              return (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}`}
                    className="block rounded-xl border p-4 transition-colors hover:bg-gray-50"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold text-base leading-snug" style={{ color: 'var(--color-text)' }}>
                        {event.title}
                      </h2>
                      {price && (
                        <span
                          className="flex-shrink-0 inline-block text-xs px-2.5 py-1 rounded-full font-medium"
                          style={{ backgroundColor: price.bg, color: price.color }}
                        >
                          {price.content}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">📅 {shortWhen(event)}</div>
                    {event.location_name && (
                      <div className="text-sm text-gray-500 mt-0.5">📍 {event.location_name}</div>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        <footer className="mt-8 pt-6 border-t text-sm" style={{ borderColor: 'var(--color-border)' }}>
          <Link href="/" className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
            Open the full Open Eventz app — filter by age, date &amp; source →
          </Link>
        </footer>
      </main>
    </div>
  )
}
