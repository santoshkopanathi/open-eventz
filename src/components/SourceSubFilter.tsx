'use client'

import { useEffect, useRef, useState } from 'react'
import { CITY_ACCENT, type City } from './FilterBar'

const CITY_TINT: Record<City, string> = {
  frisco: 'rgba(196,176,104,0.10)',
  plano: 'rgba(99,102,241,0.08)',
}

const AGE_OPTIONS = [
  { value: '0-5', label: 'Toddlers (0–5)' },
  { value: '6-12', label: 'Kids (6–12)' },
  { value: '13-17', label: 'Teens' },
]

const FRISCO_SOURCE_OPTIONS = [
  { value: 'frisco-library', label: 'Frisco Library' },
  { value: 'play-frisco', label: 'Play Frisco' },
]

export interface SubFilterPatch {
  sources?: string[]
  branches?: string[]
  ages?: string[]
  date_from?: string
  date_to?: string
}

interface Props {
  city: City
  sources: string[]      // Frisco source sub-filter (subset of frisco-library / play-frisco)
  branches: string[]     // Plano selected branches
  ages: string[]         // selected age chips (multi-select)
  date_from: string
  date_to: string
  onPatch: (patch: SubFilterPatch) => void
  onClear: () => void
}

interface Option { value: string; label: string }

// Multi-select dropdown: closed button shows the single option name, or the group label
// with a count badge when multiple are selected (functional-test §4–§5).
function FilterDropdown({ groupLabel, options, selected, accent, onChange }: {
  groupLabel: string
  options: Option[]
  selected: string[]
  accent: string
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])
  }

  const buttonLabel = selected.length === 1
    ? (options.find(o => o.value === selected[0])?.label ?? groupLabel)
    : groupLabel
  const active = selected.length > 0

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1 border text-xs font-medium outline-none transition-colors"
        style={{
          borderColor: active ? accent : 'var(--color-border)',
          backgroundColor: active ? accent : 'var(--color-card)',
          color: active ? '#fff' : 'var(--color-text)',
        }}
      >
        <span className="whitespace-nowrap">{buttonLabel}</span>
        {selected.length > 1 && (
          <span
            className="inline-flex items-center justify-center rounded-full text-[10px] font-bold"
            style={{ backgroundColor: '#fff', color: accent, minWidth: '16px', height: '16px', padding: '0 4px' }}
          >
            {selected.length}
          </span>
        )}
        <span className="text-[9px]" style={{ opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 left-0 z-30 rounded-xl border shadow-lg py-1 min-w-[190px]"
          style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
        >
          {options.map(o => (
            <label key={o.value} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-50 select-none text-xs">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="w-4 h-4"
                style={{ accentColor: accent }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// Secondary filter row for the active city (spec §1). Source/branch and age are multi-select
// dropdowns; the city accent carries in via the left border and tinted background.
export default function SourceSubFilter({ city, sources, branches, ages, date_from, date_to, onPatch, onClear }: Props) {
  const [branchOptions, setBranchOptions] = useState<Option[]>([])
  const accent = CITY_ACCENT[city]

  useEffect(() => {
    if (city !== 'plano') return
    fetch('/api/branches')
      .then(r => r.json())
      .then(d => setBranchOptions((d.branches ?? []).map((b: string) => ({ value: b, label: b.replace(/ Library$/, '') }))))
      .catch(() => setBranchOptions([]))
  }, [city])

  return (
    <div
      className="mb-3 px-4 pt-2.5 pb-3 rounded-lg border"
      style={{
        background: CITY_TINT[city],
        borderColor: 'var(--color-border)',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      {/* Label + clear */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-md"
          style={{ background: CITY_TINT[city], color: 'var(--color-primary)' }}
        >
          {city === 'frisco' ? '📚 Frisco City' : '🏛️ Plano City'}
        </span>
        <button onClick={onClear} className="text-xs underline" style={{ color: 'var(--color-periwinkle)' }}>
          Clear filters
        </button>
      </div>

      {/* Filters — source/branch, age, and date range on one line */}
      <div className="flex flex-wrap items-center gap-2">
        {city === 'frisco' && (
          <FilterDropdown
            groupLabel="Sources"
            options={FRISCO_SOURCE_OPTIONS}
            selected={sources}
            accent={accent}
            onChange={next => onPatch({ sources: next })}
          />
        )}
        {city === 'plano' && branchOptions.length > 0 && (
          <FilterDropdown
            groupLabel="Branches"
            options={branchOptions}
            selected={branches}
            accent={accent}
            onChange={next => onPatch({ branches: next })}
          />
        )}
        <FilterDropdown
          groupLabel="Age range"
          options={AGE_OPTIONS}
          selected={ages}
          accent={accent}
          onChange={next => onPatch({ ages: next })}
        />
        <span className="text-gray-500 text-xs ml-1">From</span>
        <input
          type="date"
          value={date_from}
          onChange={e => onPatch({ date_from: e.target.value })}
          className="rounded-lg px-2 py-1 border text-xs outline-none"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
        />
        <span className="text-gray-500 text-xs">to</span>
        <input
          type="date"
          value={date_to}
          onChange={e => onPatch({ date_to: e.target.value })}
          className="rounded-lg px-2 py-1 border text-xs outline-none"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
        />
      </div>
    </div>
  )
}
