'use client'

import { useEffect, useState } from 'react'
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import type { Venue, Event } from '@/lib/types'

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!

const SOURCE_COLOR: Record<string, string> = {
  'frisco-library': '#0F6E56',
  'plano-library':  '#534AB7',
  'play-frisco':    '#2D3561',
}

const SOURCE_LABEL: Record<string, string> = {
  'frisco-library': 'Frisco Library',
  'plano-library':  'Plano Libraries',
  'play-frisco':    'Play Frisco',
}

function PanController({ selected }: { selected?: Event | null }) {
  const map = useMap()
  useEffect(() => {
    if (map && selected?.location_lat && selected?.location_lng) {
      map.panTo({ lat: selected.location_lat, lng: selected.location_lng })
    }
  }, [map, selected])
  return null
}

interface Props {
  venues: Venue[]
  selected?: Event | null
  directionsTarget?: Venue | null
  directionsKey?: number
  onDirectionsClear?: () => void
}

export default function MapView({ venues = [], selected, directionsTarget, directionsKey, onDirectionsClear }: Props) {
  const [fromAddress, setFromAddress] = useState('')
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const defaultCenter = { lat: 33.05, lng: -96.77 }

  useEffect(() => {
    setIframeUrl(null)
    setFromAddress('')
    if (!directionsTarget) onDirectionsClear?.()
  }, [directionsTarget, directionsKey])

  const handleGetDirections = (from: string) => {
    const destination = directionsTarget?.location_address ?? directionsTarget?.location_name ?? ''
    const url = `https://www.google.com/maps/embed/v1/directions?key=${API_KEY}&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(destination)}&mode=driving`
    setIframeUrl(url)
  }

  const handleUseLocation = () => {
    navigator.geolocation.getCurrentPosition(pos => {
      const from = `${pos.coords.latitude},${pos.coords.longitude}`
      handleGetDirections(from)
    }, () => {
      alert('Could not get your location. Please allow location access or enter an address.')
    })
  }

  const handleClear = () => {
    setIframeUrl(null)
    setFromAddress('')
    onDirectionsClear?.()
  }

  // Directions mode — show from-address input then full Google Maps iframe
  if (directionsTarget) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>DIRECTIONS TO</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2D3561' }}>{directionsTarget.location_name}</div>
          </div>
          <button onClick={handleClear} style={{ fontSize: 11, color: '#E53E3E', background: 'none', border: '1px solid #E53E3E', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>
            ← Back to map
          </button>
        </div>

        {/* From address input — shown until iframe is ready */}
        {!iframeUrl && (
          <div style={{ padding: '16px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: '#555', fontWeight: 600, marginBottom: 6 }}>From</div>
            <input
              type="text"
              placeholder="Enter your starting address…"
              value={fromAddress}
              onChange={e => setFromAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fromAddress.trim() && handleGetDirections(fromAddress.trim())}
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginBottom: 10, outline: 'none' }}
            />
            <button
              onClick={() => fromAddress.trim() && handleGetDirections(fromAddress.trim())}
              disabled={!fromAddress.trim()}
              style={{ display: 'block', width: '100%', padding: '8px', borderRadius: 8, background: fromAddress.trim() ? '#2D3561' : '#ccc', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: fromAddress.trim() ? 'pointer' : 'default', marginBottom: 8 }}
            >
              🗺️ Get directions
            </button>
            <button
              onClick={handleUseLocation}
              style={{ display: 'block', width: '100%', padding: '7px', borderRadius: 8, background: 'none', color: '#2D3561', fontSize: 12, fontWeight: 600, border: '1px solid #2D3561', cursor: 'pointer' }}
            >
              📍 Use my current location
            </button>
          </div>
        )}

        {/* Full Google Maps embed */}
        {iframeUrl && (
          <iframe
            src={iframeUrl}
            style={{ flex: 1, border: 'none', width: '100%' }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
      </div>
    )
  }

  // Default mode — venue pins map
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <APIProvider apiKey={API_KEY}>
        <Map
          defaultCenter={defaultCenter}
          defaultZoom={11}
          mapId="openeventz-map"
          disableDefaultUI={false}
          style={{ width: '100%', height: '100%' }}
          gestureHandling="greedy"
        >
          <PanController selected={selected} />
          {venues.map((venue, i) => {
            const isSelected = !!(selected?.location_name && selected.location_name === venue.location_name)
            const color = isSelected ? '#E53E3E' : (SOURCE_COLOR[venue.source] ?? '#2D3561')
            return (
              <AdvancedMarker
                key={`${venue.location_name}|${venue.source}|${i}`}
                position={{ lat: venue.location_lat, lng: venue.location_lng }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: isSelected ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.15s' }}>
                  <div style={{ background: color, color: '#fff', fontSize: 10, fontWeight: 600, fontFamily: 'sans-serif', padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }}>
                    {venue.location_name}
                  </div>
                  <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `7px solid ${color}` }} />
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, marginTop: -1 }} />
                </div>
              </AdvancedMarker>
            )
          })}
        </Map>
      </APIProvider>

      <div style={{ position: 'absolute', top: 12, left: 12, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 600, boxShadow: '0 1px 4px rgba(0,0,0,0.15)', pointerEvents: 'none', color: '#2D3561' }}>
        All event venues
      </div>

      <div style={{ position: 'absolute', bottom: 12, right: 12, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, boxShadow: '0 1px 4px rgba(0,0,0,0.15)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(SOURCE_LABEL).map(([src, label]) => (
          <div key={src} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: SOURCE_COLOR[src] }} />
            <span style={{ color: '#444' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
