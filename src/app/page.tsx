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

  useEffect(() => {
    fetch('/api/venues').then(r => r.json()).then(d => setVenues(d.venues ?? []))
  }, [])

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
      const srcs = frisco.sources.length ? frisco.sources : ['frisco-library', 'play-frisco']
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

    const res = await fetch(`/api/events?${params.toString()}`)
    const data = await res.json()
    const all = data.events ?? []
    setEvents(all)
    setDisplayed(all.slice(0, PAGE_SIZE))
    setLoading(false)
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
      <header style={{ backgroundColor: 'var(--color-primary)' }} className="flex-shrink-0 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={resetToHome}
          className="flex items-center gap-2 text-left cursor-pointer"
          aria-label="Open Eventz home — reset filters and show all events"
        >
          <span className="text-2xl">🎈</span>
          <div>
            <div className="text-white font-bold text-xl tracking-tight leading-tight">Open Eventz</div>
            <div className="text-white/60 text-xs leading-tight">Free kids events in Frisco &amp; Plano, TX</div>
          </div>
        </button>
        {/* Map toggle */}
        <button
          onClick={() => setMapOn(m => !m)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 transition-all flex-shrink-0"
          style={{
            background: mapOn ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)',
            color: mapOn ? 'var(--color-primary)' : 'rgba(255,255,255,0.7)',
            fontWeight: mapOn ? 700 : 500,
          }}
        >
          🗺️ Map {mapOn ? 'On' : 'Off'}
        </button>
      </header>

      <FilterBar city={city} onCityChange={setCity} />

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
            onPatch={patchActive}
            onClear={clearActive}
          />

          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <div className="text-center">
                <div className="text-4xl mb-3">🔍</div>
                <p>Loading events…</p>
              </div>
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <div className="text-center">
                <div className="text-4xl mb-3">📭</div>
                <p>No events match your filters.</p>
                <button
                  onClick={clearActive}
                  className="mt-3 text-sm underline"
                  style={{ color: 'var(--color-periwinkle)' }}
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-3">{events.length} upcoming events</p>
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
              <div ref={sentinelRef} className="py-4 text-center text-sm text-gray-400">
                {displayed.length < events.length ? 'Loading more…' : `All ${events.length} events loaded`}
              </div>
            </>
          )}
        </main>

        {/* Welcome panel — shown on desktop when no event selected and map off */}
        {!selected && !mapOn && (
          <div className="hidden lg:flex flex-1 flex-col overflow-hidden relative">
            {/* Hero panel */}
            <div className="flex-1 relative overflow-hidden flex flex-col items-center justify-center text-center px-8"
              style={{ background: 'linear-gradient(150deg, #E8E6F5 0%, #F5E6EF 40%, #FFF3E0 100%)' }}
            >
              {/* Soft blobs */}
              <div style={{ position:'absolute', top:'-80px', right:'-80px', width:'300px', height:'300px', borderRadius:'50%', background:'rgba(196,176,104,0.12)' }} />
              <div style={{ position:'absolute', bottom:'-100px', left:'-60px', width:'340px', height:'340px', borderRadius:'50%', background:'rgba(45,53,97,0.07)' }} />
              <div style={{ position:'absolute', top:'40%', left:'-40px', width:'160px', height:'160px', borderRadius:'50%', background:'rgba(236,72,153,0.07)' }} />
              <div style={{ position:'absolute', top:'15%', right:'10%', width:'100px', height:'100px', borderRadius:'50%', background:'rgba(99,102,241,0.08)' }} />

              {/* Scattered background items */}
              {[
                { emoji:'🎨', top:'6%',  left:'8%',  size:'2.2rem', op:0.55 },
                { emoji:'🔬', top:'10%', right:'12%', size:'2rem',   op:0.5  },
                { emoji:'📚', top:'22%', left:'4%',  size:'1.8rem', op:0.45 },
                { emoji:'⚽', top:'18%', right:'5%', size:'2rem',   op:0.5  },
                { emoji:'🎵', top:'38%', left:'6%',  size:'1.6rem', op:0.4  },
                { emoji:'🌳', top:'42%', right:'7%', size:'2rem',   op:0.45 },
                { emoji:'🧩', bottom:'32%', left:'5%',  size:'1.8rem', op:0.45 },
                { emoji:'🎭', bottom:'28%', right:'6%', size:'2rem',   op:0.4  },
                { emoji:'🚴', bottom:'14%', left:'9%',  size:'2rem',   op:0.45 },
                { emoji:'🎪', bottom:'10%', right:'10%', size:'2.2rem', op:0.5 },
                { emoji:'🦋', top:'55%', left:'3%',  size:'1.6rem', op:0.4  },
                { emoji:'🎯', top:'62%', right:'4%', size:'1.8rem', op:0.4  },
                { emoji:'🧸', top:'75%', left:'7%',  size:'1.8rem', op:0.45 },
                { emoji:'🪁', top:'5%',  left:'45%', size:'1.6rem', op:0.35 },
                { emoji:'🎠', bottom:'5%', left:'40%', size:'1.8rem', op:0.4  },
              ].map((item, i) => (
                <div key={i} style={{ position:'absolute', top:item.top, bottom:item.bottom, left:item.left, right:item.right, fontSize:item.size, opacity:item.op, pointerEvents:'none', userSelect:'none' }}>
                  {item.emoji}
                </div>
              ))}

              {/* Content */}
              <div className="relative z-10">
                <div className="text-7xl mb-5">🎈</div>
                <div className="text-5xl font-bold mb-4 tracking-tight leading-tight" style={{ color: '#2D3561' }}>
                  Discover free fun<br/>for your kids
                </div>
                <p className="text-base leading-relaxed max-w-sm mb-8" style={{ color: '#5A5868' }}>
                  Upcoming events across Frisco Library, Plano Libraries, and Play Frisco — all in one place. Click any event to see details.
                </p>
                <div className="flex gap-4 justify-center flex-wrap">
                  {[
                    { label: 'Frisco Library', emoji: '📚' },
                    { label: 'Plano Libraries', emoji: '🏛️' },
                    { label: 'Play Frisco', emoji: '🌳' },
                  ].map(s => (
                    <div key={s.label} className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full" style={{ background: 'rgba(45,53,97,0.1)', color: '#2D3561' }}>
                      <span>{s.emoji}</span><span>{s.label}</span>
                    </div>
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
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--color-card)' }}>
          <div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-3"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <button
              type="button"
              onClick={resetToHome}
              className="flex items-center gap-2 text-left cursor-pointer"
              aria-label="Open Eventz home — reset filters and show all events"
            >
              <span className="text-2xl">🎈</span>
              <div>
                <div className="text-white font-bold text-xl tracking-tight leading-tight">Open Eventz</div>
                <div className="text-white/60 text-xs leading-tight">Free kids events in Frisco &amp; Plano, TX</div>
              </div>
            </button>
          </div>
          {/* Back row — beneath the branding bar, directly above the event title */}
          <div
            className="flex-shrink-0 px-4 py-2 border-b"
            style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
          >
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              ‹ Back to list
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
            className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border shadow"
            style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            ← List
          </button>
        </div>
      )}
    </div>
  )
}
