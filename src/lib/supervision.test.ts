import type { Event, EventSource } from './types'
import { getSupervisionBadge } from './supervision'

// Event factory — fills every required field; override what a test cares about.
function ev(p: Partial<Event>): Event {
  return {
    id: 'e1', source: 'frisco-library', title: 'Event', description: null,
    start_datetime: '2026-07-15T15:00:00Z', end_datetime: null,
    location_name: null, location_address: null, location_lat: null, location_lng: null,
    is_free: true, price_text: null, age_min: null, age_max: null, age_label: null,
    is_recurring: false, recurrence_label: null, thumbnail_url: null, event_url: '',
    category: null, registration_required: false,
    kid_relevant: null, age_buckets: null, age_confidence: null, age_reasoning: null,
    price_class: null, price_confidence: null, price_reasoning: null,
    ingested_at: '', created_at: '',
    ...p,
  }
}

describe('getSupervisionBadge — Frisco Library (age-derived, policy §8.5)', () => {
  test('young kids only (age_max ≤ 9) → adult must stay', () => {
    expect(getSupervisionBadge(ev({ source: 'frisco-library', age_min: 0, age_max: 5 }))!.label)
      .toContain('adult must stay')
  })
  test('mixed 6–12 (straddles the 10-year line) → only if 10 or older', () => {
    expect(getSupervisionBadge(ev({ source: 'frisco-library', age_min: 6, age_max: 12 }))!.label)
      .toContain('10 or older')
  })
  test('teens 13+ → may attend alone', () => {
    expect(getSupervisionBadge(ev({ source: 'frisco-library', age_min: 13, age_max: 17 }))!.label)
      .toContain('teens 13+')
  })
  test('no age data → check with the library, never a guessed threshold', () => {
    expect(getSupervisionBadge(ev({ source: 'frisco-library', age_min: null, age_max: null }))!.label)
      .toContain('Check with Frisco Library')
  })
})

describe('getSupervisionBadge — Plano Libraries (no formal policy → plan to stay)', () => {
  test('shows the plan-to-stay guidance with the no-formal-policy caveat', () => {
    const b = getSupervisionBadge(ev({ source: 'plano-library' }))!
    expect(b.label).toContain('Plan to stay')
    expect(b.sub).toContain('No formal Plano Library policy')
  })
  test('does NOT invent a hard age cutoff — same badge regardless of age', () => {
    const young = getSupervisionBadge(ev({ source: 'plano-library', age_min: 3, age_max: 8 }))!
    const older = getSupervisionBadge(ev({ source: 'plano-library', age_min: 15, age_max: 17 }))!
    expect(young.label).toBe(older.label)
    expect(young.sub).toBe(older.sub)
  })
})

describe('getSupervisionBadge — Play Frisco (Tier 3, unverified)', () => {
  test('always defers to the venue', () => {
    const b = getSupervisionBadge(ev({ source: 'play-frisco' }))!
    expect(b.label).toContain('Check with venue')
    expect(b.sub).toContain('before dropping off')
  })
})

describe('getSupervisionBadge — no source match', () => {
  test('unrecognised source → no supervision badge (null)', () => {
    expect(getSupervisionBadge(ev({ source: 'unknown-source' as unknown as EventSource }))).toBeNull()
  })
})

describe('getSupervisionBadge — coverage guard (regression for the silently-dropped-source bug)', () => {
  // Record<EventSource, true> forces a compile error if a new source is added without being
  // listed here; the runtime loop then asserts each one actually renders a badge.
  const ALL_SOURCES: Record<EventSource, true> = {
    'frisco-library': true,
    'plano-library': true,
    'play-frisco': true,
  }
  test('every EventSource returns a supervision badge — none silently drops out', () => {
    for (const source of Object.keys(ALL_SOURCES) as EventSource[]) {
      expect(getSupervisionBadge(ev({ source }))).not.toBeNull()
    }
  })
})
