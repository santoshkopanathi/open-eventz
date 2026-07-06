'use client'

import { useRef, useState, useEffect } from 'react'

interface Filters {
  sources: string[]
  branches: string[]
  is_free: boolean
  age: string
  date_from: string
  date_to: string
}

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
}

const SOURCES = [
  { value: 'frisco-library', label: 'Frisco Library' },
  { value: 'play-frisco',    label: 'Play Frisco' },
  { value: 'plano-library',  label: 'Plano Libraries' },
]

export default function FilterBar({ filters, onChange }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleSource = (value: string) => {
    const next = filters.sources.includes(value)
      ? filters.sources.filter(s => s !== value)
      : [...filters.sources, value]
    // Clear source-specific sub-filters when switching
    onChange({ ...filters, sources: next, branches: [], age: '' })
  }

  const sourceLabel = filters.sources.length === 0
    ? 'All sources'
    : filters.sources.length === 1
      ? SOURCES.find(s => s.value === filters.sources[0])?.label ?? 'All sources'
      : `${filters.sources.length} sources`

  const hasFilters = filters.sources.length > 0 || filters.branches.length > 0 || filters.age || filters.date_from || filters.date_to

  return (
    <div className="border-b text-sm" style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
      <div className="px-4 py-2 flex flex-wrap gap-3 items-center">
        {/* Source dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 border text-sm outline-none"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}
          >
            {sourceLabel}
            <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
          </button>
          {open && (
            <div
              className="absolute top-full mt-1 left-0 z-20 rounded-xl border shadow-lg py-1 min-w-[180px]"
              style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
            >
              {SOURCES.map(s => (
                <label key={s.value} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-50 select-none">
                  <input
                    type="checkbox"
                    checked={filters.sources.includes(s.value)}
                    onChange={() => toggleSource(s.value)}
                    className="w-4 h-4 accent-[var(--color-primary)]"
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <span className="text-gray-500">From</span>
          <input
            type="date"
            value={filters.date_from}
            onChange={e => set({ date_from: e.target.value })}
            className="rounded-lg px-2 py-1 border text-sm outline-none"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={filters.date_to}
            onChange={e => set({ date_to: e.target.value })}
            className="rounded-lg px-2 py-1 border text-sm outline-none"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}
          />
        </div>

        {/* Clear */}
        {hasFilters && (
          <button
            onClick={() => onChange({ sources: [], branches: [], is_free: false, age: '', date_from: '', date_to: '' })}
            className="text-xs underline"
            style={{ color: 'var(--color-periwinkle)' }}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
