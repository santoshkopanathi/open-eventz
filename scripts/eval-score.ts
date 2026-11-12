/*
 * SCORE THE RUN — by direction, against a committed baseline.
 *
 *   npm run eval:score             # exit 1 on a gate failure
 *   npm run eval:score -- --accept # adopt this run's counts as the new baseline
 *
 * The counting and the gate rules live in src/lib/eval-score.ts so they are unit-tested; this
 * file is the I/O around them. See that module for why there is no accuracy number.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tally, gates, type Counts, type ScorableRow } from '../src/lib/eval-score'

const RUN_FILE = 'eval/golden/run-latest.json'
const BASELINE_FILE = 'eval/golden/baseline.json'

function main(): void {
  if (!existsSync(RUN_FILE)) throw new Error(`${RUN_FILE} not found — run npm run eval:run first`)
  const run = JSON.parse(readFileSync(RUN_FILE, 'utf8')) as { ran_at: string; rows: ScorableRow[] }
  const now = tally(run.rows)
  const base: Counts | null = existsSync(BASELINE_FILE)
    ? (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).counts as Counts)
    : null

  const vs = (k: keyof Counts) => (base ? ` (baseline ${base[k]})` : '')
  console.log(`\n=== EVAL SCORE — ran ${run.ran_at} ===\n`)
  console.log(`  scored             ${now.scored}`)
  console.log(`  errors / no call   ${now.errors}`)
  console.log(`  price badges shown ${now.badged}${vs('badged')}`)
  console.log(`  agree              ${now.agree}${vs('agree')}`)
  console.log(`  under-claim        ${now.underClaim}${vs('underClaim')}   (informational)`)
  console.log(`  wrongly hidden     ${now.wronglyHidden}${vs('wronglyHidden')}   (informational)`)

  const results = gates(now, base)
  console.log('')
  for (const g of results) {
    const tag = g.comparable === false ? 'N/A ' : g.pass ? 'PASS' : 'FAIL'
    console.log(`  ${tag}  ${g.name.padEnd(24)} ${g.detail}`)
  }
  if (!base) console.log(`  ----  over-claim               ${now.overClaim}  NO BASELINE — run with --accept`)

  // Name the offending events. A gate that says only "1" sends someone back to the raw JSON.
  run.rows.filter(r => r.label_price === 'paid' && r.shipped?.price_class === 'free')
    .forEach(r => console.log(`        ! wrongly-free: ${r.id}  ${r.title.slice(0, 48)}`))
  run.rows.filter(r => r.label_kid === 'no' && r.shipped?.shown)
    .forEach(r => console.log(`        ! leaked:       ${r.id}  ${r.title.slice(0, 48)}`))

  if (process.argv.includes('--accept')) {
    writeFileSync(BASELINE_FILE, JSON.stringify({
      accepted_at: new Date().toISOString(),
      from_run: run.ran_at,
      counts: now,
      note: 'Counts a human accepted as the state to regress against. Commit this file.',
    }, null, 2) + '\n')
    console.log(`\n  baseline updated -> ${BASELINE_FILE} (commit it)\n`)
    return
  }

  const failed = results.filter(g => !g.pass)
  console.log(failed.length === 0 ? '\nALL GATES PASS\n' : `\nFAILED: ${failed.map(f => f.name).join(', ')}\n`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

try { main() } catch (e: any) { console.error(String(e?.message ?? e)); process.exitCode = 1 }
