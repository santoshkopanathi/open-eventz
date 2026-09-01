import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Structural guards on the two paths where the classifier produces NO decision — the spend cap
// and a failed model call. Both must exclude the event from the write rather than store a value.
//
// The failure branch used to write `kid_relevant = false`. That poisons the cache: the cache-hit
// check is `prior.kid_relevant !== null`, so `false` reads as a real stored answer and the event
// is never re-classified. One transient network blip hid an event permanently and silently, long
// after the model recovered. Found 2026-08-23 while tracing the classification pipeline; the
// identical defect had already been reasoned through and avoided for the spend cap next door.
//
// classifyEvents is module-private, so these assert against the source — the same approach
// llm-budget.test.ts uses for the spend ceiling.
describe('a classifier that produced no decision must write nothing', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/ingest.ts'), 'utf8')

  // The `else` branch of `if (result)` — i.e. inferPlayFriscoEvent returned null.
  const failureBranch = (() => {
    const call = src.indexOf('const result = await inferPlayFriscoEvent(')
    const elseAt = src.indexOf('} else {', call)
    const end = src.indexOf('\n  }', elseAt)
    return src.slice(elseAt, end)
  })()

  test('a failed model call marks the event for exclusion', () => {
    expect(failureBranch).toContain('_skipWrite = true')
  })

  test('a failed model call assigns kid_relevant NEITHER way', () => {
    // `false` poisons the cache (hidden forever, never retried).
    // `null` fails OPEN — `kid_relevant IS NULL` is how library events pass the API gate,
    // so an unclassified event would be SHOWN.
    expect(failureBranch).not.toMatch(/kid_relevant\s*=/)
  })

  test('a failed model call does not write a reasoning string either', () => {
    // Writing age_reasoning implied a stored decision and was never read back by anything.
    expect(failureBranch).not.toMatch(/age_reasoning\s*=/)
  })

  test('both no-decision paths use the same flag, so neither can drift from the other', () => {
    expect([...src.matchAll(/_skipWrite = true/g)]).toHaveLength(2)
  })

  test('every runner filters the flag out before the write', () => {
    // One filter per LLM-classified source (Play Frisco, Kaleidoscope). A new source that
    // classifies but forgets this filter would write undecided events straight to the site.
    expect([...src.matchAll(/_skipWrite === true/g)]).toHaveLength(2)
  })
})
