import type { Event } from '../types'
import { validateParse, retrieve, factTokens, checkAnswer, showingLine, nothingMatched, orderCards, addDays, COPY, misspelledCity, topicWords, onePerProgram, type RawParse } from './core'
import { ask } from './ask'
import { emptyUsage } from './llm'

const TODAY = '2026-11-18' // a Wednesday

function ev(p: Partial<Event>): Event {
  return {
    id: 'e1', source: 'plano-library', title: 'Event', description: null,
    start_datetime: '2026-11-21T16:30:00Z', end_datetime: null,
    location_name: null, location_address: null, location_lat: null, location_lng: null,
    is_free: true, price_text: null, age_min: 0, age_max: 5, age_label: null,
    is_recurring: false, recurrence_label: null, thumbnail_url: null, event_url: '',
    category: null, registration_required: false,
    kid_relevant: null, kid_confidence: null, age_buckets: null, age_basis: null, age_confidence: null, age_reasoning: null,
    price_class: null, price_confidence: null, price_reasoning: null,
    ingested_at: '', created_at: '',
    ...p,
  } as Event
}
const raw = (p: Partial<RawParse>): RawParse => ({ out_of_scope: false, date_from: null, date_to: null, city: null, free_only: false, price_word: false, age_min: null, age_max: null, intent: null, ...p })

describe('validateParse — never guess, never silently widen', () => {
  test('no city named → the parent’s tab decides', () => {
    expect(validateParse(raw({}), 'frisco', TODAY).cities).toEqual(['frisco'])
    expect(validateParse(raw({}), 'plano', TODAY).cities).toEqual(['plano'])
  })
  test('a named city beats the tab; both → tab first', () => {
    expect(validateParse(raw({ city: 'plano' }), 'frisco', TODAY).cities).toEqual(['plano'])
    expect(validateParse(raw({ city: 'both' }), 'plano', TODAY).cities).toEqual(['plano', 'frisco'])
  })
  test('an uncovered city searches nothing (Dallas must not become Plano)', () => {
    const f = validateParse(raw({ city: 'unsupported' }), 'plano', TODAY)
    expect(f.cities).toEqual([]); expect(f.unsupported_city).toBe(true)
  })
  test('past, reversed or >6-month dates are dropped AND the parent is told', () => {
    for (const [a, b] of [['2026-11-01', '2026-11-02'], ['2026-11-25', '2026-11-20'], [addDays(TODAY, 200), addDays(TODAY, 201)]]) {
      const f = validateParse(raw({ date_from: a, date_to: b }), 'plano', TODAY)
      expect([f.date_from, f.date_to]).toEqual([null, null]); expect(f.notes).toContain(COPY.datesDropped)
    }
  })
  test('"this week" asked mid-week is clamped to today, not dropped', () => {
    const f = validateParse(raw({ date_from: '2026-11-16', date_to: '2026-11-22' }), 'plano', TODAY)
    expect([f.date_from, f.date_to]).toEqual([TODAY, '2026-11-22'])
  })
  test('ages outside 0–17 are dropped; a single age becomes a range', () => {
    expect(validateParse(raw({ age_min: 4, age_max: null }), 'plano', TODAY).age).toEqual([4, 4])
    expect(validateParse(raw({ age_min: 18, age_max: 40 }), 'plano', TODAY).age).toBeNull()
  })
  test('a price word adds the note and can never mean free-only', () => {
    const f = validateParse(raw({ price_word: true, free_only: true }), 'plano', TODAY)
    expect(f.free_only).toBe(false); expect(f.notes).toContain(COPY.priceNote)
  })
})

describe('retrieve — the list view’s catalog, then hard filters in code', () => {
  const free = ev({ id: 'free', is_free: true })
  const unknownPF = ev({ id: 'unk', source: 'play-frisco', kid_relevant: true, price_class: 'unknown', is_free: null, age_buckets: ['family'] })
  const freeInferredPF = ev({ id: 'freeI', source: 'play-frisco', kid_relevant: true, price_class: 'free', price_confidence: 'inferred', age_buckets: ['family'] })
  const unclassified = ev({ id: 'nullPF', source: 'play-frisco', kid_relevant: null })
  const adult = ev({ id: 'adult', source: 'frisco-library', age_min: 18, age_max: 99 })
  const sunday = ev({ id: 'sun', start_datetime: '2026-11-22T20:00:00Z' })

  test('free-only keeps Free and Free ✦; unknown never counts as free', () => {
    const f = validateParse(raw({ city: 'both', free_only: true }), 'frisco', TODAY)
    expect(retrieve([free, unknownPF, freeInferredPF], f, TODAY).map(e => e.id).sort()).toEqual(['free', 'freeI'])
  })
  test('unclassified and adults-only events are never retrievable', () => {
    const f = validateParse(raw({ city: 'both' }), 'frisco', TODAY)
    expect(retrieve([unclassified, adult], f, TODAY)).toEqual([])
  })
  test('dates are Central calendar days', () => {
    const f = validateParse(raw({ date_from: '2026-11-21', date_to: '2026-11-21' }), 'plano', TODAY)
    expect(retrieve([free, sunday], f, TODAY).map(e => e.id)).toEqual(['free'])
  })
  test('at most 25 per city, so one busy city can’t crowd out the other', () => {
    const many = Array.from({ length: 40 }, (_, i) => ev({ id: `p${String(i).padStart(2, '0')}` }))
    const one = ev({ id: 'f1', source: 'frisco-library' })
    const f = validateParse(raw({ city: 'both' }), 'plano', TODAY)
    const got = retrieve([...many, one], f, TODAY)
    expect(got).toHaveLength(26); expect(got.at(-1)!.id).toBe('f1')
  })
})

describe('the fact check', () => {
  test('digits, price words, days, parts of day, ages and age words are caught', () => {
    expect(factTokens('Starts at 10', [])).toContain('1')
    for (const w of ['free', 'Saturday', 'morning', 'tonight', 'toddlers', 'teens', 'ages', 'drop', 'tickets', 'November'])
      expect(factTokens(`This is ${w} fun`, [])).toContain(w.toLowerCase())
  })
  test('an exact cited title is not a fact the model stated', () => {
    expect(factTokens('Saturday Music Series has a band.', ['Saturday Music Series at Frisco Fresh Market'])).toContain('saturday')
    expect(factTokens('Saturday Music Series at Frisco Fresh Market has a band.', ['Saturday Music Series at Frisco Fresh Market'])).toEqual([])
  })
  test('words that merely contain a banned word are fine; "little ones" is the known gap', () => {
    expect(factTokens('A stage show with sausage rolls, great for little ones.', [])).toEqual([])
  })
  test('a cited id outside the retrieved set fails the citation check', () => {
    const r = checkAnswer('Fun.', ['made-up'], [ev({ id: 'a' })])
    expect(r.citedOk).toBe(false); expect(r.passed).toBe(false)
  })
})

describe('framing', () => {
  test('the Showing line', () => {
    const f = validateParse(raw({ date_from: '2026-11-21', date_to: '2026-11-21', free_only: true, age_min: 4 }), 'plano', TODAY)
    expect(showingLine(f)).toBe('Showing: Sat Nov 21 · Plano · free · age 4')
  })
  test('nothing matched links the matching filter view', () => {
    const f = validateParse(raw({ date_from: '2026-11-21', date_to: '2026-11-21' }), 'plano', TODAY)
    expect(nothingMatched(f).linkText).toBe('See all Saturday events in Plano')
  })
  test('cards put the parent’s tab city first', () => {
    const p = ev({ id: 'p' }), fr = ev({ id: 'f', source: 'frisco-library' })
    expect(orderCards([fr, p], ['plano', 'frisco']).map(e => e.id)).toEqual(['p', 'f'])
  })
})

describe('city typos (found in the first hands-on test, 2026-11-18)', () => {
  test('near-spellings of Frisco and Plano are recognised; real other places are not', () => {
    expect(misspelledCity('top 3 events in Friso for my 10 year old')).toEqual({ city: 'frisco', word: 'friso' })
    expect(misspelledCity('things in Fricso')?.city).toBe('frisco')
    expect(misspelledCity('anything in Plno?')?.city).toBe('plano')
    for (const q of ['Kids events in Dallas', 'Allen this weekend', 'piano lessons', 'a picnic plan', 'Frisco events']) expect(misspelledCity(q)).toBeNull()
  })
  test('"Friso" parsed as unsupported is searched as Frisco, and the screen says so', async () => {
    const catalog = [ev({ id: 'f', source: 'frisco-library', title: 'Story Hour' })]
    const r = await ask('top 3 events in Friso this Saturday', 'plano', TODAY, catalog, {
      parse: async () => raw({ city: 'unsupported', date_from: '2026-11-21', date_to: '2026-11-21' }),
      select: async () => ({ cited: ['f'], answer: 'Story Hour has songs.' }),
    }, emptyUsage())
    expect(r.showing).toContain('Frisco'); expect(r.notes[0]).toBe('We read “friso” as Frisco.'); expect(r.cards.map(e => e.id)).toEqual(['f'])
  })
})

describe('owner decisions, 2026-11-19', () => {
  test('LIBRARY CLOSED notices are never retrieved', () => {
    const f = validateParse(raw({ city: 'frisco', date_from: '2026-11-26', date_to: '2026-11-26' }), 'frisco', TODAY)
    const closed = ev({ id: 'c', source: 'frisco-library', title: 'LIBRARY CLOSED', start_datetime: '2026-11-26T06:00:00Z', age_min: 0, age_max: 17 })
    expect(retrieve([closed], f, TODAY)).toEqual([])
  })

  test('topic first: an undated "chess" question reaches a chess event past the first 25', () => {
    const early = Array.from({ length: 30 }, (_, i) => ev({ id: `s${String(i).padStart(2, '0')}`, title: 'Storytime', start_datetime: `2026-11-${String(19 + (i % 9)).padStart(2, '0')}T16:00:00Z` }))
    const chess = ev({ id: 'chess', title: 'Chess Meet-Up', start_datetime: '2026-12-11T22:00:00Z' })
    const f = validateParse(raw({ intent: 'chess' }), 'plano', TODAY)
    const got = retrieve([...early, chess], f, TODAY)
    expect(got).toHaveLength(25); expect(got[0].id).toBe('chess')
  })

  describe('query expansion (2026-11-21)', () => {
    const early = Array.from({ length: 30 }, (_, i) => ev({ id: `s${String(i).padStart(2, '0')}`, title: 'Storytime', start_datetime: `2026-11-${String(19 + (i % 9)).padStart(2, '0')}T16:00:00Z` }))
    const raptors = ev({ id: 'raptors', title: 'Live Raptors', description: 'Meet birds of prey.', start_datetime: '2026-12-11T22:00:00Z' })

    test('progression: a synonym reaches an event past the first 25 ("animals" → raptors)', () => {
      const without = retrieve([...early, raptors], validateParse(raw({ intent: 'animals' }), 'plano', TODAY), TODAY)
      expect(without.map(e => e.id)).not.toContain('raptors') // the gap: no event says "animals"
      const f = validateParse(raw({ intent: 'animals', related: ['raptors', 'insects', 'zoo'] }), 'plano', TODAY)
      const got = retrieve([...early, raptors], f, TODAY)
      expect(got).toHaveLength(25); expect(got[0].id).toBe('raptors')
    })

    test("the parent's own word ranks above a related word", () => {
      const animalShow = ev({ id: 'animal', title: 'Animal Tales', start_datetime: '2026-12-20T22:00:00Z' })
      const f = validateParse(raw({ intent: 'animals', related: ['raptors'] }), 'plano', TODAY)
      expect(retrieve([...early, raptors, animalShow], f, TODAY).slice(0, 2).map(e => e.id)).toEqual(['animal', 'raptors'])
    })

    test('a related word that matches most events is ignored as too broad', () => {
      const f = validateParse(raw({ intent: 'reading', related: ['storytime', 'raptors'] }), 'plano', TODAY)
      // "storytime" matches 30 of 31 events: it can't tell them apart, so raptors still goes first.
      expect(retrieve([...early, raptors], f, TODAY)[0].id).toBe('raptors')
    })

    test('regression: related words never bring in an event that fails a hard filter', () => {
      const frisco = ev({ id: 'frisco-raptors', source: 'frisco-library', title: 'Raptor Day', start_datetime: '2026-12-11T22:00:00Z' })
      const f = validateParse(raw({ intent: 'animals', related: ['raptor'] }), 'plano', TODAY)
      expect(retrieve([...early, frisco], f, TODAY).map(e => e.id)).not.toContain('frisco-raptors')
    })

    test('related words are cleaned: filler dropped, topic words not repeated, at most 8', () => {
      const f = validateParse(raw({ intent: 'animals', related: ['Animals', 'fun', 'kids', 'owls', 'owls', 'a', 'b1', 'reptiles', 'zoo', 'farm', 'pets', 'birds', 'wildlife', 'insects'] }), 'plano', TODAY)
      expect(f.related).toEqual(['owls', 'reptiles', 'farm', 'pets', 'birds', 'wildlife', 'insects'])
      expect(validateParse(raw({}), 'plano', TODAY).related).toEqual([])
    })
  })

  test('topic words ignore filler ("robotics class" → robotics; "swimming lessons" → swimming)', () => {
    expect(topicWords('robotics class')).toEqual(['robotics'])
    expect(topicWords('swimming lessons')).toEqual(['swimming'])
    expect(topicWords('science or space')).toEqual(['science', 'space'])
    expect(topicWords(null)).toEqual([])
  })

  test('one card per program, unless the parent asked for that very thing', () => {
    const a = ev({ id: 'a', title: 'Family Storytime' }), b = ev({ id: 'b', title: 'Family Storytime' }), c = ev({ id: 'c', title: 'Art Shop' })
    expect(onePerProgram([a, b, c], null).map(e => e.id)).toEqual(['a', 'c'])
    expect(onePerProgram([a, b, c], 'storytime').map(e => e.id)).toEqual(['a', 'b', 'c'])
  })

  test('the new price note', () => {
    expect(COPY.priceNote).toBe("Open Eventz only shows whether an event is 'free' or 'paid'. It does not determine if something is cheap or pricey.")
  })

  test('an uncovered city: Nothing matched, then a headed set from the tab city, never a silent swap', async () => {
    const plano = [ev({ id: 'p1', title: 'Family Storytime' }), ev({ id: 'p2', title: 'Family Storytime' }), ev({ id: 'p3', title: 'Art Shop' })]
    const frisco = ev({ id: 'f1', source: 'frisco-library', title: 'Faire' })
    let mode: string | undefined
    const r = await ask('Kids events in Dallas this Saturday', 'plano', TODAY, [...plano, frisco], {
      parse: async () => raw({ city: 'unsupported', date_from: '2026-11-21', date_to: '2026-11-21' }),
      select: async (_q, _i, events, _u, o) => { mode = o?.mode; return { cited: events.map(e => e.id), answer: 'x' } },
    }, emptyUsage())
    expect(r.kind).toBe('nothing'); expect(r.nothing?.text).toBe(`Nothing matched. ${COPY.unsupportedCity}`)
    expect(r.cards).toEqual([]); expect(mode).toBe('fallback')
    expect(r.fallback?.heading).toBe('Here are a few events in Plano on Saturday, Nov 21:')
    expect(r.fallback?.cards.map(e => e.id)).toEqual(['p1', 'p3'])
  })
})

describe('ask — fail closed', () => {
  const catalog = [ev({ id: 'a', title: 'Story Hour' })]
  const parse = async () => raw({ date_from: '2026-11-21', date_to: '2026-11-21' })
  test('a passing answer is shown with its cards and the disclosure', async () => {
    const r = await ask('q', 'plano', TODAY, catalog, { parse, select: async () => ({ cited: ['a'], answer: 'Story Hour has songs and books.' }) }, emptyUsage())
    expect(r.kind).toBe('answer'); expect(r.cards.map(e => e.id)).toEqual(['a']); expect(r.disclosure).toBe(COPY.disclosure)
  })
  test('an answer stating a fact is dropped; the cards show alone', async () => {
    const r = await ask('q', 'plano', TODAY, catalog, { parse, select: async () => ({ cited: ['a'], answer: 'Story Hour is free on Saturday.' }) }, emptyUsage())
    expect(r.kind).toBe('cards'); expect(r.answer).toBeNull(); expect(r.cards).toHaveLength(1)
  })
  test('an invented event never becomes a card', async () => {
    const r = await ask('q', 'plano', TODAY, catalog, { parse, select: async () => ({ cited: ['ghost', 'a'], answer: 'Fun.' }) }, emptyUsage())
    expect(r.kind).toBe('cards'); expect(r.cards.map(e => e.id)).toEqual(['a'])
  })
  test('off-topic gets the redirect only', async () => {
    const r = await ask('q', 'plano', TODAY, catalog, { parse: async () => raw({ out_of_scope: true }), select: async () => null }, emptyUsage())
    expect(r.kind).toBe('off_topic'); expect(r.offTopic).toBe(COPY.offTopic); expect(r.cards).toEqual([])
  })
  test('nothing retrieved → the one-line no-match, and the select call is never made', async () => {
    const select = jest.fn()
    const r = await ask('q', 'frisco', TODAY, catalog, { parse, select }, emptyUsage())
    expect(r.kind).toBe('nothing'); expect(select).not.toHaveBeenCalled()
  })
})
