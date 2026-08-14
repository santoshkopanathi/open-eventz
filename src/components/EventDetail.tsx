'use client'

import { useEffect, useState } from 'react'
import type { Event } from '@/lib/types'
import { detailAgeBadge } from '@/lib/age-badge'
import SupervisionCallout from './SupervisionCallout'
import { detailPriceBadge } from '@/lib/price'
import { inferenceDisclosure } from '@/lib/inference-disclosure'
import { trackEvent } from '@/lib/analytics'
import { eventUrl, sourceShortLabel } from '@/lib/site'

const TZ = 'America/Chicago'

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
}

interface Props {
  event: Event
  onClose: () => void
  hideClose?: boolean
  onGetDirections?: () => void
}

export default function EventDetail({ event, onClose, hideClose, onGetDirections }: Props) {
  const [likes, setLikes] = useState<number | null>(null)
  const [liked, setLiked] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)

  useEffect(() => {
    setLiked(localStorage.getItem(`attending_${event.id}`) === '1')
    fetch(`/api/likes/${event.id}`)
      .then(r => r.json())
      .then(d => setLikes(d.count))
  }, [event.id])

  const handleLike = async () => {
    const nowLiked = !liked
    setLiked(nowLiked)
    if (nowLiked) {
      localStorage.setItem(`attending_${event.id}`, '1')
      // attending_tap — toggle-ON only (Converted step); never on un-attend
      trackEvent('attending_tap', { source: event.source, event_id: event.id })
    } else {
      localStorage.removeItem(`attending_${event.id}`)
    }
    const res = await fetch(`/api/likes/${event.id}`, { method: 'POST', body: JSON.stringify({ unlike: !nowLiked }), headers: { 'Content-Type': 'application/json' } })
    const data = await res.json()
    setLikes(data.count)
  }

  const detailAge = detailAgeBadge(event)
  const detailPrice = detailPriceBadge(event)
  const disclosure = inferenceDisclosure(event)

  const fmtGcal = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const locationStr = [event.location_name, event.location_address].filter(Boolean).join(', ')

  const secondaryStyle: React.CSSProperties = { borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border-strong)', color: 'var(--color-ink)' }

  return (
    <div className="p-6">
      {/* Source kicker */}
      <div className="font-mono uppercase mb-2" style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--color-accent)' }}>
        {sourceShortLabel(event.source)}
      </div>

      {/* Hero image (category banner from the source) — detail view only; hotlinked, and hidden
          if absent or if it fails to load, so a missing image never leaves a broken box. */}
      {event.thumbnail_url && (
        <img
          src={event.thumbnail_url}
          alt=""
          loading="lazy"
          className="w-full mb-4 object-cover"
          style={{ height: '150px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)' }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}

      {/* Title row */}
      <div className="flex justify-between items-start mb-4 gap-3">
        <h2 className="font-display leading-tight" style={{ fontSize: '30px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
          {event.title}
        </h2>
        {!hideClose && (
          <button onClick={onClose} aria-label="Close" className="flex-shrink-0 flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', color: 'var(--color-ink-50)' }}>✕</button>
        )}
      </div>

      {/* Date & time */}
      <div className="mb-2" style={{ fontSize: '15px', color: 'var(--color-ink-70)' }}>
        {(() => {
          const startDay = new Date(event.start_datetime).toLocaleDateString('en-US', { timeZone: TZ })
          const endDay = event.end_datetime ? new Date(event.end_datetime).toLocaleDateString('en-US', { timeZone: TZ }) : null
          const multiDay = endDay && startDay !== endDay
          if (multiDay) {
            const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ })
            return <span>{fmtDate(event.start_datetime)} – {fmtDate(event.end_datetime!)} · All day</span>
          }
          return (
            <span>
              {formatDateTime(event.start_datetime)}
              {event.end_datetime && (
                <span> – {new Date(event.end_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}</span>
              )}
            </span>
          )
        })()}
      </div>

      {/* Location */}
      {event.location_name && (
        <div className="mb-4" style={{ fontSize: '15px', color: 'var(--color-ink-70)' }}>
          {event.location_name}
          {event.location_address && event.location_address !== event.location_name && (
            <span className="block" style={{ fontSize: '13px', color: 'var(--color-ink-35)' }}>{event.location_address}</span>
          )}
        </div>
      )}

      {/* Chip row — price, age, recurring (Sections 2, 6, 7) */}
      {(detailPrice || detailAge || event.is_recurring) && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            {detailAge && (
              <span className="inline-block font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: detailAge.bg, color: detailAge.color }}>
                {detailAge.content}
              </span>
            )}
            {detailPrice && (
              <span className="inline-block font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: detailPrice.bg, color: detailPrice.color }}>
                {detailPrice.content}
              </span>
            )}
            {event.is_recurring && (
              <span className="inline-block font-medium" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-fill-subtle)', color: 'var(--color-ink-50)' }}>
                Recurring
              </span>
            )}
          </div>
          {/* Single combined inference disclosure — age + price merged into one line (Definition A) */}
          {disclosure && (
            <div className="mt-1.5" style={{ fontSize: '12px', color: 'var(--color-ink-35)' }}>{disclosure}</div>
          )}
        </div>
      )}

      {/* Registration callout — compact, chip-sized text (12px), same box as the supervision callout */}
      {event.registration_required && (
        <div className="mb-3 flex gap-2.5 items-center" style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-accent-tint-border)', backgroundColor: 'var(--color-accent-tint)', padding: '9px 12px' }}>
          <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'var(--color-accent)', flexShrink: 0 }} />
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-accent-text)' }}>Registration required — sign up before attending</div>
        </div>
      )}

      {/* Supervision "can kids be dropped off?" callout — all sources (src/lib/supervision.ts),
          shared with the /events/[id] server page so the two detail surfaces can't drift. */}
      <SupervisionCallout event={event} className="mb-3" />

      {event.description && (
        <div className="mb-5">
          <div
            className="whitespace-pre-line overflow-hidden"
            style={{ fontSize: '15px', lineHeight: 1.65, color: 'var(--color-ink-body)', ...(descExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical' as const }) }}
          >
            {event.description}
          </div>
          {event.description.split('\n').length > 10 || event.description.length > 600 ? (
            <button
              onClick={() => setDescExpanded(e => !e)}
              className="mt-1.5 font-medium"
              style={{ fontSize: '13px', color: 'var(--color-accent)' }}
            >
              {descExpanded ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      )}

      {/* Actions — calendars, then "View on source" (secondary), then "Get directions" (primary) */}
      <div className="flex flex-col gap-2 mb-5">
        <a
          href={(() => {
            const start = fmtGcal(event.start_datetime)
            const end = event.end_datetime ? fmtGcal(event.end_datetime) : start
            const description = [event.description, event.event_url].filter(Boolean).join('\n\nMore info: ')
            const params = new URLSearchParams({
              action: 'TEMPLATE',
              text: event.title,
              dates: `${start}/${end}`,
              details: description,
              location: locationStr,
            })
            return `https://calendar.google.com/calendar/render?${params}`
          })()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent('calendar_add', { method: 'google', source: event.source, event_id: event.id })}
          className="w-full text-center py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={secondaryStyle}
        >
          Add to Google Calendar
        </a>
        <a
          href={`/api/ics/${event.id}`}
          // Same-tab on purpose: iOS shows the Add-to-Calendar overlay without navigating
          // away (no leftover blank tab), and desktop downloads the .ics without navigating.
          // Opening in a new tab (target="_blank") left a stray about:blank tab on iOS.
          onClick={() => trackEvent('calendar_add', { method: 'ics', source: event.source, event_id: event.id })}
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
          className="w-full text-center py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={secondaryStyle}
        >
          View on {sourceShortLabel(event.source)} ↗
        </a>
        {(event.location_address || event.location_name) && (
          onGetDirections ? (
            <button
              onClick={() => { trackEvent('directions_tap', { source: event.source, event_id: event.id }); onGetDirections() }}
              className="w-full text-center py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-ink)', color: 'var(--color-paper)' }}
            >
              Get directions
            </button>
          ) : (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(event.location_address ?? event.location_name ?? '')}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('directions_tap', { source: event.source, event_id: event.id })}
              className="w-full text-center py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-ink)', color: 'var(--color-paper)' }}
            >
              Get directions
            </a>
          )
        )}
      </div>

      {/* Like + Share */}
      <div className="flex items-center gap-4 pt-4" style={{ borderTop: '1px solid var(--color-rule)' }}>
        <button
          onClick={handleLike}
          className="flex items-center gap-2 text-sm transition-opacity"
          style={{ color: liked ? 'var(--color-accent)' : 'var(--color-ink-50)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
          <span>{liked ? 'Attending' : 'Attending?'}</span>
          {likes !== null && <span style={{ color: 'var(--color-ink-35)' }}>· {likes}</span>}
        </button>

        <button
          onClick={async () => {
            // share_tap — tracked outside the funnel (Referral)
            trackEvent('share_tap', { source: event.source, event_id: event.id })
            const shareUrl = eventUrl(event.id)
            const shareData = {
              title: event.title,
              text: `${event.title} — ${new Date(event.start_datetime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' })}`,
              url: shareUrl,
            }
            if (navigator.share) {
              await navigator.share(shareData)
            } else {
              await navigator.clipboard.writeText(shareUrl)
              alert('Link copied to clipboard!')
            }
          }}
          className="flex items-center gap-2 text-sm transition-opacity"
          style={{ color: 'var(--color-ink-50)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span>Share</span>
        </button>
      </div>
    </div>
  )
}
