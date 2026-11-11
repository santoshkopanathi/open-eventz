import { tally, gates, rowsWorthRetrying, type ScorableRow } from './eval-score'

const shipped = (price_class: string, shown = true) => ({ price_class, price_confidence: 'inferred', shown })
const row = (p: Partial<ScorableRow>): ScorableRow => ({
  id: 'x', title: 't', label_kid: null, label_price: null, shipped: shipped('unknown'), error: null, ...p,
})

describe('tally — the four directions are counted separately', () => {
  it('counts a wrongly-free: we said free, the human said paid', () => {
    const c = tally([row({ label_price: 'paid', shipped: shipped('free') })])
    expect(c.wronglyFree).toBe(1)
    expect(c.agree).toBe(0)
  })

  it('counts an over-claim: we badged a price the human could not determine', () => {
    const c = tally([row({ label_price: 'unknown', shipped: shipped('free') })])
    expect(c.overClaim).toBe(1)
    // An over-claim is NOT agreement, even though nothing visible went wrong.
    expect(c.agree).toBe(0)
    expect(c.wronglyFree).toBe(0)
  })

  it('counts an under-claim: the text stated a price and we showed nothing', () => {
    const c = tally([row({ label_price: 'paid', shipped: shipped('unknown') })])
    expect(c.underClaim).toBe(1)
    expect(c.wronglyFree).toBe(0)
  })

  it('does not count silence on an undeterminable price as any kind of error', () => {
    const c = tally([row({ label_price: 'unknown', shipped: shipped('unknown') })])
    expect(c).toMatchObject({ overClaim: 0, underClaim: 0, wronglyFree: 0, badged: 0 })
  })

  it('counts agreement only when the badge matches a determinable label', () => {
    const c = tally([
      row({ label_price: 'free', shipped: shipped('free') }),
      row({ label_price: 'paid', shipped: shipped('paid') }),
    ])
    expect(c.agree).toBe(2)
    expect(c.badged).toBe(2)
  })

  it('counts a leak: an event the human said was not for children, shown anyway', () => {
    const c = tally([row({ label_kid: 'no', shipped: shipped('unknown', true) })])
    expect(c.leaked).toBe(1)
  })

  it('counts wrongly-hidden separately from leaked — the two directions never merge', () => {
    const c = tally([
      row({ label_kid: 'yes', shipped: shipped('unknown', false) }),
      row({ label_kid: 'no', shipped: shipped('unknown', true) }),
    ])
    expect(c.wronglyHidden).toBe(1)
    expect(c.leaked).toBe(1)
  })
})

describe('tally — a non-decision must never read as a pass', () => {
  // inferPlayFriscoEvent returns null when no decision was made. If that counted as
  // agreement, a total API outage would score as a flawless run.
  it('counts an errored row as an error and scores nothing from it', () => {
    const c = tally([row({ label_price: 'paid', error: 'boom', shipped: null })])
    expect(c.errors).toBe(1)
    expect(c.scored).toBe(0)
    expect(c.agree).toBe(0)
    expect(c.wronglyFree).toBe(0)
  })

  it('treats a missing shipped verdict as an error even with no error string', () => {
    const c = tally([row({ label_price: 'paid', shipped: null })])
    expect(c.errors).toBe(1)
    expect(c.scored).toBe(0)
  })
})

describe('gates', () => {
  const base = tally([])

  it('fails on any wrongly-free, however small the sample', () => {
    const now = tally([row({ label_price: 'paid', shipped: shipped('free') })])
    expect(gates(now, base).find(g => g.name === 'wrongly-free')!.pass).toBe(false)
  })

  it('fails on any leak', () => {
    const now = tally([row({ label_kid: 'no', shipped: shipped('unknown', true) })])
    expect(gates(now, base).find(g => g.name === 'leaked non-kid events')!.pass).toBe(false)
  })

  it('passes over-claim when it holds steady, fails when it rises', () => {
    const one = tally([row({ label_price: 'unknown', shipped: shipped('free') })])
    const two = tally([
      row({ label_price: 'unknown', shipped: shipped('free') }),
      row({ id: 'y', label_price: 'unknown', shipped: shipped('paid') }),
    ])
    expect(gates(one, one).find(g => g.name === 'over-claim')!.pass).toBe(true)
    expect(gates(two, one).find(g => g.name === 'over-claim')!.pass).toBe(false)
    // Falling is always fine — the gate is on increase, not on change.
    expect(gates(one, two).find(g => g.name === 'over-claim')!.pass).toBe(true)
  })

  it('omits the over-claim gate entirely when no baseline has been accepted', () => {
    expect(gates(tally([]), null).map(g => g.name)).not.toContain('over-claim')
  })
})

describe('rowsWorthRetrying — retry to confirm a failure, never to improve an aggregate', () => {
  it('retries a wrongly-free, to ask whether it reproduces', () => {
    const rows = [row({ id: 'wf', label_price: 'paid', shipped: shipped('free') })]
    expect(rowsWorthRetrying(rows)).toEqual(['wf'])
  })

  it('retries a leak', () => {
    const rows = [row({ id: 'leak', label_kid: 'no', shipped: shipped('unknown', true) })]
    expect(rowsWorthRetrying(rows)).toEqual(['leak'])
  })

  it('retries an errored row and one with no verdict', () => {
    const rows = [
      row({ id: 'err', error: 'boom', shipped: null }),
      row({ id: 'none', shipped: null }),
    ]
    expect(rowsWorthRetrying(rows).sort()).toEqual(['err', 'none'])
  })

  it('does NOT retry an over-claim', () => {
    // The asymmetry is the point. Over-claim is a count compared to a baseline, so re-rolling
    // only the events that pushed it up can lower the number and never raise it — a biased
    // resample, i.e. a mechanism for passing rather than for measuring.
    const rows = [row({ id: 'oc', label_price: 'unknown', shipped: shipped('free') })]
    expect(rowsWorthRetrying(rows)).toEqual([])
  })

  it('does not retry a healthy row', () => {
    expect(rowsWorthRetrying([row({ label_price: 'free', shipped: shipped('free') })])).toEqual([])
  })
})

describe('structural guard — the CI gate must use the retry before failing', () => {
  const read = (p: string) => require('node:fs').readFileSync(p, 'utf8') as string

  it('eval-run.ts exposes --retry-failures and merges results over the previous run', () => {
    const src = read('scripts/eval-run.ts')
    expect(src).toMatch(/--retry-failures/)
    expect(src).toMatch(/rowsWorthRetrying/)
    // Merging matters: a retry that wrote only the retried rows would shrink the set to the
    // failures, and the next score would be computed from them alone.
    expect(src).toMatch(/priorRows\.map\(/)
  })
})
