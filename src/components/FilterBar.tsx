'use client'

export type City = 'frisco' | 'plano'

// Distinct accent per city — carries from the tab underline into the sub-filter bar
// so users always have a visual signal of which city context they're in.
export const CITY_ACCENT: Record<City, string> = {
  frisco: '#C4B068', // muted gold
  plano: '#6366F1',  // indigo/blue
}

const TABS: { id: City; label: string }[] = [
  { id: 'frisco', label: 'Frisco City' },
  { id: 'plano', label: 'Plano City' },
]

interface Props {
  city: City
  onCityChange: (city: City) => void
}

// City-first navigation tabs. One is always active; switching reloads the event list
// for that city. Replaces the former source dropdown entirely (spec Section 1).
export default function FilterBar({ city, onCityChange }: Props) {
  return (
    <div
      className="flex-shrink-0 flex w-full border-b"
      style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      role="tablist"
    >
      {TABS.map(tab => {
        const active = city === tab.id
        const accent = CITY_ACCENT[tab.id]
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onCityChange(tab.id)}
            className="px-6 py-3 text-sm font-semibold transition-all outline-none"
            style={{
              color: active ? '#fff' : 'var(--color-text)',
              opacity: active ? 1 : 0.55,
              backgroundColor: active ? accent : 'transparent',
              borderBottom: active ? `3px solid ${accent}` : '3px solid transparent',
            }}
          >
            {tab.id === 'frisco' ? '📚 ' : '🏛️ '}{tab.label}
          </button>
        )
      })}
    </div>
  )
}
