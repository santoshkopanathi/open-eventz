'use client'

import { useState } from 'react'
import type { Event } from '@/lib/types'
import type { City } from '@/components/FilterBar'
import EventCard from '@/components/EventCard'

/**
 * The "Ask about events" box above the list (spec "Screen copy", approved 2026-11-18). Only
 * rendered when NEXT_PUBLIC_ASK_ENABLED is 'true'. The cards are the list view's own EventCard,
 * so every fact a parent reads comes from the stored record, not from the model.
 */
type Link = { city: City; date_from: string | null; date_to: string | null }
type Result =
  | { kind: 'answer' | 'cards'; showing: string; notes: string[]; answer: string | null; cards: Event[]; disclosure: string }
  | { kind: 'nothing'; showing: string; notes: string[]; nothing: { text: string; linkText: string; link: Link | null } }
  | { kind: 'off_topic'; offTopic: string }
  | { kind: 'error' | 'unavailable' }

const muted = { fontSize: '13px', color: 'var(--color-ink-70)' } as const

export default function AskBox({ city, selectedId, onSelect, onFilterView }: {
  city: City
  selectedId: string | null
  onSelect: (e: Event) => void
  onFilterView: (link: Link) => void
}) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, tab: city }) })
      setResult(res.ok ? await res.json() : { kind: 'unavailable' })
    } catch {
      setResult({ kind: 'unavailable' })
    } finally {
      setBusy(false)
    }
  }
  const clear = () => { setResult(null); setQ('') }

  return (
    <section className="mb-4 flex flex-col gap-3" aria-label="Ask about events">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="ask-input" className="font-mono uppercase" style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--color-ink-35)' }}>Ask about events</label>
        <div className="flex gap-2">
          <input
            id="ask-input" value={q} onChange={e => setQ(e.target.value)} maxLength={300}
            placeholder="e.g. something for my 4-year-old this Saturday"
            className="flex-1 min-w-0 px-3 py-2.5"
            style={{ fontSize: '15px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border-strong)', backgroundColor: 'var(--color-paper)', color: 'var(--color-ink)' }}
          />
          <button type="submit" disabled={busy} className="px-4 font-semibold" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-ink)', color: 'var(--color-paper)', fontSize: '14px', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>

      {result && (
        <div className="flex flex-col gap-3">
          {'showing' in result && (
            <div className="flex flex-wrap items-baseline gap-x-3" style={muted}>
              <span style={{ color: 'var(--color-ink)', fontWeight: 600 }}>{result.showing}</span>
              <button type="button" onClick={clear} className="ml-auto underline" style={{ fontSize: '12px', color: 'var(--color-ink-50)' }}>Clear</button>
            </div>
          )}
          {'notes' in result && result.notes.map(n => (
            <div key={n} className="flex gap-2.5" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-fill-subtle)', borderRadius: 'var(--radius-input)', padding: '9px 12px', fontSize: '13px', color: 'var(--color-ink)' }}>
              <div style={{ width: 3, borderRadius: 2, backgroundColor: 'var(--color-border-strong)', flexShrink: 0 }} />{n}
            </div>
          ))}
          {(result.kind === 'answer' || result.kind === 'cards') && (
            <>
              {result.answer && <p style={{ fontSize: '15px', lineHeight: 1.55, color: 'var(--color-ink-body)' }}>{result.answer}</p>}
              <div className="flex flex-col gap-3">
                {result.cards.map(ev => <EventCard key={ev.id} event={ev} selected={selectedId === ev.id} onClick={() => onSelect(ev)} />)}
              </div>
              <p className="pt-2.5" style={{ fontSize: '12px', color: 'var(--color-ink-50)', borderTop: '1px solid var(--color-rule)' }}>{result.disclosure}</p>
            </>
          )}
          {result.kind === 'nothing' && (
            <p style={{ fontSize: '15px', color: 'var(--color-ink-body)' }}>
              {result.nothing.text}{' '}
              {result.nothing.link && (
                <button type="button" className="underline font-semibold" style={{ color: 'var(--color-accent-text)' }}
                  onClick={() => { onFilterView(result.nothing.link!); clear() }}>{result.nothing.linkText}</button>
              )}
            </p>
          )}
          {result.kind === 'off_topic' && (
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p style={{ fontSize: '15px', color: 'var(--color-ink-body)' }}>{result.offTopic}</p>
              <button type="button" onClick={clear} className="underline" style={{ fontSize: '12px', color: 'var(--color-ink-50)' }}>Clear</button>
            </div>
          )}
          {(result.kind === 'error' || result.kind === 'unavailable') && (
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p style={muted}>Ask isn&rsquo;t available right now. The filters below still work.</p>
              <button type="button" onClick={clear} className="underline" style={{ fontSize: '12px', color: 'var(--color-ink-50)' }}>Clear</button>
            </div>
          )}
          {result.kind !== 'error' && result.kind !== 'unavailable' && result.kind !== 'off_topic' && (
            <p className="font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.1em', color: 'var(--color-ink-25)' }}>All events below</p>
          )}
        </div>
      )}
    </section>
  )
}
