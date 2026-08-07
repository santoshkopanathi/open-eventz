'use client'

export type City = 'frisco' | 'plano'

// Weekend Paper uses a single accent (rust) — no per-city hue. Kept as a map so the
// sub-filter bar can keep importing one accent value without other changes.
export const CITY_ACCENT: Record<City, string> = {
  frisco: '#B4623B', // rust
  plano: '#B4623B',  // rust
}

const TABS: { id: City; label: string }[] = [
  { id: 'frisco', label: 'Frisco City' },
  { id: 'plano', label: 'Plano City' },
]

interface Props {
  city: City
  onCityChange: (city: City) => void
  mapOn?: boolean
  onToggleMap?: () => void
}

// City-first navigation tabs. One is always active; switching reloads the event list
// for that city. Replaces the former source dropdown entirely (spec Section 1).
export default function FilterBar({ city, onCityChange, mapOn, onToggleMap }: Props) {
  return (
    <div
      className="flex-shrink-0 w-full border-b px-7 py-3 flex items-center justify-between gap-3"
      style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-rule)' }}
    >
      {/* Segmented control (Weekend Paper): active segment ink-filled on a fill-track track */}
      <div className="inline-flex p-[3px]" style={{ backgroundColor: 'var(--color-fill-track)', borderRadius: '10px' }} role="tablist">
        {TABS.map(tab => {
          const active = city === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onCityChange(tab.id)}
              className="px-5 py-1.5 text-sm transition-all"
              style={{
                borderRadius: '8px',
                backgroundColor: active ? 'var(--color-ink)' : 'transparent',
                color: active ? 'var(--color-paper)' : 'var(--color-ink-50)',
                fontWeight: active ? 600 : 500,
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {onToggleMap && (
        <button
          onClick={onToggleMap}
          className="flex-shrink-0 flex items-center px-3 py-1.5 text-xs transition-colors"
          style={{
            borderRadius: 'var(--radius-input)',
            border: '1px solid var(--color-border-strong)',
            background: mapOn ? 'var(--color-ink)' : 'transparent',
            color: mapOn ? 'var(--color-paper)' : 'var(--color-ink-70)',
            fontWeight: mapOn ? 600 : 500,
          }}
        >
          {mapOn ? 'Hide map' : 'Show map'}
        </button>
      )}
    </div>
  )
}
