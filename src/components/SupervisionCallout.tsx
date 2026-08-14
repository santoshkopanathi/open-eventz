import type { Event } from '@/lib/types'
import { getSupervisionBadge } from '@/lib/supervision'

/**
 * The "can kids be dropped off?" callout — the product's differentiating signal.
 *
 * Deliberately a SHARED component rather than markup copied per surface. The badge has
 * already gone missing once (silently narrowed to Frisco-only in a pre-git refactor, shipped
 * blank for weeks — BUILD-LOG "Learning 5"), and it was missing from the `/events/[id]`
 * server page from the day that page shipped. One component means a detail surface either
 * renders the badge for every source or renders it for none — it can't drift per source or
 * per surface. Which surfaces must include it is asserted by supervision-surfaces.test.ts.
 *
 * Presentation follows the Weekend Paper rule for this field: a calm fill-subtle box with a
 * grey left bar — instruction, not alarm. No red-on-pink, no emoji. A wrong "you can drop
 * off" answer must never be dressed in reassuring colour; the words carry the meaning.
 *
 * No 'use client' — it's pure presentation, so it renders in both the client drawer and the
 * server-rendered event page.
 */
export default function SupervisionCallout({ event, className }: { event: Event; className?: string }) {
  const badge = getSupervisionBadge(event)
  if (!badge) return null

  return (
    <div
      className={`flex gap-2.5 ${className ?? ''}`}
      style={{
        borderRadius: 'var(--radius-input)',
        border: '1px solid var(--color-border)',
        backgroundColor: badge.bg,
        padding: '9px 12px',
      }}
    >
      <div style={{ width: 3, borderRadius: 2, backgroundColor: 'var(--color-border-strong)', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: badge.text }}>{badge.label}</div>
        {badge.sub && <div className="mt-0.5" style={{ fontSize: '11px', color: 'var(--color-ink-50)' }}>{badge.sub}</div>}
      </div>
    </div>
  )
}
