import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KID_VISIBILITY_GATE, isCatalogVisible } from './catalog'

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
// 2026-11-18: the gate moved from the events route into src/lib/catalog.ts so Ask shares it.
describe('the kid-visibility gate distinguishes "no inference" from "inference failed"', () => {
  const route = readFileSync(join(process.cwd(), 'src/app/api/events/route.ts'), 'utf8')
  const catalog = readFileSync(join(process.cwd(), 'src/lib/catalog.ts'), 'utf8')

  test('the gate is defined once (catalog.ts) and used by BOTH list queries, so they cannot drift', () => {
    // There are two queries — upcoming and ongoing. The ongoing one was easy to forget.
    expect([...route.matchAll(/or\(KID_VISIBILITY_GATE\)/g)]).toHaveLength(2)
    expect([...route.matchAll(/or\(NOT_ADULTS_ONLY\)/g)]).toHaveLength(2)
    expect([...route.matchAll(/const KID_VISIBILITY_GATE\s*=/g)]).toHaveLength(0)
    expect([...catalog.matchAll(/export const KID_VISIBILITY_GATE\s*=/g)]).toHaveLength(1)
  })

  test('a bare "any NULL passes" gate is gone', () => {
    // This exact string is the fail-open. If it reappears, the bug is back.
    expect(route).not.toContain("kid_relevant.is.null,kid_relevant.eq.true")
    expect(catalog).not.toContain("kid_relevant.is.null,kid_relevant.eq.true")
    expect(KID_VISIBILITY_GATE).not.toContain("kid_relevant.is.null,kid_relevant.eq.true")
  })

  test('NULL only passes when the source is NOT LLM-classified', () => {
    expect(KID_VISIBILITY_GATE).toContain('kid_relevant.eq.true')
    expect(KID_VISIBILITY_GATE).toContain('kid_relevant.is.null')
    expect(KID_VISIBILITY_GATE).toContain('source.not.in.(play-frisco,kaleidoscope-park)')
  })

  test('the pure form (used by Ask on frozen rows) agrees with the query form', () => {
    expect(isCatalogVisible({ source: 'play-frisco', kid_relevant: null, age_min: null })).toBe(false)
    expect(isCatalogVisible({ source: 'kaleidoscope-park', kid_relevant: false, age_min: null })).toBe(false)
    expect(isCatalogVisible({ source: 'play-frisco', kid_relevant: true, age_min: null })).toBe(true)
    expect(isCatalogVisible({ source: 'plano-library', kid_relevant: null, age_min: 5 })).toBe(true)
    expect(isCatalogVisible({ source: 'frisco-library', kid_relevant: null, age_min: 18 })).toBe(false)
  })
})
