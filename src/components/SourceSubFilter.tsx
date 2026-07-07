'use client'

import { useEffect, useState } from 'react'

interface Filters {
  sources: string[]
  branches: string[]
  age: string
}

interface Props {
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
}

const AGE_CHIPS = [
  { label: 'Toddlers (0–5)', value: '0-5' },
  { label: 'Kids (6–12)',     value: '6-12' },
  { label: 'Teens',           value: '13-17' },
]

function AgeChip({ label, value, active, onClick }: { label: string; value: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-medium border transition-all"
      style={{
        backgroundColor: active ? 'var(--color-primary)' : 'var(--color-card)',
        color: active ? '#fff' : 'var(--color-text)',
        borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
      }}
    >
      {label}
    </button>
  )
}

export default function SourceSubFilter({ filters, onChange }: Props) {
  const [branches, setBranches] = useState<string[]>([])

  const friscoOnly = filters.sources.length === 1 && filters.sources[0] === 'frisco-library'
  const planoOnly  = filters.sources.length === 1 && filters.sources[0] === 'plano-library'

  useEffect(() => {
    if (!planoOnly) { setBranches([]); return }
    fetch('/api/branches')
      .then(r => r.json())
      .then(d => setBranches(d.branches ?? []))
  }, [planoOnly])

  if (!friscoOnly && !planoOnly) return null

  const toggleBranch = (branch: string) => {
    const next = filters.branches.includes(branch)
      ? filters.branches.filter(b => b !== branch)
      : [...filters.branches, branch]
    onChange({ branches: next })
  }

  const hasActive = !!(filters.age || filters.branches.length > 0)

  return (
    <div
      className="px-4 pt-2 pb-2.5 border-b overflow-x-hidden"
      style={{
        background: friscoOnly ? 'rgba(45,53,97,0.06)' : 'rgba(99,102,241,0.06)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* Label row */}
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-md"
          style={{
            background: friscoOnly ? 'rgba(45,53,97,0.12)' : 'rgba(99,102,241,0.12)',
            color: 'var(--color-primary)',
          }}
        >
          {friscoOnly ? '📚 Frisco Library · Age' : '🏛️ Plano Libraries'}
        </span>
        {hasActive && (
          <button
            onClick={() => onChange({ age: '', branches: [] })}
            className="text-xs underline"
            style={{ color: 'var(--color-periwinkle)' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Frisco — age chips only */}
      {friscoOnly && (
        <div className="flex flex-wrap gap-2">
          {AGE_CHIPS.map(opt => (
            <AgeChip
              key={opt.value}
              label={opt.label}
              value={opt.value}
              active={filters.age === opt.value}
              onClick={() => onChange({ age: filters.age === opt.value ? '' : opt.value })}
            />
          ))}
        </div>
      )}

      {/* Plano — age chips + branch chips */}
      {planoOnly && (
        <div className="flex flex-col gap-2">
          {/* Age row */}
          <div className="flex flex-wrap gap-2">
            {AGE_CHIPS.map(opt => (
              <AgeChip
                key={opt.value}
                label={opt.label}
                value={opt.value}
                active={filters.age === opt.value}
                onClick={() => onChange({ age: filters.age === opt.value ? '' : opt.value })}
              />
            ))}
          </div>
          {/* Branch row */}
          {branches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {branches.map(branch => {
                const active = filters.branches.includes(branch)
                return (
                  <button
                    key={branch}
                    onClick={() => toggleBranch(branch)}
                    className="px-2 py-0.5 rounded-full text-xs font-medium border transition-all"
                    style={{
                      backgroundColor: active ? 'var(--color-primary)' : 'var(--color-card)',
                      color: active ? '#fff' : 'var(--color-text)',
                      borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                    }}
                  >
                    {branch.replace(/ Library$/, '')}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
