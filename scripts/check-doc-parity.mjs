#!/usr/bin/env node
// doc↔test parity check (CI job `doc-parity`).
//
// Reads TEST-SCENARIOS.md and, for every table row tagged [A] (automated), verifies that the
// test file it names in the "covered by" cell still exists in the codebase. This keeps the PM
// test plan from silently drifting from the real suite: rename or delete a test without updating
// the doc and this fails CI. Node 20+, no dependencies.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = join(ROOT, 'TEST-SCENARIOS.md')

// A "covered by" reference: a Jest test or Playwright spec, optionally path-qualified.
const FILE_RE = /([\w./-]+\.(?:test|spec)\.ts)/g

// Collect every test/spec file that actually exists under src/ and e2e/.
function collectTestFiles() {
  const byPath = new Set()
  const byBase = new Set()
  for (const dir of ['src', 'e2e']) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const entry of readdirSync(abs, { recursive: true })) {
      const rel = String(entry).replace(/\\/g, '/')
      if (/\.(?:test|spec)\.ts$/.test(rel)) {
        byPath.add(`${dir}/${rel}`)
        byBase.add(basename(rel))
      }
    }
  }
  return { byPath, byBase }
}

function refExists(ref, files) {
  // Path-qualified (e.g. "e2e/smoke.spec.ts") → match by suffix; bare name → match by basename.
  if (ref.includes('/')) {
    for (const p of files.byPath) if (p === ref || p.endsWith(`/${ref}`)) return true
    return false
  }
  return files.byBase.has(ref)
}

function main() {
  if (!existsSync(DOC)) {
    console.error(`❌ doc↔test parity: ${DOC} not found`)
    process.exit(1)
  }
  const files = collectTestFiles()
  const lines = readFileSync(DOC, 'utf8').split(/\r?\n/)

  const missing = [] // { id, ref }
  const untied = [] // [A] rows that name no test file at all
  let checkedRefs = 0

  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('|')) continue // table rows only (skips the tag-key legend)
    if (!/\[A\]/.test(line)) continue

    const cells = line.split('|').map(c => c.trim())
    const id = cells[1] || '(unknown)'
    const refs = [...line.matchAll(FILE_RE)].map(m => m[1])

    if (refs.length === 0) {
      untied.push(id)
      continue
    }
    for (const ref of refs) {
      checkedRefs++
      if (!refExists(ref, files)) missing.push({ id, ref })
    }
  }

  if (missing.length === 0 && untied.length === 0) {
    console.log(`✅ doc↔test parity OK — ${checkedRefs} [A] test reference(s) all exist.`)
    return
  }

  console.error('❌ doc↔test parity check failed\n')
  if (missing.length) {
    console.error('These [A]-tagged scenarios name a test file that no longer exists:')
    for (const { id, ref } of missing) console.error(`  • Scenario ${id} → ${ref}  (NOT FOUND)`)
    console.error('')
  }
  if (untied.length) {
    console.error('These rows are tagged [A] but name no test file (add a "covered by" reference):')
    for (const id of untied) console.error(`  • Scenario ${id}`)
    console.error('')
  }
  console.error(
    `Fix: restore/rename the test, or update the "covered by" reference in TEST-SCENARIOS.md. ` +
      `(Checked ${checkedRefs} reference(s); ${missing.length} missing, ${untied.length} untied.)`
  )
  process.exit(1)
}

main()
