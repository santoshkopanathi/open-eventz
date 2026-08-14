import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Event } from '@/lib/types'
import { getEventById } from '@/lib/seo-data'
import { isIndexableEvent, startOfTodayCtIso } from '@/lib/seo-indexable'
import { buildEventJsonLd } from '@/lib/event-jsonld'
import { eventUrl, sourceCity, sourceOrg, sourceShortLabel } from '@/lib/site'
import { detailPriceBadge } from '@/lib/price'
import { detailAgeBadge } from '@/lib/age-badge'
import { inferenceDisclosure } from '@/lib/inference-disclosure'
import SupervisionCallout from '@/components/SupervisionCallout'

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

  const cityLabel = city === 'plano' ? 'Plano' : 'Frisco'
  // Bordered secondary — matches the in-app detail's secondary actions. Ink fill is reserved
  // for the masthead and the single primary CTA (Get directions), so it stays meaningful.
  const secondaryStyle = { borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border-strong)', color: 'var(--color-ink)' }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-paper)', color: 'var(--color-ink)' }}>
      {/* JSON-LD structured data — the Event rich-result source */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Masthead — same ink band + rust rule + two-colour wordmark as the home page and the
          mobile detail overlay. A shared link is often someone's first ever view of the
          product, so it has to read as the same product, not a stray page. */}
      <header className="masthead flex items-center" style={{ backgroundColor: '#1F1B16', borderBottom: '3px solid #B4623B', padding: '16px 20px' }}>
        <Link href="/" className="flex flex-col gap-0.5 w-fit min-w-0">
          <span className="font-display leading-none whitespace-nowrap text-[28px]" style={{ letterSpacing: '-0.015em' }}>
            <span style={{ color: '#FBF7F1' }}>Open </span><span style={{ color: '#E8A87C' }}>Eventz</span>
          </span>
          <span className="font-mono uppercase whitespace-nowrap text-[9.5px] tracking-[0.1em]" style={{ color: '#A79C8B' }}>
            Free things to do with kids · Frisco &amp; Plano
          </span>
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6">
        {/* Two clear exits — matters for someone arriving on a shared link: back into the
            main app (on this event's city), and to this city's full event list. */}
        <nav className="mb-5 flex flex-wrap gap-2">
          <Link href={`/?city=${city}`} className="px-4 py-2 text-sm font-medium transition-colors" style={secondaryStyle}>
            Open Eventz home
          </Link>
          <Link href={`/${city}`} className="px-4 py-2 text-sm font-medium transition-colors" style={secondaryStyle}>
            View all {cityLabel} events
          </Link>
        </nav>

        <article>
          {/* Source kicker — same mono/rust treatment as the in-app detail panel */}
          <div className="font-mono uppercase mb-2" style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--color-accent)' }}>
            {sourceShortLabel(event.source)}
          </div>

          {/* Hero image (category banner from the source), hotlinked — omitted when absent.
              No onError fallback here: this is a server component, so a broken URL would
              leave an empty box. Extraction is URL-encoded at ingest, which is what keeps
              these loading (BUILD-LOG 2026-08-13). */}
          {event.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.thumbnail_url}
              alt=""
              className="w-full object-cover mb-4"
              style={{ height: '150px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)' }}
            />
          )}

          <h1 className="font-display leading-tight mb-3" style={{ fontSize: '34px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
            {event.title}
          </h1>

          <div className="mb-2" style={{ fontSize: '15px', color: 'var(--color-ink-70)' }}>{formatWhen(event)}</div>

          {event.location_name && (
            <div className="mb-3" style={{ fontSize: '15px', color: 'var(--color-ink-70)' }}>
              {event.location_name}
              {event.location_address && event.location_address !== event.location_name && (
                <span className="block" style={{ fontSize: '13px', color: 'var(--color-ink-35)' }}>{event.location_address}</span>
              )}
            </div>
          )}

          <div className="mb-4" style={{ fontSize: '13px', color: 'var(--color-ink-35)' }}>
            Hosted by{' '}
            <a href={org.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--color-accent-text)' }}>
              {org.name}
            </a>
          </div>

          {/* Chip row — age, price, recurring (same order and treatment as the detail panel) */}
          {(price || age || event.is_recurring) && (
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                {age && (
                  <span className="inline-block font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: age.bg, color: age.color }}>
                    {age.content}
                  </span>
                )}
                {price && (
                  <span className="inline-block font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: price.bg, color: price.color }}>
                    {price.content}
                  </span>
                )}
                {event.is_recurring && (
                  <span className="inline-block font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-fill-subtle)', color: 'var(--color-ink-50)' }}>
                    Recurring
                  </span>
                )}
              </div>
              {disclosure && (
                <div className="mt-1.5" style={{ fontSize: '12px', color: 'var(--color-ink-35)' }}>{disclosure}</div>
              )}
            </div>
          )}

          {event.registration_required && (
            <div className="mb-3 flex gap-2.5 items-center" style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-accent-tint-border)', backgroundColor: 'var(--color-accent-tint)', padding: '9px 12px' }}>
              <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'var(--color-accent)', flexShrink: 0 }} />
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-accent-text)' }}>Registration required — sign up before attending</div>
            </div>
          )}

          {/* Supervision "can kids be dropped off?" — the differentiating signal. It had only
              ever rendered in the in-app detail panel, so a shared link (often a parent's
              first view) was missing the one answer they most need. */}
          <SupervisionCallout event={event} className="mb-4" />

          {event.description && (
            <div className="whitespace-pre-line mb-6" style={{ fontSize: '15px', lineHeight: 1.65, color: 'var(--color-ink-body)' }}>
              {event.description}
            </div>
          )}

          {/* Actions — all server-rendered anchors so the page is fully functional without JS.
              Same set and order as the in-app detail panel; Get directions is the one primary. */}
          <div className="flex flex-col gap-2">
            <a
              href={gcalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center py-2.5 text-sm font-medium transition-colors"
              style={secondaryStyle}
            >
              Add to Google Calendar
            </a>
            <a
              href={`/api/ics/${event.id}`}
              // Same-tab on purpose: iOS shows the Add-to-Calendar overlay without navigating
              // away, and desktop downloads the .ics without navigating.
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors"
              style={secondaryStyle}
            >
              <svg viewBox="0 0 814 1000" width="14" height="14" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-127.4C46 790.7 0 663 0 541.8c0-207.8 135.4-317.8 268.5-317.8 69.2 0 126.9 45.7 170.1 45.7 41.8 0 108.8-48.4 188.4-48.4 30.5 0 138.5 2.6 207.8 99.2zm-156-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
              </svg>
              Add to Apple Calendar
            </a>
            <a
              href={event.event_url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center py-2.5 text-sm font-medium transition-colors"
              style={secondaryStyle}
            >
              View on {sourceShortLabel(event.source)} ↗
            </a>
            {(event.location_address || event.location_name) && (
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.location_address ?? event.location_name ?? '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-center py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-ink)', color: 'var(--color-paper)' }}
              >
                Get directions
              </a>
            )}
          </div>
        </article>
      </main>
    </div>
  )
}
