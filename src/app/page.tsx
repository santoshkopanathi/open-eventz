'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { Event, Venue } from '@/lib/types'
import EventCard from '@/components/EventCard'
import EventDetail from '@/components/EventDetail'
import FilterBar, { type City } from '@/components/FilterBar'
import SourceSubFilter, { type SubFilterPatch } from '@/components/SourceSubFilter'
import { trackEvent } from '@/lib/analytics'

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })

const PAGE_SIZE = 20

type FriscoState = { sources: string[]; ages: string[]; date_from: string; date_to: string }
type PlanoState = { branches: string[]; ages: string[]; date_from: string; date_to: string }

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// Default date window: today through today + 7 days (spec Section 1 / test 2.1.9)
function defaultDates() {
  const from = new Date()
  const to = new Date()
  to.setDate(to.getDate() + 7)
  return { date_from: ymd(from), date_to: ymd(to) }
}

export default function Home() {
  const [events, setEvents] = useState<Event[]>([])
  const [displayed, setDisplayed] = useState<Event[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Event | null>(null)
  const [mapOn, setMapOn] = useState(false)
  const [venues, setVenues] = useState<Venue[]>([])
  const [directionsTarget, setDirectionsTarget] = useState<Venue | null>(null)
  const [directionsKey, setDirectionsKey] = useState(0)
  // Distinct from "zero results": a failed request must never be reported as "no events match
  // your filters", which blames the user for our outage and sends them adjusting filters that
  // were never the problem. See GUARDRAILS.md fallback table.
  const [loadError, setLoadError] = useState(false)
  const [venuesError, setVenuesError] = useState(false)

  const fetchVenues = useCallback(async () => {
    try {
      const res = await fetch('/api/venues')
      if (!res.ok) throw new Error(String(res.status))
      const d = await res.json()
      setVenues(d.venues ?? [])
      setVenuesError(false)
    } catch {
      // The map degrades on its own; the event list is untouched.
      setVenuesError(true)
      trackEvent('error_shown', { surface: 'venues' })
    }
  }, [])

  useEffect(() => { fetchVenues() }, [fetchVenues])

  // Per-city filter state — each city retains its own selections across tab switches
  const [city, setCity] = useState<City>('frisco')
  const [frisco, setFrisco] = useState<FriscoState>(() => ({ sources: [], ages: [], ...defaultDates() }))
  const [plano, setPlano] = useState<PlanoState>(() => ({ branches: [], ages: [], ...defaultDates() }))

  // Deep-link: /?city=plano (or frisco) preselects the city — used by the "Open Eventz home"
  // link on shared event pages so a Plano event's link lands the app on Plano, not the default.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('city')
    if (c === 'plano' || c === 'frisco') setCity(c)
  }, [])

  const sentinelRef = useRef<HTMLDivElement>(null)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setPage(1)
    setSelected(null)
    const params = new URLSearchParams()

    if (city === 'frisco') {
      const srcs = frisco.sources.length ? frisco.sources : ['frisco-library', 'play-frisco', 'kaleidoscope-park']
      srcs.forEach(s => params.append('source', s))
      frisco.ages.forEach(a => params.append('age', a))
      if (frisco.date_from) params.set('date_from', frisco.date_from)
      if (frisco.date_to) params.set('date_to', frisco.date_to)
    } else {
      params.append('source', 'plano-library')
      plano.branches.forEach(b => params.append('branch', b))
      plano.ages.forEach(a => params.append('age', a))
      if (plano.date_from) params.set('date_from', plano.date_from)
      if (plano.date_to) params.set('date_to', plano.date_to)
    }

    try {
      const res = await fetch(`/api/events?${params.toString()}`)
      // A 500 must NOT fall through to `data.events ?? []` — an empty list is indistinguishable
      // from a genuine zero-result query, and the UI would blame the user's filters for it.
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const all = data.events ?? []
      setEvents(all)
      setDisplayed(all.slice(0, PAGE_SIZE))
      setLoadError(false)
    } catch {
      setEvents([])
      setDisplayed([])
      setLoadError(true)
      trackEvent('error_shown', { surface: 'events' })
    } finally {
      // In `finally` so a thrown fetch can never leave the spinner running forever.
      setLoading(false)
    }
  }, [city, frisco, plano])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  // detail_view — fires once each time the detail panel opens (Intent step). Kept here
  // (single page instance) rather than in EventDetail, which renders twice (desktop + mobile).
  useEffect(() => {
    if (selected) trackEvent('detail_view', { source: selected.source, event_id: selected.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const patchActive = (patch: SubFilterPatch) => {
    // filter_applied — any filter dropdown selection changes (Engaged step)
    trackEvent('filter_applied', { city, fields: Object.keys(patch).join(',') })
    if (city === 'frisco') setFrisco(f => ({ ...f, ...patch }))
    else setPlano(p => ({ ...p, ...patch }))
  }
  const clearActive = () => {
    if (city === 'frisco') setFrisco({ sources: [], ages: [], ...defaultDates() })
    else setPlano({ branches: [], ages: [], ...defaultDates() })
  }
  // Full reset to the initial home state — wired to the header logo/title (a "start over").
  // Distinct from the mobile "‹ Back" button, which returns to the current filtered list.
  const resetToHome = () => {
    setCity('frisco')
    setFrisco({ sources: [], ages: [], ...defaultDates() })
    setPlano({ branches: [], ages: [], ...defaultDates() })
    setSelected(null)
    setMapOn(false)
  }
  const active = city === 'frisco' ? frisco : plano
  // Whether the active city's filters differ from the default (empty selections + default
  // date window). Drives showing the "Clear filters" link only when there's something to clear.
  const def = defaultDates()
  const canClear =
    (city === 'frisco' ? frisco.sources.length > 0 : plano.branches.length > 0) ||
    active.ages.length > 0 ||
    active.date_from !== def.date_from ||
    active.date_to !== def.date_to

  // Infinite scroll: load next page when sentinel comes into view
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && displayed.length < events.length) {
        setPage(p => {
          const next = p + 1
          setDisplayed(events.slice(0, next * PAGE_SIZE))
          return next
        })
      }
    }, { threshold: 0.1 })

    const el = sentinelRef.current
    if (el) observer.observe(el)
    return () => { if (el) observer.unobserve(el) }
  }, [displayed.length, events])

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Top bar */}
      {/* Masthead — the only ink-filled surface on the page; 3px rust bottom rule is the trick */}
      <header className="masthead flex-shrink-0 flex items-center justify-between gap-6" style={{ backgroundColor: '#1F1B16', borderBottom: '3px solid #B4623B', padding: '22px 28px' }}>
        <button
          type="button"
          onClick={resetToHome}
          className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-4 text-left cursor-pointer min-w-0"
          aria-label="Open Eventz home — reset filters and show all events"
        >
          <span className="font-display leading-none whitespace-nowrap text-[34px] max-[640px]:text-[30px]" style={{ letterSpacing: '-0.015em' }}>
            <span style={{ color: '#FBF7F1' }}>Open </span><span style={{ color: '#E8A87C' }}>Eventz</span>
          </span>
          <span className="font-mono uppercase whitespace-nowrap text-[11px] tracking-[0.14em] max-[430px]:text-[9.5px] max-[430px]:tracking-[0.07em]" style={{ color: '#A79C8B' }}>Free things to do with kids · Frisco &amp; Plano</span>
        </button>
      </header>

      <FilterBar city={city} onCityChange={setCity} mapOn={mapOn} onToggleMap={() => setMapOn(m => !m)} />

      {/* Main content — fixed height, scrolls internally */}
      <div className="flex flex-1 min-h-0">
        {/* Event list — narrower when nothing selected and map off */}
        <main
          className="overflow-y-auto p-4 border-r flex-shrink-0 max-w-full"
          style={{
            borderColor: 'var(--color-border)',
            width: !selected && !mapOn ? '760px' : undefined,
            flex: !selected && !mapOn ? 'none' : 1,
          }}
        >
          <SourceSubFilter
            city={city}
            sources={city === 'frisco' ? frisco.sources : []}
            branches={city === 'plano' ? plano.branches : []}
            ages={active.ages}
            date_from={active.date_from}
            date_to={active.date_to}
            canClear={canClear}
            onPatch={patchActive}
            onClear={clearActive}
          />

          {loading ? (
            <div className="flex items-center justify-center h-48">
              <p className="font-mono uppercase" style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--color-ink-35)' }}>Loading events…</p>
            </div>
          ) : loadError ? (
            /* Failure to LOAD is a different state from a genuine zero-result query, and gets a
               different message and a different action. Calm accent-tint callout, same treatment
               as 'Registration required' — instruction, not alarm. Filters are left untouched. */
            <div className="flex items-center justify-center h-48">
              <div
                className="flex gap-2.5 items-start max-w-md"
                style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-accent-tint-border)', backgroundColor: 'var(--color-accent-tint)', padding: '12px 14px' }}
                role="alert"
              >
                <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'var(--color-accent)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-accent-text)' }}>
                    We couldn&rsquo;t load events right now.
                  </div>
                  <button
                    onClick={() => fetchEvents()}
                    className="mt-2 text-sm font-medium px-3 py-1.5"
                    style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border-strong)', color: 'var(--color-ink)', backgroundColor: 'var(--color-paper)' }}
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-center">
                <p style={{ color: 'var(--color-ink-70)' }}>No events match your filters.</p>
                <button
                  onClick={clearActive}
                  className="mt-3 text-sm underline"
                  style={{ color: 'var(--color-accent)' }}
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3 font-mono uppercase" style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--color-ink-35)' }}>{events.length} upcoming events</p>
              <div className="flex flex-col gap-3">
                {displayed.map(event => (
                  <EventCard
                    key={event.id}
                    event={event}
                    selected={selected?.id === event.id}
                    onClick={() => {
                      // event_card_click (Engaged step); detail_view fires from the effect above
                      trackEvent('event_card_click', { source: event.source, event_id: event.id })
                      setSelected(event)
                    }}
                  />
                ))}
              </div>
              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="py-4 text-center font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.1em', color: 'var(--color-ink-25)' }}>
                {displayed.length < events.length ? 'Loading more…' : `All ${events.length} events loaded`}
              </div>
            </>
          )}
        </main>

        {/* Welcome panel — shown on desktop when no event selected and map off */}
        {!selected && !mapOn && (
          <div className="hidden lg:flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-paper-raised)' }}>
            <div className="flex-1 flex flex-col items-center justify-center text-center px-10">
              <div className="max-w-md">
                <div className="font-display mb-4" style={{ fontSize: '44px', lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
                  Discover free fun for your kids
                </div>
                <p className="mb-8" style={{ fontSize: '16px', lineHeight: 1.65, color: 'var(--color-ink-70)' }}>
                  Upcoming events across Frisco Library, Plano Libraries, and Play Frisco — all in one place. Select any event to see the details.
                </p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {['Frisco Library', 'Plano Libraries', 'Play Frisco'].map(label => (
                    <span
                      key={label}
                      className="font-mono uppercase"
                      style={{ fontSize: '11px', letterSpacing: '0.1em', color: 'var(--color-ink-35)', border: '1px solid var(--color-border)', borderRadius: '999px', padding: '4px 12px' }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detail panel — always visible when an event is selected */}
        {selected && (
          <aside
            className="hidden lg:block flex-1 border-l overflow-y-auto"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
          >
            <EventDetail
              event={selected}
              onClose={() => setSelected(null)}
              onGetDirections={selected.location_lat && selected.location_lng && selected.location_name ? () => {
                setDirectionsTarget({
                  location_name: selected.location_name!,
                  location_address: selected.location_address,
                  location_lat: selected.location_lat!,
                  location_lng: selected.location_lng!,
                  source: selected.source,
                })
                setDirectionsKey(k => k + 1)
                setMapOn(true)
              } : undefined}
            />
          </aside>
        )}

        {/* Map panel — third column when map is toggled on */}
        {mapOn && (
          <div className="hidden lg:block flex-1 border-l relative min-w-0" style={{ borderColor: 'var(--color-border)' }}>
            {/* The map degrades on its own — an empty map with no explanation reads as broken.
               The event list is unaffected, so this never blocks the page. */}
            {venuesError && (
              <div
                className="absolute top-3 left-3 right-3 z-10 flex gap-2.5 items-center"
                style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-accent-tint-border)', backgroundColor: 'var(--color-accent-tint)', padding: '9px 12px' }}
                role="alert"
              >
                <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'var(--color-accent)', flexShrink: 0 }} />
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-accent-text)' }}>Map locations couldn&rsquo;t be loaded right now.</div>
                <button onClick={() => fetchVenues()} className="ml-auto text-xs font-medium px-2.5 py-1" style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border-strong)', color: 'var(--color-ink)', backgroundColor: 'var(--color-paper)' }}>Try again</button>
              </div>
            )}
            <MapView
              venues={venues}
              selected={selected}
              directionsTarget={directionsTarget}
              directionsKey={directionsKey}
              onDirectionsClear={() => setDirectionsTarget(null)}
            />
          </div>
        )}
      </div>

      {/* Mobile detail — full-screen with sticky back button */}
      {selected && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--color-paper)' }}>
          {/* Branding bar — matches the home ink masthead (ink band + rust rule + two-colour
              wordmark + tagline) so the detail view reads as the same product, not a plain page. */}
          <header
            className="masthead flex-shrink-0 flex items-center"
            style={{ backgroundColor: '#1F1B16', borderBottom: '3px solid #B4623B', padding: '14px 20px' }}
          >
            <button
              type="button"
              onClick={resetToHome}
              className="flex flex-col gap-0.5 text-left cursor-pointer min-w-0"
              aria-label="Open Eventz home — reset filters and show all events"
            >
              <span className="font-display leading-none whitespace-nowrap text-[26px]" style={{ letterSpacing: '-0.015em' }}>
                <span style={{ color: '#FBF7F1' }}>Open </span><span style={{ color: '#E8A87C' }}>Eventz</span>
              </span>
              <span className="font-mono uppercase whitespace-nowrap text-[9px] tracking-[0.1em]" style={{ color: '#A79C8B' }}>Free things to do with kids · Frisco &amp; Plano</span>
            </button>
          </header>
          {/* Back row — beneath the branding bar, directly above the event title */}
          <div
            className="flex-shrink-0 px-5 py-2 border-b"
            style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-rule)' }}
          >
            <button
              onClick={() => setSelected(null)}
              className="flex items-center px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-ink-body)', color: 'var(--color-paper)' }}
            >
              ← Back to list
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <EventDetail event={selected} onClose={() => setSelected(null)} hideClose />
          </div>
        </div>
      )}

      {/* Mobile map overlay */}
      {mapOn && (
        <div className="lg:hidden fixed inset-0 z-40">
          <MapView venues={venues} />
          <button
            onClick={() => setMapOn(false)}
            className="absolute top-16 left-3 z-10 flex items-center px-3.5 py-2 text-sm font-medium shadow"
            style={{ background: 'var(--color-paper)', border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-input)', color: 'var(--color-ink)' }}
          >
            ← Back to list
          </button>
        </div>
      )}
    </div>
  )
}
