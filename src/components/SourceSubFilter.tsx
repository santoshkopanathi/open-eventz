'use client'

import { useEffect, useRef, useState } from 'react'
import { CITY_ACCENT, type City } from './FilterBar'

const AGE_OPTIONS = [
  { value: '0-5', label: 'Toddlers (0–5)' },
  { value: '6-12', label: 'Kids (6–12)' },
  { value: '13-17', label: 'Teens' },
]

const FRISCO_SOURCE_OPTIONS = [
  { value: 'frisco-library', label: 'Frisco Library' },
  { value: 'play-frisco', label: 'Play Frisco' },
]

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
// Date-range presets — set the EXISTING date_from/date_to filter (no new backend/logic).
function presetRange(kind: 'today' | 'tomorrow' | 'weekend'): { date_from: string; date_to: string } {
  const now = new Date()
  if (kind === 'today') { const s = ymd(now); return { date_from: s, date_to: s } }
  if (kind === 'tomorrow') { const t = new Date(now); t.setDate(now.getDate() + 1); const s = ymd(t); return { date_from: s, date_to: s } }
  const sat = new Date(now); sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7)) // upcoming Saturday
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1)
  return { date_from: ymd(sat), date_to: ymd(sun) }
}
const DATE_PRESETS: { id: 'today' | 'tomorrow' | 'weekend'; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'Weekend' },
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
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          backgroundColor: active ? 'var(--color-accent-tint)' : 'var(--color-paper)',
          color: active ? 'var(--color-accent-text)' : 'var(--color-ink)',
        }}
      >
        <span className="whitespace-nowrap">{buttonLabel}</span>
        {selected.length > 1 && (
          <span
            className="inline-flex items-center justify-center rounded-full text-[10px] font-bold"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-paper)', minWidth: '16px', height: '16px', padding: '0 4px' }}
          >
            {selected.length}
          </span>
        )}
        <span className="text-[10px]" style={{ opacity: 0.6 }}>{open ? '˄' : '˅'}</span>
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 left-0 z-30 border py-1 min-w-[190px]"
          style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', boxShadow: 'var(--shadow-map-label)' }}
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
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
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
      className="mb-3 px-4 pt-2.5 pb-3 border"
      style={{
        backgroundColor: 'var(--color-fill-subtle)',
        borderColor: 'var(--color-border)',
        borderRadius: 'var(--radius-input)',
      }}
    >
      {/* Label + clear */}
      <div className="flex items-center justify-end mb-2">
        <button onClick={onClear} className="text-xs underline" style={{ color: 'var(--color-accent)' }}>
          Clear filters
        </button>
      </div>

      {/* Filters — source/branch, age, and date range */}
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
        <span className="text-xs ml-1" style={{ color: 'var(--color-ink-35)' }}>From</span>
        <input
          type="date"
          value={date_from}
          onChange={e => onPatch({ date_from: e.target.value })}
          className="px-2 py-1 border text-xs outline-none"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-paper)', borderRadius: 'var(--radius-input)', color: 'var(--color-ink)' }}
        />
        <span className="text-xs" style={{ color: 'var(--color-ink-35)' }}>to</span>
        <input
          type="date"
          value={date_to}
          onChange={e => onPatch({ date_to: e.target.value })}
          className="px-2 py-1 border text-xs outline-none"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-paper)', borderRadius: 'var(--radius-input)', color: 'var(--color-ink)' }}
        />
      </div>

      {/* Quick date presets — own row, directly beneath the filters; set date_from/date_to.
          Filled pills (distinct from the outlined dropdown filters); solid rust when active. */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className="font-mono uppercase mr-0.5" style={{ fontSize: '10px', letterSpacing: '0.1em', color: 'var(--color-ink-35)' }}>Jump to</span>
        {DATE_PRESETS.map(p => {
          const r = presetRange(p.id)
          const active = mounted && date_from === r.date_from && date_to === r.date_to
          return (
            <button
              key={p.id}
              onClick={() => onPatch(r)}
              className="px-3.5 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderRadius: '999px',
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                backgroundColor: active ? 'var(--color-accent)' : 'var(--color-paper)',
                color: active ? 'var(--color-paper)' : 'var(--color-ink)',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
