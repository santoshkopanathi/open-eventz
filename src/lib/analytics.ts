// GA4 analytics — a thin, SSR-safe wrapper around gtag (v1.2 analytics spec, Part 1).
// Every call no-ops on the server and when GA is not configured (no Measurement ID),
// so callers never need to guard. The base tag is loaded in app/layout.tsx via next/script.

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

// The 7 custom events from the spec's Instrumentation requirements table. `session_start`
// (the funnel's top step) is GA4-automatic and deliberately NOT listed here; the acquisition
// channel (source/medium) also rides on session_start automatically, so it is not per-event.
export type AnalyticsEvent =
  | 'filter_applied'   // Engaged  — any filter dropdown selection changes
  | 'event_card_click' // Engaged  — an event card tapped in the list
  | 'detail_view'      // Intent   — event detail panel opens
  | 'directions_tap'   // Intent   — Get Directions tapped
  | 'calendar_add'     // Converted — Add to Google/Apple Calendar OR ICS download
  | 'attending_tap'    // Converted — Attending tapped (toggle-ON only)
  | 'share_tap'        // Referral  — Share tapped (outside the funnel)

type GtagFn = (command: 'event' | 'config' | 'js', ...args: unknown[]) => void

function getGtag(): GtagFn | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { gtag?: GtagFn }
  return typeof w.gtag === 'function' ? w.gtag : null
}

/**
 * Fire a GA4 custom event. Safe to call anywhere — no-ops on the server and when GA is
 * not configured. Keep `params` to small, low-cardinality values (GA4 event parameters).
 */
export function trackEvent(
  event: AnalyticsEvent,
  params?: Record<string, string | number | boolean>
): void {
  const gtag = getGtag()
  if (!gtag) return
  gtag('event', event, params ?? {})
}
