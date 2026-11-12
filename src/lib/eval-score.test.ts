import { tally, gates, rowsWorthRetrying, NOISE_FLOOR, type Counts, type ScorableRow } from './eval-score'

const mkCounts = (scored: number, overClaim: number): Counts => ({
  scored, overClaim, wronglyFree: 0, underClaim: 0, agree: 0,
  badged: 0, leaked: 0, wronglyHidden: 0, errors: 0,
})

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

  it('tolerates over-claim movement up to the MEASURED noise floor, flags more', () => {
    // Measured 2026-11-12: four runs over an unchanged 65-event set gave over-claim
    // 16, 18, 18, 17 — a spread of 2, from two borderline workshops the model oscillates on.
    // A "any increase fails" rule against a count that moves by 2 on its own would fail about
    // half of all clean runs, and a gate that cries wolf gets routed around within a week.
    const base = mkCounts(65, 16)
    expect(gates(mkCounts(65, 16), base).find(g => g.name === 'over-claim')!.pass).toBe(true)
    expect(gates(mkCounts(65, 18), base).find(g => g.name === 'over-claim')!.pass).toBe(true)
    expect(gates(mkCounts(65, 19), base).find(g => g.name === 'over-claim')!.pass).toBe(false)
    // Falling is always fine.
    expect(gates(mkCounts(65, 10), base).find(g => g.name === 'over-claim')!.pass).toBe(true)
  })

  it('states the limit it can actually detect, rather than implying precision', () => {
    const g = gates(mkCounts(65, 17), mkCounts(65, 16)).find(x => x.name === 'over-claim')!
    expect(g.detail).toContain('±' + NOISE_FLOOR)
  })

  it('never lets over-claim block a build, however far it moves', () => {
    // It stays the leading indicator for wrongly-free and stays reported. It simply cannot
    // carry a build decision while its noise floor is 2.
    expect(gates(mkCounts(65, 99), mkCounts(65, 1)).find(g => g.name === 'over-claim')!.blocking).toBe(false)
  })

  it('marks the existence gates as blocking, because they are measured stable', () => {
    // Same four runs: wrongly-free 0,0,0,0 and leaked 0,0,0,0. That is why these two block
    // and the rate-like counts do not.
    const gs = gates(mkCounts(65, 0), null)
    expect(gs.find(g => g.name === 'wrongly-free')!.blocking).toBe(true)
    expect(gs.find(g => g.name === 'leaked non-kid events')!.blocking).toBe(true)
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

describe('gates — a count gate is only meaningful against the same population', () => {
  const mk = mkCounts

  it('reports NOT COMPARABLE when the scored set changed size', () => {
    // The real case: recovering 56 lost inputs took the set from 8 to 64, and over-claim from
    // 3 to 17. That is not a regression, it is arithmetic about two different sets. A gate
    // that cried "regression" there would teach people to re-accept the baseline unread.
    const g = gates(mk(64, 17), mk(8, 3)).find(x => x.name === 'over-claim')!
    expect(g.comparable).toBe(false)
    expect(g.detail).toContain('NOT COMPARABLE')
  })

  it('does not PASS an incomparable gate either', () => {
    // Passing would let a real regression hide inside a set change. A human re-accepts.
    expect(gates(mk(64, 17), mk(8, 3)).find(x => x.name === 'over-claim')!.pass).toBe(false)
  })

  it('compares normally when the set size is unchanged', () => {
    // A rise within the measured noise floor is reported, not flagged; above it, flagged. The
    // numbers here must step by more than NOISE_FLOOR to exercise the comparison at all.
    const g = (now: number, base: number) =>
      gates(mk(64, now), mk(64, base)).find(x => x.name === 'over-claim')!
    expect(g(17, 17).comparable).not.toBe(false)
    expect(g(17, 17).pass).toBe(true)
    expect(g(17 + NOISE_FLOOR, 17).pass).toBe(true)
    expect(g(17 + NOISE_FLOOR + 1, 17).pass).toBe(false)
    expect(g(16, 17).pass).toBe(true)
  })

  it('still gates wrongly-free and leaked regardless of set size', () => {
    // Existence gates do not depend on the population, which is exactly why they are the
    // blocking ones at this sample size.
    const now = { ...mk(64, 0), wronglyFree: 1, leaked: 1 }
    const gs = gates(now, mk(8, 0))
    expect(gs.find(g => g.name === 'wrongly-free')!.pass).toBe(false)
    expect(gs.find(g => g.name === 'leaked non-kid events')!.pass).toBe(false)
  })
})
