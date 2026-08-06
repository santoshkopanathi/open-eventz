'use client'

import type { Event } from '@/lib/types'
import { cardAgeBadge } from '@/lib/age-badge'
import { cardPriceBadge } from '@/lib/price'

const TZ = 'America/Chicago'

function formatLocation(locationName: string, source: string): string {
  const city = source === 'plano-library' ? 'Plano' : 'Frisco'
  const venueName = locationName.split(/\s*[-–]\s*\d/)[0].trim()
  if (!venueName) return city
  return `${venueName}, ${city}`
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
}

function isMultiDay(start: string, end: string | null) {
  if (!end) return false
  const s = new Date(start).toLocaleDateString('en-US', { timeZone: TZ })
  const e = new Date(end).toLocaleDateString('en-US', { timeZone: TZ })
  return s !== e
}

const CHIP: React.CSSProperties = { fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-chip)' }

interface Props {
  event: Event
  selected: boolean
  onClick: () => void
}

export default function EventCard({ event, selected, onClick }: Props) {
  const cardAge = cardAgeBadge(event)
  const cardPrice = cardPriceBadge(event)

  return (
    <a
      href={`/events/${event.id}`}
      onClick={(e) => {
        // Plain left-click opens the in-app detail panel; modifier / middle clicks fall
        // through so the browser can open the event's own page in a new tab or copy its link.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return
        e.preventDefault()
        onClick()
      }}
      className="block w-full text-left p-4 transition-all cursor-pointer"
      style={{
        borderRadius: 'var(--radius-input)',
        backgroundColor: selected ? 'var(--color-paper-sunken)' : 'var(--color-paper)',
        border: '1px solid var(--color-card-border)',
        boxShadow: selected ? 'inset 3px 0 0 var(--color-accent)' : 'none',
      }}
    >
      <div className="flex items-start gap-3.5">
        {/* Date stamp */}
        <div
          className="flex-shrink-0 w-12 flex flex-col items-center justify-center"
          style={{ minHeight: 56, padding: '10px 0', borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-fill-subtle)' }}
        >
          <span className="font-mono uppercase leading-none" style={{ fontSize: '10px', letterSpacing: '0.08em', color: 'var(--color-ink-35)' }}>
            {new Date(event.start_datetime).toLocaleDateString('en-US', { month: 'short', timeZone: TZ })}
          </span>
          <span className="font-bold leading-tight" style={{ fontSize: '18px', color: 'var(--color-ink)' }}>
            {new Date(event.start_datetime).toLocaleDateString('en-US', { day: 'numeric', timeZone: TZ })}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="leading-snug line-clamp-2" style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
            {event.title}
          </h3>

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="font-mono uppercase flex-shrink-0 whitespace-nowrap" style={{ fontSize: '13px', letterSpacing: '0.06em', color: 'var(--color-ink-70)' }}>
              {isMultiDay(event.start_datetime, event.end_datetime ?? null)
                ? `${formatShortDate(event.start_datetime)} – ${formatShortDate(event.end_datetime!)} · All day`
                : formatTime(event.start_datetime)}
            </span>
            {/* Badge group — can shrink and wrap so it never overflows the card (min-w-0). */}
            <div className="min-w-0 flex flex-wrap items-center justify-end gap-1.5">
              {cardAge && (
                <span className="font-medium whitespace-nowrap" style={{ ...CHIP, backgroundColor: cardAge.bg, color: cardAge.color }} title={cardAge.tooltip}>
                  {cardAge.content}
                </span>
              )}
              {cardPrice && (
                <span className="font-medium whitespace-nowrap" style={{ ...CHIP, backgroundColor: cardPrice.bg, color: cardPrice.color }} title={cardPrice.tooltip}>
                  {cardPrice.content}
                </span>
              )}
              {event.registration_required && (
                <span className="font-medium whitespace-nowrap inline-flex items-center" style={{ ...CHIP, backgroundColor: 'var(--color-accent-tint)', color: 'var(--color-accent-text)' }} title="Registration required" aria-label="Registration required">
                  {/* mobile: icon only; sm+: full text */}
                  <svg className="sm:hidden" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>
                  <span className="hidden sm:inline">Registration</span>
                </span>
              )}
              {event.is_recurring && (
                <span className="font-medium whitespace-nowrap inline-flex items-center" style={{ ...CHIP, backgroundColor: 'var(--color-fill-subtle)', color: 'var(--color-ink-50)' }} title="Recurring event" aria-label="Recurring event">
                  <svg className="sm:hidden" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                  <span className="hidden sm:inline">Recurring</span>
                </span>
              )}
            </div>
          </div>
          {event.location_name && (
            <div className="mt-1" style={{ fontSize: '13px', color: 'var(--color-ink-70)' }}>
              {formatLocation(event.location_name, event.source)}
            </div>
          )}
        </div>
      </div>
    </a>
  )
}
