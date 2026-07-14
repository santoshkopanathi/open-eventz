'use client'

import type { Event } from '@/lib/types'
import { cardAgeBadge } from '@/lib/age-badge'

const SOURCE_LABELS: Record<string, string> = {
  'frisco-library': 'Frisco Library',
  'plano-library': 'Plano Libraries',
  'play-frisco': 'Play Frisco',
}

const CATEGORY_EMOJI: Record<string, string> = {
  library: '📚',
  'parks-rec': '🌳',
  arts: '🎨',
  stem: '🔬',
  sports: '⚽',
  music: '🎵',
}

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

interface Props {
  event: Event
  selected: boolean
  onClick: () => void
}

export default function EventCard({ event, selected, onClick }: Props) {
  const emoji = CATEGORY_EMOJI[event.category ?? ''] ?? '🎉'
  const cardAge = cardAgeBadge(event)

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-4 border transition-all hover:shadow-md"
      style={{
        backgroundColor: selected ? 'var(--color-primary-light)' : 'var(--color-card)',
        borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
        borderWidth: selected ? '2px' : '1px',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Date stamp */}
        <div
          className="flex-shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <span className="text-xs font-semibold uppercase leading-none">
            {new Date(event.start_datetime).toLocaleDateString('en-US', { month: 'short', timeZone: TZ })}
          </span>
          <span className="text-xl font-bold leading-tight">
            {new Date(event.start_datetime).toLocaleDateString('en-US', { day: 'numeric', timeZone: TZ })}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2">
            {emoji} {event.title}
          </h3>

          <div className="mt-1 text-xs text-gray-500">
            <div className="flex items-center justify-between gap-2">
              {isMultiDay(event.start_datetime, event.end_datetime ?? null)
                ? <span className="whitespace-nowrap">📅 {formatShortDate(event.start_datetime)} – {formatShortDate(event.end_datetime!)} · All day</span>
                : <span className="whitespace-nowrap">🕐 {formatTime(event.start_datetime)}{event.end_datetime ? ` – ${formatTime(event.end_datetime)}` : ''}</span>
              }
              <div className="flex-shrink-0 flex flex-wrap items-center justify-end gap-1">
                {event.registration_required && (
                  <span className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                    📋 Reg.
                  </span>
                )}
                {event.is_free ? (
                  <span className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                    Free
                  </span>
                ) : event.price_text ? (
                  <span className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                    Paid
                  </span>
                ) : null}
                {cardAge && (
                  <span
                    className="px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                    style={{ backgroundColor: cardAge.bg, color: cardAge.color }}
                    title={cardAge.tooltip}
                  >
                    {cardAge.content}
                  </span>
                )}
                {event.is_recurring && (
                  <span
                    className="px-2 py-0.5 rounded-full font-medium border whitespace-nowrap"
                    style={{ backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-periwinkle)' }}
                  >
                    ↻ Recurring
                  </span>
                )}
              </div>
            </div>
            {event.location_name && <div className="mt-0.5">📍 {formatLocation(event.location_name, event.source)}</div>}
          </div>
        </div>
      </div>
    </button>
  )
}
