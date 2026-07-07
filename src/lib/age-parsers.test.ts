import { parseFriscoSuitableFor, parseCommunicoAgeGroup } from './age-parsers'

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

  test('unknown audience value → null', () => {
    const result = parseCommunicoAgeGroup(wrap(link('Unknown+Group')))
    expect(result).toEqual({ age_min: null, age_max: null, age_label: null })
  })
})
