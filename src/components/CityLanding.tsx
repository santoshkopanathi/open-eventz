import Link from 'next/link'
import type { Event } from '@/lib/types'
import { getIndexableEvents } from '@/lib/seo-data'
import { cardPriceBadge } from '@/lib/price'
import { cardAgeBadge } from '@/lib/age-badge'
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

      <header className="px-7 py-[18px] border-b" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-rule)' }}>
        <Link href="/" className="flex flex-col w-fit">
          <span className="font-display leading-none" style={{ fontSize: '26px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>Open Eventz</span>
          <span className="mt-1" style={{ fontSize: '13px', color: 'var(--color-ink-35)' }}>Free things to do with kids · Frisco &amp; Plano</span>
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="font-display leading-tight mb-3" style={{ fontSize: '34px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
          Free Kids Events in {label}, TX
        </h1>
        <p className="mb-6" style={{ fontSize: '16px', lineHeight: 1.65, color: 'var(--color-ink-70)' }}>{CITY_BLURB[city]}</p>

        <p className="mb-3 font-mono uppercase" style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--color-ink-35)' }}>{events.length} upcoming events</p>

        {events.length === 0 ? (
          <p style={{ color: 'var(--color-ink-50)' }}>No upcoming events right now — check back soon.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map(event => {
              const price = cardPriceBadge(event)
              const age = cardAgeBadge(event)
              return (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}`}
                    className="block p-4 transition-colors"
                    style={{ border: '1px solid var(--color-card-border)', backgroundColor: 'var(--color-paper)', borderRadius: 'var(--radius-input)' }}
                  >
                    <h2 className="leading-snug" style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
                      {event.title}
                    </h2>
                    <div className="mt-1 font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.06em', color: 'var(--color-ink-35)' }}>{shortWhen(event)}</div>
                    {event.location_name && (
                      <div className="mt-0.5" style={{ fontSize: '13px', color: 'var(--color-ink-70)' }}>{event.location_name}</div>
                    )}
                    {/* Full badge set — same signals the app cards show */}
                    {(price || age || event.registration_required || event.is_recurring) && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {price && (
                          <span className="font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: price.bg, color: price.color }}>
                            {price.content}
                          </span>
                        )}
                        {age && (
                          <span className="font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: age.bg, color: age.color }}>
                            {age.content}
                          </span>
                        )}
                        {event.registration_required && (
                          <span className="font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-accent-tint)', color: 'var(--color-accent-text)' }}>
                            Registration
                          </span>
                        )}
                        {event.is_recurring && (
                          <span className="font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-fill-subtle)', color: 'var(--color-ink-50)' }}>
                            Recurring
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        <footer className="mt-8 pt-6 border-t text-sm" style={{ borderColor: 'var(--color-rule)' }}>
          <Link href="/" className="font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>
            Open the full Open Eventz app — filter by age, date &amp; source →
          </Link>
        </footer>
      </main>
    </div>
  )
}
