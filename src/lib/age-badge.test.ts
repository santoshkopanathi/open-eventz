import type { Event } from './types'
import { getAgeBadge, cardAgeBadge, detailAgeBadge, ESTIMATED_TOOLTIP } from './age-badge'

// Weekend Paper palette: confirmed = neutral fill-subtle; inferred = rust accent-tint.
const GOLD_BG = '#F3EDE3'   // confirmed badge bg (fill-subtle)
const INDIGO_BG = '#F6E7DD' // inferred badge bg (accent-tint)

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

describe('getAgeBadge — kinds', () => {
  test('Frisco single group 0–5 → structured-specific "Ages 0–5"', () => {
    const b = getAgeBadge(ev({ source: 'frisco-library', age_min: 0, age_max: 5 }))
    expect(b).toMatchObject({ kind: 'structured-specific', label: 'Ages 0–5', inferred: false })
  })

  test('Frisco teen → "Teens"; Plano teen → "Ages 13–17"', () => {
    expect(getAgeBadge(ev({ source: 'frisco-library', age_min: 13, age_max: 17 }))?.label).toBe('Teens')
    expect(getAgeBadge(ev({ source: 'plano-library', age_min: 13, age_max: 17 }))?.label).toBe('Ages 13–17')
  })

  test('multi-group (not family) → structured-multi with collapsed range, never "Family"', () => {
    const b = getAgeBadge(ev({ source: 'plano-library', age_min: 6, age_max: 17 }))
    expect(b).toMatchObject({ kind: 'structured-multi', label: 'Ages 6–17', inferred: false })
  })

  test('Plano explicit Families (All Ages) → confirmed-family "Family" (gold)', () => {
    const b = getAgeBadge(ev({ source: 'plano-library', age_min: 0, age_max: 17, age_buckets: ['family'] }))
    expect(b).toMatchObject({ kind: 'confirmed-family', label: 'Family', inferred: false, bg: GOLD_BG })
  })

  test('Frisco multi-group spanning 0–17 → structured-multi, NOT family (no family field for Frisco)', () => {
    const b = getAgeBadge(ev({ source: 'frisco-library', age_min: 0, age_max: 17 }))
    expect(b?.kind).toBe('structured-multi')
    expect(b?.label).toBe('Ages 0–17')
  })

  test('Play Frisco inferred family → inferred-family "Family" (indigo)', () => {
    const b = getAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'high', age_buckets: ['family'] }))
    expect(b).toMatchObject({ kind: 'inferred-family', label: 'Family', inferred: true, bg: INDIGO_BG })
  })

  test('Play Frisco inferred specific (teen) → inferred-specific "Ages 13–17"', () => {
    const b = getAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'high', age_buckets: ['teen'] }))
    expect(b).toMatchObject({ kind: 'inferred-specific', label: 'Ages 13–17', inferred: true })
  })

  test('Play Frisco low confidence → no badge', () => {
    expect(getAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'low', age_buckets: ['family'] }))).toBeNull()
  })

  test('Play Frisco kid_relevant false → no badge', () => {
    expect(getAgeBadge(ev({ source: 'play-frisco', kid_relevant: false, age_confidence: 'high', age_buckets: [] }))).toBeNull()
  })

  test('no age data → no badge; adult-only (18–99) → no badge', () => {
    expect(getAgeBadge(ev({ source: 'frisco-library' }))).toBeNull()
    expect(getAgeBadge(ev({ source: 'plano-library', age_min: 18, age_max: 99 }))).toBeNull()
  })
})

describe('cardAgeBadge — what the LIST CARD renders (spec §2)', () => {
  test('confirmed-family → "Family"', () => {
    expect(cardAgeBadge(ev({ source: 'plano-library', age_min: 0, age_max: 17, age_buckets: ['family'] })))
      .toMatchObject({ content: 'Family', bg: GOLD_BG })
  })

  test('inferred-family → "~ Family ✦" with the simplified card tooltip', () => {
    expect(cardAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'medium', age_buckets: ['family'] })))
      .toMatchObject({ content: '~ Family ✦', tooltip: ESTIMATED_TOOLTIP, bg: INDIGO_BG })
  })

  test('inferred-specific → bare "✦" (no age text, no tilde) with the simplified card tooltip', () => {
    expect(cardAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'high', age_buckets: ['teen'] })))
      .toMatchObject({ content: '✦', tooltip: ESTIMATED_TOOLTIP })
  })

  test('structured specific and multi-group → NOT shown on cards', () => {
    expect(cardAgeBadge(ev({ source: 'frisco-library', age_min: 0, age_max: 5 }))).toBeNull()
    expect(cardAgeBadge(ev({ source: 'plano-library', age_min: 6, age_max: 17 }))).toBeNull()
  })
})

describe('detailAgeBadge — what the DETAIL view renders (spec §6)', () => {
  // The estimate disclosure line is no longer per-badge (see inference-disclosure.test.ts);
  // detailAgeBadge only returns the badge chip content now.
  test('structured specific → "Ages 0–5"', () => {
    expect(detailAgeBadge(ev({ source: 'frisco-library', age_min: 0, age_max: 5 })))
      .toMatchObject({ content: 'Ages 0–5' })
  })

  test('multi-group → collapsed range "Ages 6–17"', () => {
    expect(detailAgeBadge(ev({ source: 'plano-library', age_min: 6, age_max: 17 })))
      .toMatchObject({ content: 'Ages 6–17' })
  })

  test('Plano confirmed family → "Family"', () => {
    expect(detailAgeBadge(ev({ source: 'plano-library', age_min: 0, age_max: 17, age_buckets: ['family'] })))
      .toMatchObject({ content: 'Family' })
  })

  test('inferred family → "~ Family ✦"', () => {
    expect(detailAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'high', age_buckets: ['family'] })))
      .toMatchObject({ content: '~ Family ✦' })
  })

  test('inferred specific → "~ Ages 13–17 ✦"', () => {
    expect(detailAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'high', age_buckets: ['teen'] })))
      .toMatchObject({ content: '~ Ages 13–17 ✦' })
  })

  test('low confidence → nothing in detail', () => {
    expect(detailAgeBadge(ev({ source: 'play-frisco', kid_relevant: true, age_confidence: 'low', age_buckets: ['family'] }))).toBeNull()
  })
})
