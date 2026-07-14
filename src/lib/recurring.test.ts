import { normalizeTitle, markRecurring, type RecurringMarkable } from './recurring'

function e(source: string, title: string, extra: Partial<RecurringMarkable> = {}): RecurringMarkable {
  return { source, title, is_recurring: false, recurrence_label: null, ...extra }
}

describe('normalizeTitle', () => {
  test('lowercases, trims, collapses whitespace', () => {
    expect(normalizeTitle('  Walnut   Wednesdays ')).toBe('walnut wednesdays')
    expect(normalizeTitle('WALNUT WEDNESDAYS')).toBe('walnut wednesdays')
  })
})

describe('markRecurring', () => {
  test('title on 2+ dates (same source) → all flagged recurring; single → not', () => {
    const events = [
      e('play-frisco', 'Walnut Wednesdays'),
      e('play-frisco', 'Walnut Wednesdays '),   // whitespace variant
      e('play-frisco', 'walnut wednesdays'),     // case variant
      e('play-frisco', 'Fun Float Night'),       // single occurrence
    ]
    markRecurring(events)
    expect(events.slice(0, 3).every(x => x.is_recurring)).toBe(true)
    expect(events[0].recurrence_label).toBe('Recurring')
    expect(events[3].is_recurring).toBe(false)
  })

  test('same title in different sources is not merged', () => {
    const events = [
      e('play-frisco', 'Story Time'),
      e('frisco-library', 'Story Time'),
    ]
    markRecurring(events)
    expect(events[0].is_recurring).toBe(false)
    expect(events[1].is_recurring).toBe(false)
  })

  test('does not clear an existing is_recurring=true and keeps an existing label', () => {
    const events = [
      e('frisco-library', 'Storytime', { is_recurring: true, recurrence_label: 'Weekly' }),
    ]
    markRecurring(events)
    expect(events[0].is_recurring).toBe(true)
    expect(events[0].recurrence_label).toBe('Weekly') // not overwritten
  })
})
