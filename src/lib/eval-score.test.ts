import { tally, gates, type ScorableRow } from './eval-score'

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
