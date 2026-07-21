import { inferPlayFriscoEvent } from './age-inference'
import { resolvePriceClass } from './price'
import { PRICE_CALIBRATION } from './__fixtures__/price-calibration'
import type { PriceClass } from './types'

// LLM calibration — Tier 2 of Layer 6. Runs the REAL model against the ground-truth
// price set and prints a pass/fail table. Manual only (costs money, needs a key):
//   npm run calibrate:price
//
// This is NOT a normal unit test — the filename is *.llm.ts so the default jest config
// (which matches *.test.ts) never collects it. It runs only under jest.calibration.config.ts.

describe('LLM price calibration', () => {
  it('classifies the ground-truth set correctly', async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required to run the calibration. Set it and re-run `npm run calibrate:price`.')
    }

    const rows: { id: string; expected: PriceClass; got: PriceClass | 'ERROR'; pass: boolean; reasoning: string }[] = []

    for (const c of PRICE_CALIBRATION) {
      const result = await inferPlayFriscoEvent({ title: c.title, description: c.description })
      let got: PriceClass | 'ERROR'
      let reasoning = ''
      if (!result) {
        got = 'ERROR'
      } else {
        // Apply the same Layer 2/3 resolution the ingest pipeline uses.
        const resolved = resolvePriceClass({
          price: result.price,
          price_confidence: result.price_confidence,
          title: c.title,
          description: c.description,
          registration_required: c.registration_required,
        })
        got = resolved.price_class
        reasoning = result.price_reasoning
      }
      rows.push({ id: c.id, expected: c.expected, got, pass: got === c.expected, reasoning })
    }

    const passed = rows.filter(r => r.pass).length
    // eslint-disable-next-line no-console
    console.log('\n=== Price calibration (real LLM) ===')
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(26)} expected=${r.expected.padEnd(7)} got=${String(r.got).padEnd(7)}  ${r.reasoning}`)
    }
    // eslint-disable-next-line no-console
    console.log(`\n${passed}/${rows.length} passed\n`)

    const failures = rows.filter(r => !r.pass)
    expect(failures).toEqual([])
  })
})
