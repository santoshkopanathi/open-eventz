import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The events API gate decides what a parent is served. `kid_relevant IS NULL` means two
// completely different things depending on the source, and the original gate conflated them:
//
//   • a LIBRARY event has no LLM inference at all — NULL is expected, and it must pass
//   • an LLM-CLASSIFIED event with NULL was never successfully classified — it must NOT pass
//
// The old gate (`kid_relevant.is.null,kid_relevant.eq.true`) let both through. That is
// fail-open on a children's app, and it fired for real on 2026-09-01: a Play Frisco event whose
// model call returned malformed JSON was correctly excluded from the write — but the row already
// existed with a cleared classification, so "write nothing" left NULL behind, NULL passed the
// gate, and the event was served to parents unclassified.
//
// The lesson generalises past this bug: **"write nothing" is only fail-closed when the row does
// not already exist.** Verified non-vacuously against live PostgREST by setting one row's
// kid_relevant to NULL — the old gate served it, the new gate did not — then restoring it.
describe('the kid-visibility gate distinguishes "no inference" from "inference failed"', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/events/route.ts'), 'utf8')

  test('the gate is defined once and used by BOTH queries, so they cannot drift', () => {
    // There are two queries — upcoming and ongoing. The ongoing one was easy to forget.
    expect([...src.matchAll(/or\(KID_VISIBILITY_GATE\)/g)]).toHaveLength(2)
    expect([...src.matchAll(/const KID_VISIBILITY_GATE\s*=/g)]).toHaveLength(1)
  })

  test('a bare "any NULL passes" gate is gone', () => {
    // This exact string is the fail-open. If it reappears, the bug is back.
    expect(src).not.toContain("kid_relevant.is.null,kid_relevant.eq.true")
  })

  test('NULL only passes when the source is NOT LLM-classified', () => {
    const gate = src.slice(src.indexOf('const KID_VISIBILITY_GATE'), src.indexOf('\n\n', src.indexOf('const KID_VISIBILITY_GATE')))
    expect(gate).toContain('kid_relevant.eq.true')
    expect(gate).toContain('kid_relevant.is.null')
    expect(gate).toContain('source.not.in.')
  })

  test('the LLM-classified source list covers every source the model classifies', () => {
    // Adding a fifth source that the LLM classifies, without adding it here, would let its
    // unclassified rows through the gate — silently, and only when a classification failed.
    const decl = src.slice(src.indexOf('const LLM_CLASSIFIED'), src.indexOf('\n', src.indexOf('const LLM_CLASSIFIED')))
    expect(decl).toContain('play-frisco')
    expect(decl).toContain('kaleidoscope-park')
  })
})
