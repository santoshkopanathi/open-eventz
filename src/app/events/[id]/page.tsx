import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Event } from '@/lib/types'
import { getEventById } from '@/lib/seo-data'
import { isIndexableEvent, startOfTodayCtIso } from '@/lib/seo-indexable'
import { buildEventJsonLd } from '@/lib/event-jsonld'
import { eventUrl, sourceCity, sourceOrg } from '@/lib/site'
import { detailPriceBadge } from '@/lib/price'
import { detailAgeBadge } from '@/lib/age-badge'
import { inferenceDisclosure } from '@/lib/inference-disclosure'

// Event content changes rarely once ingested; revalidate hourly so freshly-ingested
// events appear and past ones drop without a redeploy.
export const revalidate = 3600

const TZ = 'America/Chicago'

function formatWhen(event: Event): string {
  const start = new Date(event.start_datetime)
  const startDay = start.toLocaleDateString('en-US', { timeZone: TZ })
  const endDay = event.end_datetime
    ? new Date(event.end_datetime).toLocaleDateString('en-US', { timeZone: TZ })
    : null
  if (endDay && startDay !== endDay) {
    const fmtDate = (iso: string) =>
      new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ })
    return `${fmtDate(event.start_datetime)} – ${fmtDate(event.end_datetime!)} · All day`
  }
  const date = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ })
  const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
  const endTime = event.end_datetime
    ? new Date(event.end_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
    : null
  return `${date} at ${time}${endTime ? ` – ${endTime}` : ''}`
}

// A concise, plain-text meta description: prefer the real description (trimmed to a
// clean sentence boundary), else a generated one from the event's facts.
function metaDescription(event: Event): string {
  const raw = event.description?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (raw && raw.length > 40) {
    return raw.length > 155 ? raw.slice(0, 152).replace(/\s+\S*$/, '') + '…' : raw
  }
  const where = event.location_name ? ` at ${event.location_name}` : ''
  const free = event.is_free === true ? 'Free ' : ''
  return `${free}kids event${where} in ${sourceCity(event.source) === 'plano' ? 'Plano' : 'Frisco'}, TX — details, date, time, and directions on Open Eventz.`
}

function titleTag(event: Event): string {
  const place = event.location_name ?? sourceOrg(event.source).name
  const price = event.is_free === true ? ' — Free' : ''
  return `${event.title} — ${place}${price}`
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) return { title: 'Event not found' }

  const indexable = isIndexableEvent(event, startOfTodayCtIso())
  const url = eventUrl(event.id)
  return {
    title: titleTag(event),
    description: metaDescription(event),
    alternates: { canonical: url },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: {
      title: titleTag(event),
      description: metaDescription(event),
      url,
      siteName: 'Open Eventz',
      type: 'article',
      images: event.thumbnail_url ? [event.thumbnail_url] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: titleTag(event),
      description: metaDescription(event),
    },
  }
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) notFound()

  const city = sourceCity(event.source)
  const org = sourceOrg(event.source)
  const price = detailPriceBadge(event)
  const age = detailAgeBadge(event)
  const disclosure = inferenceDisclosure(event)
  const jsonLd = buildEventJsonLd(event)

  const locationStr = [event.location_name, event.location_address].filter(Boolean).join(', ')
  const gcalUrl = (() => {
    const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const start = fmt(event.start_datetime)
    const end = event.end_datetime ? fmt(event.end_datetime) : start
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${start}/${end}`,
      details: [event.description, event.event_url].filter(Boolean).join('\n\nMore info: '),
      location: locationStr,
    })
    return `https://calendar.google.com/calendar/render?${p}`
  })()

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* JSON-LD structured data — the Event rich-result source */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Header */}
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
        {/* Two clear exits — matters for someone who arrives on a shared link:
            back into the main app, and to this city's full event list. */}
        <nav className="text-sm mb-4 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--color-periwinkle)' }}>
          <Link href="/" className="hover:underline font-medium">🏠 Open Eventz home</Link>
          <span className="text-gray-300" aria-hidden="true">·</span>
          <Link href={`/${city}`} className="hover:underline">
            View all {city === 'plano' ? 'Plano' : 'Frisco'} events →
          </Link>
        </nav>

        <article>
          <h1 className="font-bold text-2xl leading-snug mb-3" style={{ color: 'var(--color-text)' }}>
            {event.title}
          </h1>

          <div className="text-sm text-gray-600 mb-2">📅 {formatWhen(event)}</div>

          {event.location_name && (
            <div className="text-sm text-gray-600 mb-2">
              📍 {event.location_name}
              {event.location_address && event.location_address !== event.location_name && (
                <span className="block text-gray-400 text-xs ml-5">{event.location_address}</span>
              )}
            </div>
          )}

          <div className="text-sm text-gray-500 mb-4">
            Hosted by{' '}
            <a href={org.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {org.name}
            </a>
          </div>

          {/* Badges */}
          {(price || age || event.is_recurring) && (
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                {price && (
                  <span className="inline-block text-sm px-3 py-1 rounded-full font-medium" style={{ backgroundColor: price.bg, color: price.color }}>
                    {price.content}
                  </span>
                )}
                {age && (
                  <span className="inline-block text-sm px-3 py-1 rounded-full font-medium" style={{ backgroundColor: age.bg, color: age.color }}>
                    {age.content}
                  </span>
                )}
                {event.is_recurring && (
                  <span
                    className="inline-block text-xs px-3 py-1 rounded-full font-medium border"
                    style={{ backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-periwinkle)' }}
                  >
                    ↻ Recurring
                  </span>
                )}
              </div>
              {disclosure && <div className="mt-1 text-xs text-gray-400">{disclosure}</div>}
            </div>
          )}

          {event.registration_required && (
            <div className="rounded-lg p-3 mb-4 text-sm font-semibold flex items-center gap-2" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
              📋 Registration required — sign up before attending
            </div>
          )}

          {event.description && (
            <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-line mb-6">{event.description}</div>
          )}

          {/* Actions — all server-rendered anchors so the page is fully functional without JS */}
          <div className="flex flex-col gap-2">
            <a
              href={event.event_url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              View original event details →
            </a>
            <a
              href={gcalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              📅 Add to Google Calendar
            </a>
            {(event.location_address || event.location_name) && (
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.location_address ?? event.location_name ?? '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-center py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                🗺️ Get directions
              </a>
            )}
          </div>
        </article>

        <footer className="mt-8 pt-6 border-t text-sm" style={{ borderColor: 'var(--color-border)' }}>
          <Link href={`/${city}`} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
            Browse more free kids events in {city === 'plano' ? 'Plano' : 'Frisco'} →
          </Link>
        </footer>
      </main>
    </div>
  )
}
