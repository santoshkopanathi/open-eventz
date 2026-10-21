import { classifyLlmFailure, needsHuman, describeLlmFailure } from './llm-failure'

// The real thing, copied from the 2026-10-21 run that started this.
const REAL_BILLING_ERROR =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CgFvdU8y9qEZJrr5Gs7PW"}'

describe('classifyLlmFailure', () => {
  test('REGRESSION: the exhausted-balance error is billing, not a model failure', () => {
    expect(classifyLlmFailure(REAL_BILLING_ERROR)).toBe('billing')
  })

  test.each([
    ['401 {"type":"authentication_error","message":"invalid x-api-key"}', 'auth'],
    ['429 {"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}', 'rate-limit'],
    ['529 {"type":"overloaded_error","message":"Overloaded"}', 'overloaded'],
    ['Unexpected token < in JSON at position 0', 'other'],
    ['the model returned an invalid shape', 'other'],
  ])('classifies %s', (message, expected) => {
    expect(classifyLlmFailure(message)).toBe(expected)
  })

  // An unrecognised message must not be guessed at: claiming "billing" for a parsing bug
  // sends someone to a billing page while the real fault sits in the prompt.
  test('an unknown failure falls through to other rather than guessing', () => {
    expect(classifyLlmFailure('something nobody has seen before')).toBe('other')
    expect(classifyLlmFailure('')).toBe('other')
  })
})

describe('needsHuman — which failures make retrying pointless', () => {
  test('billing and auth need a person; the transient ones do not', () => {
    expect(needsHuman('billing')).toBe(true)
    expect(needsHuman('auth')).toBe(true)
    expect(needsHuman('rate-limit')).toBe(false)
    expect(needsHuman('overloaded')).toBe(false)
    expect(needsHuman('other')).toBe(false)
  })
})

describe('describeLlmFailure — the line an operator reads at 6am', () => {
  test('the billing message says where to go, and how many events are affected', () => {
    const msg = describeLlmFailure('billing', 'kaleidoscope-park', 12)
    expect(msg).toMatch(/credit balance is exhausted/)
    expect(msg).toMatch(/console\.anthropic\.com\/settings\/billing/)
    expect(msg).toMatch(/12 event\(s\) were held back/)
    expect(msg).toMatch(/billing fix, not a data problem/)
  })

  test('the auth message points at both places the key lives', () => {
    expect(describeLlmFailure('auth', 'play-frisco', 3)).toMatch(/ANTHROPIC_API_KEY.*GitHub Production/)
  })

  test('transient failures say so, so nobody goes looking for a fix', () => {
    expect(describeLlmFailure('rate-limit', 'play-frisco', 1)).toMatch(/Transient/)
    expect(describeLlmFailure('overloaded', 'play-frisco', 1)).toMatch(/Transient/)
  })

  test('every kind names its source and never claims events were published', () => {
    for (const kind of ['billing', 'auth', 'rate-limit', 'overloaded', 'other'] as const) {
      const msg = describeLlmFailure(kind, 'play-frisco', 2)
      expect(msg).toContain('play-frisco')
      expect(msg).toMatch(/held back rather than published unclassified/)
    }
  })
})
