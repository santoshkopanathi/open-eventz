import { readFileSync } from 'fs'
import { join } from 'path'
import { createLlmBudget, resolveLlmCallCap, estimateCostUsd, DEFAULT_MAX_LLM_CALLS_PER_RUN } from './llm-budget'

// The cap is the last governance instrument — the only bound on paid LLM spend. Normal runs cost
// pennies because classification is batched and cached; the cap exists for the anomaly (a source
// that suddenly returns 10,000 events). These tests pin the two properties that matter: it stops
// spending, and a malformed configuration can never silently disable it.

describe('resolveLlmCallCap', () => {
  test('defaults when unset or blank', () => {
    expect(resolveLlmCallCap({})).toBe(DEFAULT_MAX_LLM_CALLS_PER_RUN)
    expect(resolveLlmCallCap({ MAX_LLM_CALLS_PER_RUN: '' })).toBe(DEFAULT_MAX_LLM_CALLS_PER_RUN)
    expect(resolveLlmCallCap({ MAX_LLM_CALLS_PER_RUN: '   ' })).toBe(DEFAULT_MAX_LLM_CALLS_PER_RUN)
  })

  test('honours an explicit raise — the deliberate act of accepting a new normal', () => {
    expect(resolveLlmCallCap({ MAX_LLM_CALLS_PER_RUN: '1000' })).toBe(1000)
  })

  test('a malformed value falls back to the default rather than disabling the cap', () => {
    // The dangerous failure would be `Number("abc") === NaN` silently becoming "no limit".
    for (const bad of ['abc', 'NaN', '-5', 'Infinity', '1e999']) {
      const cap = resolveLlmCallCap({ MAX_LLM_CALLS_PER_RUN: bad })
      expect(Number.isFinite(cap)).toBe(true)
      expect(cap).toBeGreaterThan(0)
    }
    expect(resolveLlmCallCap({ MAX_LLM_CALLS_PER_RUN: 'abc' })).toBe(DEFAULT_MAX_LLM_CALLS_PER_RUN)
    expect(resolveLlmCallCap({ MAX_LLM_CALLS_PER_RUN: '-5' })).toBe(DEFAULT_MAX_LLM_CALLS_PER_RUN)
  })

  test('zero is respected — an explicit "spend nothing" is a valid instruction', () => {
    expect(resolveLlmCallCap({ MAX_LLM_CALLS_PER_RUN: '0' })).toBe(0)
  })
})

describe('createLlmBudget', () => {
  test('allows calls up to the cap, then refuses', () => {
    const b = createLlmBudget(3)
    expect(b.spend()).toBe(true)
    expect(b.spend()).toBe(true)
    expect(b.spend()).toBe(true)
    expect(b.spend()).toBe(false)   // the refusal
    expect(b.used()).toBe(3)        // a refused call is NOT counted as spend
    expect(b.wasCapped()).toBe(true)
  })

  test('a healthy run never reports capped', () => {
    const b = createLlmBudget(300)
    for (let i = 0; i < 120; i++) b.spend()   // ~a first run of a new source
    expect(b.wasCapped()).toBe(false)
    expect(b.canSpend()).toBe(true)
  })

  test('a zero cap refuses immediately — nothing is spent by accident', () => {
    const b = createLlmBudget(0)
    expect(b.canSpend()).toBe(false)
    expect(b.spend()).toBe(false)
    expect(b.used()).toBe(0)
    expect(b.wasCapped()).toBe(true)
  })

  test('describe() names the ceiling and flags the cap for run records', () => {
    const b = createLlmBudget(2)
    b.spend(); b.spend()
    expect(b.describe()).toContain('2/2')
    expect(b.describe()).not.toContain('CAP REACHED')
    b.spend()
    expect(b.describe()).toContain('CAP REACHED')
    expect(b.describe()).toContain('fail-closed')
  })

  test('the default ceiling sits well above normal volume but bounds an anomaly', () => {
    // Normal: Play Frisco ~30, Kaleidoscope ~100, and ~0 on a cached re-run.
    expect(DEFAULT_MAX_LLM_CALLS_PER_RUN).toBeGreaterThan(150)
    // A runaway source (10k events) must be stopped far short of full classification.
    expect(DEFAULT_MAX_LLM_CALLS_PER_RUN).toBeLessThan(1000)
  })
})

describe('estimateCostUsd', () => {
  test('scales with call count', () => {
    expect(estimateCostUsd(0)).toBe(0)
    expect(estimateCostUsd(100)).toBeGreaterThan(0)
    expect(estimateCostUsd(200)).toBeCloseTo(estimateCostUsd(100) * 2, 4)
  })

  test('the worst case a capped run can cost stays small', () => {
    // The number that makes the cap meaningful: this is the most one run can spend.
    expect(estimateCostUsd(DEFAULT_MAX_LLM_CALLS_PER_RUN)).toBeLessThan(5)
  })
})

// Structural guard: the cap is only a control if every paid call goes through it, and if a
// skipped event is genuinely excluded from the write. Both are properties of ingest.ts that a
// future edit could quietly undo, so assert them against the source.
describe('the spend ceiling cannot be bypassed', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/ingest.ts'), 'utf8')

  test('the paid inference call is gated by budget.spend()', () => {
    const gateThenCall = /if \(!budget\.spend\(\)\)[\s\S]{0,900}?await inferPlayFriscoEvent\(/
    expect(gateThenCall.test(src)).toBe(true)
  })

  test('there is exactly one paid inference call site', () => {
    expect([...src.matchAll(/await inferPlayFriscoEvent\(/g)]).toHaveLength(1)
  })

  test('a budget-skipped event is excluded from the write, never assigned kid_relevant', () => {
    // Writing `false` poisons the cache (hidden forever); writing `null` fails OPEN, because
    // `kid_relevant IS NULL` passes the events API gate. Neither is acceptable.
    const block = src.slice(src.indexOf('if (!budget.spend())'), src.indexOf('llmCalls++'))
    expect(block).toContain('_budgetSkipped')
    expect(block).not.toMatch(/e\.kid_relevant\s*=/)
    expect(src).toContain('_budgetSkipped === true')
  })
})
