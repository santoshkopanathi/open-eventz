'use client'

import { useEffect, useState } from 'react'
import type { Event } from '@/lib/types'
import { detailAgeBadge } from '@/lib/age-badge'
import { detailPriceBadge } from '@/lib/price'
import { inferenceDisclosure } from '@/lib/inference-disclosure'
import { trackEvent } from '@/lib/analytics'

interface SupervisionBadge {
  bg: string
  text: string
  label: string
}

function getFriscoSupervision(ageMin: number | null, ageMax: number | null): SupervisionBadge {
  // Teens (13+) — no adult required
  if (ageMin !== null && ageMin >= 13) {
    return { bg: '#D1FAE5', text: '#065F46', label: '✅ Can kids be dropped off? Yes — teens 13+ may attend alone' }
  }
  // Toddlers / young kids only (age_max ≤ 9) — adult must stay
  if (ageMax !== null && ageMax <= 9) {
    return { bg: '#FEE2E2', text: '#991B1B', label: '❌ Can kids be dropped off? No — adult must stay with child' }
  }
  // Mixed 6–12 group — straddles the 10-year policy threshold
  if (ageMin !== null && ageMax !== null) {
    return { bg: '#DBEAFE', text: '#1E40AF', label: '🔵 Can kids be dropped off? Only if child is 10 or older (Frisco Library policy)' }
  }
  // Unknown age data
  return { bg: '#F3F4F6', text: '#374151', label: '⚠️ Can kids be dropped off? Check with Frisco Library' }
}

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

  const supervisionBadge = event.source === 'frisco-library'
    ? getFriscoSupervision(event.age_min ?? null, event.age_max ?? null)
    : null

  const detailAge = detailAgeBadge(event)
  const detailPrice = detailPriceBadge(event)
  const disclosure = inferenceDisclosure(event)

  const fmtGcal = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const locationStr = [event.location_name, event.location_address].filter(Boolean).join(', ')

  const downloadIcs = () => {
    // calendar_add — "Add to Apple Calendar" is the ICS download (Converted step)
    trackEvent('calendar_add', { method: 'ics', source: event.source, event_id: event.id })
    const fmt = (iso: string) => fmtGcal(iso)
    const start = fmt(event.start_datetime)
    const end = event.end_datetime ? fmt(event.end_datetime) : start
    const description = [event.description, event.event_url].filter(Boolean).join('\n\nMore info: ')
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Open Eventz//EN',
      'BEGIN:VEVENT',
      `UID:${event.id}@openeventz`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
      `LOCATION:${locationStr}`,
      `URL:${event.event_url}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${event.title.slice(0, 40).replace(/[^a-z0-9]/gi, '-')}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-5">
      {/* Title row */}
      <div className="flex justify-between items-start mb-4">
        <h2 className="font-bold text-lg leading-snug pr-4" style={{ color: 'var(--color-text)' }}>
          {event.title}
        </h2>
        {!hideClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl flex-shrink-0">✕</button>
        )}
      </div>

      {/* Date & time */}
      <div className="text-sm text-gray-600 mb-3">
        {(() => {
          const startDay = new Date(event.start_datetime).toLocaleDateString('en-US', { timeZone: TZ })
          const endDay = event.end_datetime ? new Date(event.end_datetime).toLocaleDateString('en-US', { timeZone: TZ }) : null
          const multiDay = endDay && startDay !== endDay
          if (multiDay) {
            const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ })
            return <span>📅 {fmtDate(event.start_datetime)} – {fmtDate(event.end_datetime!)} · All day</span>
          }
          return (
            <span>
              📅 {formatDateTime(event.start_datetime)}
              {event.end_datetime && (
                <span> – {new Date(event.end_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}</span>
              )}
            </span>
          )
        })()}
      </div>

      {/* Location */}
      {event.location_name && (
        <div className="text-sm text-gray-600 mb-3">
          📍 {event.location_name}
          {event.location_address && event.location_address !== event.location_name && (
            <span className="block text-gray-400 text-xs ml-5">{event.location_address}</span>
          )}
        </div>
      )}

      {/* Chip row — price, age, recurring (Sections 2, 6, 7) */}
      {(detailPrice || detailAge || event.is_recurring) && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            {detailPrice && (
              <span
                className="inline-block text-sm px-3 py-1 rounded-full font-medium"
                style={{ backgroundColor: detailPrice.bg, color: detailPrice.color }}
              >
                {detailPrice.content}
              </span>
            )}
            {detailAge && (
              <span
                className="inline-block text-sm px-3 py-1 rounded-full font-medium"
                style={{ backgroundColor: detailAge.bg, color: detailAge.color }}
              >
                {detailAge.content}
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
          {/* Single combined inference disclosure — age + price merged into one line (Definition A) */}
          {disclosure && (
            <div className="mt-1 text-xs text-gray-400">{disclosure}</div>
          )}
        </div>
      )}

      {/* Registration required */}
      {event.registration_required && (
        <div className="rounded-lg p-3 mb-4 text-sm font-semibold flex items-center gap-2" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
          📋 Registration required — sign up before attending
        </div>
      )}

      {/* Supervision badge — Frisco Library only */}
      {supervisionBadge && (
        <div className="rounded-lg px-3 py-2 mb-4 text-xs font-semibold" style={{ backgroundColor: supervisionBadge.bg, color: supervisionBadge.text }}>
          {supervisionBadge.label}
        </div>
      )}

      {event.description && (
        <div className="mb-4">
          <div
            className="text-sm text-gray-600 leading-relaxed whitespace-pre-line overflow-hidden"
            style={descExpanded ? undefined : { display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {event.description}
          </div>
          {event.description.split('\n').length > 10 || event.description.length > 600 ? (
            <button
              onClick={() => setDescExpanded(e => !e)}
              className="mt-1 text-xs font-medium"
              style={{ color: 'var(--color-primary)' }}
            >
              {descExpanded ? 'Show less ▲' : 'Show more ▼'}
            </button>
          ) : null}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 mb-4">
        <a
          href={event.event_url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full text-center py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          View event details →
        </a>
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
          className="w-full text-center py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50 flex items-center justify-center gap-2"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          📅 Add to Google Calendar
        </a>
        <button
          onClick={downloadIcs}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <svg viewBox="0 0 814 1000" width="14" height="14" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-127.4C46 790.7 0 663 0 541.8c0-207.8 135.4-317.8 268.5-317.8 69.2 0 126.9 45.7 170.1 45.7 41.8 0 108.8-48.4 188.4-48.4 30.5 0 138.5 2.6 207.8 99.2zm-156-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
          </svg>
          Add to Apple Calendar
        </button>
        {(event.location_address || event.location_name) && (
          onGetDirections ? (
            <button
              onClick={() => { trackEvent('directions_tap', { source: event.source, event_id: event.id }); onGetDirections() }}
              className="w-full text-center py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              🗺️ Get directions
            </button>
          ) : (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(event.location_address ?? event.location_name ?? '')}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('directions_tap', { source: event.source, event_id: event.id })}
              className="w-full text-center py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              🗺️ Get directions
            </a>
          )
        )}
      </div>

      {/* Like + Share */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleLike}
          className="flex items-center gap-2 text-sm transition-opacity"
          style={{ color: liked ? '#2D7A3A' : 'var(--color-periwinkle)', opacity: liked ? 1 : 0.7 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
          <span>{liked ? 'Attending' : 'Attending?'}</span>
          {likes !== null && <span className="text-gray-400">· {likes}</span>}
        </button>

        <button
          onClick={async () => {
            // share_tap — tracked outside the funnel (Referral)
            trackEvent('share_tap', { source: event.source, event_id: event.id })
            const shareData = {
              title: event.title,
              text: `${event.title} — ${new Date(event.start_datetime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' })}`,
              url: event.event_url,
            }
            if (navigator.share) {
              await navigator.share(shareData)
            } else {
              await navigator.clipboard.writeText(event.event_url)
              alert('Link copied to clipboard!')
            }
          }}
          className="flex items-center gap-2 text-sm transition-opacity"
          style={{ color: 'var(--color-periwinkle)', opacity: 0.7 }}
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
