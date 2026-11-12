import { freeze, scorable, coverage, type FrozenEvent, type Label } from './eval-set'

const ev = (id: string, description = 'original text'): FrozenEvent => ({
  id, source: 'play-frisco', title: id, description,
  start_datetime: null, registration_required: false, captured_at: '2026-11-11T00:00:00Z',
})

describe('freeze — append-only, because a refreshed input invalidates its label', () => {
  it('captures events it has not seen before', () => {
    const { merged, added } = freeze([], [ev('a'), ev('b')])
    expect(added).toHaveLength(2)
    expect(merged.map(e => e.id)).toEqual(['a', 'b'])
  })

  it('REFUSES to overwrite a LABELLED event, even when the source text changed', () => {
    // This is the whole guarantee. If the source edits a description after a human labelled
    // it, accepting the edit silently makes the label the answer to a different question.
    const { merged, added } = freeze([ev('a', 'original text')], [ev('a', 'EDITED text')], new Set(['a']))
    expect(added).toHaveLength(0)
    expect(merged).toHaveLength(1)
    expect(merged[0].description).toBe('original text')
  })

  it('reports how many were kept untouched, so shrinkage can never be silent', () => {
    const { kept, added } = freeze([ev('a')], [ev('a'), ev('b')])
    expect(kept).toBe(1)
    expect(added.map(e => e.id)).toEqual(['b'])
  })
})

describe('scorable — a score may only come from a frozen input WITH a label', () => {
  const events = [ev('a'), ev('b')]
  const labels: Label[] = [
    { id: 'a', kid: 'yes', price: 'free' },
    { id: 'gone', kid: 'yes', price: 'paid' }, // label whose input text was lost
  ]

  it('pairs only events that have a label', () => {
    expect(scorable({ events, labels }).map(p => p.event.id)).toEqual(['a'])
  })

  it('excludes a label that is empty in both fields', () => {
    expect(scorable({ events, labels: [{ id: 'a', kid: null, price: null }] })).toHaveLength(0)
  })

  it('never scores a label whose frozen input is missing', () => {
    // The 2026-11-11 failure: 56 labels survived, their event text did not. Counting them
    // would be scoring answers to questions nobody holds.
    expect(scorable({ events, labels }).some(p => p.event.id === 'gone')).toBe(false)
  })
})

describe('coverage — the decay has to be reported next to the score', () => {
  it('reports orphan labels so a shrinking set is visible, not inferred', () => {
    const c = coverage({
      events: [ev('a'), ev('b')],
      labels: [{ id: 'a', kid: 'yes', price: 'free' }, { id: 'gone', kid: 'yes', price: 'paid' }],
    })
    expect(c).toMatchObject({ frozen: 2, labelled: 2, scorable: 1, unlabelled: 1, orphanLabels: 1 })
  })
})

describe('structural guard — the eval must call production, never a copy of it', () => {
  const read = (p: string) => require('node:fs').readFileSync(p, 'utf8') as string

  it('eval-run.ts imports the production classifier and the production price rule', () => {
    const src = read('scripts/eval-run.ts')
    expect(src).toMatch(/import \{ inferPlayFriscoEvent \} from '\.\.\/src\/lib\/age-inference'/)
    expect(src).toMatch(/import \{ resolvePriceClass \} from '\.\.\/src\/lib\/price'/)
  })

  it('eval-run.ts applies visibleText to BOTH inputs, as ingest does', () => {
    // Skipping this would test the classifier on text ingest never sends it, and would
    // re-open the hidden-instruction path the red-team run closed.
    const src = read('scripts/eval-run.ts')
    expect(src).toMatch(/visibleText\(event\.title\)/)
    expect(src).toMatch(/visibleText\(event\.description\)/)
  })

  it('no eval script holds its own system prompt', () => {
    // The failure this guard exists for: the previous harness kept a pasted SYSTEM_PROMPT
    // that had drifted to 5681 chars against production's 5340. Every run measured a prompt
    // the site does not use, and nothing anywhere said so.
    for (const f of ['scripts/eval-run.ts', 'scripts/eval-score.ts', 'scripts/eval-snapshot.ts']) {
      expect(read(f)).not.toMatch(/SYSTEM_PROMPT\s*=\s*[`'"]/)
    }
  })
})

describe('freeze — the freeze protects answered questions, not bytes', () => {
  it('REFRESHES an unlabelled event when the source text has moved', () => {
    // Why this is not a loophole. The first snapshot captured 17 descriptions the source had
    // truncated at 200 chars, and the connector fix landed hours later. Holding those forever
    // would mean hand-labelling a known-bad input on purpose, and every run afterwards would
    // score the model against a defect already repaired.
    const { merged, refreshed, added } = freeze(
      [ev('a', 'truncated…')],
      [ev('a', 'the full description, recovered')],
      new Set(), // nothing labelled
    )
    expect(refreshed.map(e => e.id)).toEqual(['a'])
    expect(added).toHaveLength(0)
    expect(merged[0].description).toBe('the full description, recovered')
  })

  it('a label is the thing that makes an input immutable — not the passage of time', () => {
    const existing = [ev('a', 'original')]
    const incoming = [ev('a', 'changed')]
    expect(freeze(existing, incoming, new Set(['a'])).merged[0].description).toBe('original')
    expect(freeze(existing, incoming, new Set()).merged[0].description).toBe('changed')
  })

  it('does not count an unchanged unlabelled event as refreshed', () => {
    // Otherwise every snapshot would report churn it did not cause.
    const { refreshed, added } = freeze([ev('a', 'same')], [ev('a', 'same')], new Set())
    expect(refreshed).toHaveLength(0)
    expect(added).toHaveLength(0)
  })

  it('keeps the ORIGINAL capture timestamp through a refresh', () => {
    // The set should still record when an input first entered it, or "frozen since" becomes
    // meaningless and a long-standing event looks new.
    const old = { ...ev('a', 'truncated…'), captured_at: '2026-11-11T00:00:00Z' }
    const fresh = { ...ev('a', 'full text'), captured_at: '2026-12-01T00:00:00Z' }
    const { merged } = freeze([old], [fresh], new Set())
    expect(merged[0].description).toBe('full text')
    expect(merged[0].captured_at).toBe('2026-11-11T00:00:00Z')
  })

  it('treats a title change as a refresh too, not just the description', () => {
    const { refreshed } = freeze([ev('a')], [{ ...ev('a'), title: 'renamed' }], new Set())
    expect(refreshed.map(e => e.id)).toEqual(['a'])
  })
})

describe('eval-snapshot passes the labelled ids, or the protection does nothing', () => {
  it('builds labelledIds from the labels file and hands them to freeze', () => {
    // freeze() defaults labelledIds to an empty set, so a caller that forgets this argument
    // silently makes every frozen input mutable — the exact failure the module exists to stop.
    const src = require('node:fs').readFileSync('scripts/eval-snapshot.ts', 'utf8') as string
    expect(src).toMatch(/const labelledIds = new Set\(/)
    expect(src).toMatch(/freeze\(existing, incoming, labelledIds\)/)
  })
})

describe('the worksheet asks one question per program, not per date', () => {
  const src = require('node:fs').readFileSync('scripts/eval-worksheet.ts', 'utf8') as string

  it('groups by title + description, so a 30-date series is one judgment', () => {
    expect(src).toMatch(/function programKey/)
    expect(src).toMatch(/function group\(/)
  })

  it('writes every id of the group into the block and applies the answer to all of them', () => {
    // Without the fan-out the user answers once and 29 dates stay unlabelled, which would
    // look like the worksheet silently losing their work.
    expect(src).toMatch(/<!-- ids: /)
    expect(src).toMatch(/for \(const id of ids\)/)
  })

  it('shows the FULLEST text in the group', () => {
    // A truncated copy is a past occurrence the nightly fetch cannot refresh. Labelling the
    // short version would hand the eval the very input defect the connector fix removed.
    expect(src).toMatch(/\.length - \(a\.description \?\? ''\)\.length/)
  })
})
