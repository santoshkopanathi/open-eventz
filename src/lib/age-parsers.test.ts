import { parseFriscoSuitableFor, parseCommunicoAgeGroup, communicoIsFamily, mapFriscoAudienceIds } from './age-parsers'

// ---------------------------------------------------------------------------
// mapFriscoAudienceIds — the JSON-API replacement for the (now client-rendered)
// "Suitable for:" scrape. Taxonomy mirrors BiblioCommons' 6 real audience IDs.
// ---------------------------------------------------------------------------

describe('mapFriscoAudienceIds', () => {
  const TAX = new Map<string, string>([
    ['adult', 'Adults'],
    ['teen', 'Teens'],
    ['c05', 'Children (0-5)'],
    ['c612', 'Children (6-12)'],
    ['tween', 'Tween (10-13)'],
    ['all', 'All Ages'],
  ])

  test('empty audience_ids → all-null (caller uses the all-ages fallback + counts it)', () => {
    expect(mapFriscoAudienceIds([], TAX)).toEqual({ age_min: null, age_max: null, age_label: null })
  })

  test('unknown ids (source changed shape) → all-null', () => {
    expect(mapFriscoAudienceIds(['nope'], TAX)).toEqual({ age_min: null, age_max: null, age_label: null })
  })

  test('Children (0-5) only → 0–5 with label', () => {
    expect(mapFriscoAudienceIds(['c05'], TAX)).toEqual({ age_min: 0, age_max: 5, age_label: 'Children (0-5)' })
  })

  test('Adults only → 18–99 (excluded downstream) — the D&D-for-Adults case', () => {
    expect(mapFriscoAudienceIds(['adult'], TAX)).toEqual({ age_min: 18, age_max: 99, age_label: null })
  })

  test('Adults + Teens → 13–17 (not 0–17) — the Uke-Can-Do-It case', () => {
    expect(mapFriscoAudienceIds(['adult', 'teen'], TAX)).toEqual({ age_min: 13, age_max: 17, age_label: null })
  })

  test('Adults + young kids → 0–17 (young child governs)', () => {
    expect(mapFriscoAudienceIds(['adult', 'c05'], TAX)).toEqual({ age_min: 0, age_max: 17, age_label: null })
  })

  test('Children (6-12) + Tween → union 6–13', () => {
    expect(mapFriscoAudienceIds(['c612', 'tween'], TAX)).toEqual({ age_min: 6, age_max: 13, age_label: null })
  })

  test('All Ages only → 0–17', () => {
    expect(mapFriscoAudienceIds(['all'], TAX)).toEqual({ age_min: 0, age_max: 17, age_label: 'All Ages' })
  })

  test('Teens only → 13–17', () => {
    expect(mapFriscoAudienceIds(['teen'], TAX)).toEqual({ age_min: 13, age_max: 17, age_label: 'Teens' })
  })
})

// ---------------------------------------------------------------------------
// parseFriscoSuitableFor
// ---------------------------------------------------------------------------

describe('parseFriscoSuitableFor', () => {
  function wrap(content: string) {
    return `<div>Suitable for: ${content}</div>`
  }

  test('returns null when no Suitable for block present', () => {
    const result = parseFriscoSuitableFor('<html><body>No audience info here</body></html>')
    expect(result).toEqual({ age_min: null, age_max: null, age_label: null })
  })

  test('Children (0-5) only → age 0–5', () => {
    const result = parseFriscoSuitableFor(wrap('Children (0-5)'))
    expect(result).toEqual({ age_min: 0, age_max: 5, age_label: 'Children (0–5)' })
  })

  test('Children (6-12) only → age 6–12', () => {
    const result = parseFriscoSuitableFor(wrap('Children (6-12)'))
    expect(result).toEqual({ age_min: 6, age_max: 12, age_label: 'Children (6–12)' })
  })

  test('Teens only → age 13–17', () => {
    const result = parseFriscoSuitableFor(wrap('Teens'))
    expect(result).toEqual({ age_min: 13, age_max: 17, age_label: 'Teens' })
  })

  test('Adults only → age 18–99, excluded from child filters', () => {
    const result = parseFriscoSuitableFor(wrap('Adults'))
    expect(result).toEqual({ age_min: 18, age_max: 99, age_label: null })
  })

  test('Adults + Children (0-5) → age 0–17, shown in all child filters', () => {
    const result = parseFriscoSuitableFor(wrap('Adults, Children (0-5)'))
    expect(result).toEqual({ age_min: 0, age_max: 17, age_label: null })
  })

  test('Adults + Teens → age 13–17, teens can attend but not young kids', () => {
    const result = parseFriscoSuitableFor(wrap('Adults, Teens'))
    expect(result).toEqual({ age_min: 13, age_max: 17, age_label: null })
  })

  test('Children (0-5) + Children (6-12) → union 0–12, no label', () => {
    const result = parseFriscoSuitableFor(wrap('Children (0-5), Children (6-12)'))
    expect(result).toEqual({ age_min: 0, age_max: 12, age_label: null })
  })

  test('Children (0-5) + Teens → union 0–17, no label', () => {
    const result = parseFriscoSuitableFor(wrap('Children (0-5), Teens'))
    expect(result).toEqual({ age_min: 0, age_max: 17, age_label: null })
  })

  test('Seniors (alias for adult) → age 18–99', () => {
    const result = parseFriscoSuitableFor(wrap('Seniors'))
    expect(result).toEqual({ age_min: 18, age_max: 99, age_label: null })
  })

  test('case-insensitive matching', () => {
    const result = parseFriscoSuitableFor(wrap('TEENS'))
    expect(result).toEqual({ age_min: 13, age_max: 17, age_label: 'Teens' })
  })
})

// ---------------------------------------------------------------------------
// parseCommunicoAgeGroup
// ---------------------------------------------------------------------------

describe('parseCommunicoAgeGroup', () => {
  function wrap(links: string) {
    return `<div>AGE GROUP: ${links}</div>`
  }

  function link(audience: string) {
    return `<a href="/events?a=${audience}">${audience}</a>`
  }

  test('returns null when no AGE GROUP block present', () => {
    const result = parseCommunicoAgeGroup('<html><body>No age group here</body></html>')
    expect(result).toEqual({ age_min: null, age_max: null, age_label: null })
  })

  test('Babies → age 0–1 with label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Babies')))
    expect(result).toEqual({ age_min: 0, age_max: 1, age_label: 'Babies' })
  })

  test('Toddlers → age 1–3 with label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Toddlers')))
    expect(result).toEqual({ age_min: 1, age_max: 3, age_label: 'Toddlers' })
  })

  test('Preschoolers → age 3–5 with label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Preschoolers')))
    expect(result).toEqual({ age_min: 3, age_max: 5, age_label: 'Preschoolers' })
  })

  test('Kids → age 6–12 with label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Kids')))
    expect(result).toEqual({ age_min: 6, age_max: 12, age_label: 'Kids (6–12)' })
  })

  test('Teens → age 13–17 with label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Teens')))
    expect(result).toEqual({ age_min: 13, age_max: 17, age_label: 'Teens' })
  })

  test('Families+(All+Ages) → age 0–17 with label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Families+(All+Ages)')))
    expect(result).toEqual({ age_min: 0, age_max: 17, age_label: 'All Ages' })
  })

  test('Families+%28All+Ages%29 (real URL-encoded parens from feed) → age 0–17 with label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Families+%28All+Ages%29')))
    expect(result).toEqual({ age_min: 0, age_max: 17, age_label: 'All Ages' })
  })

  test('Kids + Families+%28All+Ages%29 → union 0–17 (shows under every age chip)', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Kids') + link('Families+%28All+Ages%29')))
    expect(result).toEqual({ age_min: 0, age_max: 17, age_label: null })
  })

  test('Adults → age 18–99, excluded from child filters', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Adults')))
    expect(result).toEqual({ age_min: 18, age_max: 99, age_label: 'Adults' })
  })

  test('Older+Adults → age 18–99', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Older+Adults')))
    expect(result).toEqual({ age_min: 18, age_max: 99, age_label: 'Older Adults' })
  })

  test('Babies + Toddlers → union 0–3, no label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Babies') + link('Toddlers')))
    expect(result).toEqual({ age_min: 0, age_max: 3, age_label: null })
  })

  test('Toddlers + Preschoolers + Families → union 0–17, no label', () => {
    const result = parseCommunicoAgeGroup(
      wrap(link('Toddlers') + link('Preschoolers') + link('Families+(All+Ages)'))
    )
    expect(result).toEqual({ age_min: 0, age_max: 17, age_label: null })
  })

  test('Adults + Older+Adults → age 18–99, no label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Adults') + link('Older+Adults')))
    expect(result).toEqual({ age_min: 18, age_max: 99, age_label: null })
  })

  test('Kids + Teens → union 6–17, no label', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Kids') + link('Teens')))
    expect(result).toEqual({ age_min: 6, age_max: 17, age_label: null })
  })

  test('Kids + Adults → 6–12 (adult range excluded, does not bleed into Teens)', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Kids') + link('Adults')))
    expect(result).toEqual({ age_min: 6, age_max: 12, age_label: null })
  })

  test('Teens + Older+Adults → 13–17 (adult range excluded)', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Teens') + link('Older+Adults')))
    expect(result).toEqual({ age_min: 13, age_max: 17, age_label: null })
  })

  test('unknown audience value → null', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Unknown+Group')))
    expect(result).toEqual({ age_min: null, age_max: null, age_label: null })
  })
})

// ---------------------------------------------------------------------------
// communicoIsFamily
// ---------------------------------------------------------------------------

describe('communicoIsFamily', () => {
  function wrap(links: string) {
    return `<div>AGE GROUP: ${links}</div>`
  }
  function link(audience: string) {
    return `<a href="/events?a=${audience}">${audience}</a>`
  }

  test('explicit Families+%28All+Ages%29 tag → true', () => {
    expect(communicoIsFamily(wrap(link('Families+%28All+Ages%29')))).toBe(true)
  })

  test('Families tag combined with a specific group → true', () => {
    expect(communicoIsFamily(wrap(link('Kids') + link('Families+%28All+Ages%29')))).toBe(true)
  })

  test('literal-parens form also matches → true', () => {
    expect(communicoIsFamily(wrap(link('Families+(All+Ages)')))).toBe(true)
  })

  test('non-family audiences spanning 0–17 → false (not the explicit tag)', () => {
    expect(communicoIsFamily(wrap(link('Babies') + link('Teens')))).toBe(false)
  })

  test('no AGE GROUP block → false', () => {
    expect(communicoIsFamily('<html><body>nothing</body></html>')).toBe(false)
  })
})
