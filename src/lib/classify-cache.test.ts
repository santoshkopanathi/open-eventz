import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCacheHit, applyCachedClassification, type CachedClassification } from './classify-cache'

// A known event classified earlier as inferred-free, with a stored age judgment.
const stored = (): CachedClassification => ({
  kid_relevant: true,
  kid_confidence: 'high',
  age_buckets: ['kids'],
  age_basis: 'assumed',
  age_confidence: 'medium',
  age_reasoning: 'stored reasoning',
  price_class: 'free',
  price_confidence: 'inferred',
  price_decided_by: 'model',
  price_reasoning: 'no price mentioned',
  is_free: true,
  price_text: 'Free',
})

// Tonight's copy of that event after the scrape, before classification.
const tonight = (price: Partial<Record<string, unknown>> = {}) => ({
  id: 'play-frisco-1',
  title: 'Learn to Fish',
  kid_relevant: null,
  price_class: 'unknown',
  price_confidence: 'inferred',
  price_decided_by: 'rule-keyword',
  price_reasoning: null,
  is_free: null,
  price_text: null,
  ...price,
})

describe('isCacheHit', () => {
  test('a stored decision is a hit', () => {
    expect(isCacheHit({ kid_relevant: true })).toBe(true)
    expect(isCacheHit({ kid_relevant: false })).toBe(true)
  })
  test('no row, or a row never classified, is a miss', () => {
    expect(isCacheHit(undefined)).toBe(false)
    expect(isCacheHit(null)).toBe(false)
    expect(isCacheHit({ kid_relevant: null })).toBe(false)
  })
})

describe('applyCachedClassification', () => {
  test('an unlocked price is carried forward from the cache, with the judgment', () => {
    const e: Record<string, unknown> = tonight()
    applyCachedClassification(e, stored(), false)
    expect(e).toMatchObject({
      kid_relevant: true, age_buckets: ['kids'], age_confidence: 'medium',
      price_class: 'free', price_confidence: 'inferred', price_decided_by: 'model', is_free: true,
    })
  })

  test('REGRESSION: a Cost field that appeared tonight beats the stored price', () => {
    // The bug: a known event that gained "Cost: $35" kept its stored inferred "Free ✦".
    const e: Record<string, unknown> = tonight({
      price_class: 'paid', price_confidence: 'confirmed', price_decided_by: 'source-cost-field',
      price_reasoning: 'Cost field: "$35"', is_free: false, price_text: 'Paid',
    })
    applyCachedClassification(e, stored(), true)
    expect(e).toMatchObject({
      price_class: 'paid', price_confidence: 'confirmed', price_decided_by: 'source-cost-field',
      price_reasoning: 'Cost field: "$35"', is_free: false, price_text: 'Paid',
    })
  })

  test('a locked price still takes the judgment fields from the cache', () => {
    // Locking the price must not cost the cache its purpose: no re-classification of age.
    const e: Record<string, unknown> = tonight({ price_class: 'paid', price_decided_by: 'source-cost-field' })
    applyCachedClassification(e, stored(), true)
    expect(e).toMatchObject({ kid_relevant: true, kid_confidence: 'high', age_buckets: ['kids'], age_reasoning: 'stored reasoning' })
  })

  test('a source-declared free (Kaleidoscope) beats a stored model answer', () => {
    const prior = { ...stored(), price_class: 'unknown', price_decided_by: 'model', is_free: null, price_text: null }
    const e: Record<string, unknown> = tonight({
      price_class: 'free', price_confidence: 'confirmed', price_decided_by: 'source-declared', is_free: true, price_text: 'Free',
    })
    applyCachedClassification(e, prior, true)
    expect(e).toMatchObject({ price_class: 'free', price_decided_by: 'source-declared', is_free: true })
  })
})

describe('ingest wires the cache hit through the helper', () => {
  // classifyEvents is module-private, so assert against the source (same approach as
  // classify-skip.test.ts): the inline copy that caused the bug must not come back.
  const src = readFileSync(join(process.cwd(), 'src/lib/ingest.ts'), 'utf8')

  test('the cache-hit branch calls applyCachedClassification with priceLocked', () => {
    expect(src).toContain('applyCachedClassification(e, prior, priceLocked)')
  })

  test('no unconditional copy of the stored price remains in ingest.ts', () => {
    expect(src).not.toMatch(/e\.price_class\s*=\s*prior\.price_class/)
  })
})
