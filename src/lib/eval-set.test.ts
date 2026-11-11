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

  it('REFUSES to overwrite an event already frozen, even when the source text changed', () => {
    // This is the whole guarantee. If the source edits a description after a human labelled
    // it, accepting the edit silently makes the label the answer to a different question.
    const { merged, added } = freeze([ev('a', 'original text')], [ev('a', 'EDITED text')])
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
