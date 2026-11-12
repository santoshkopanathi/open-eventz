/*
 * RUN THE EVAL — against the production classifier, not a copy of it.
 *
 *   npm run eval:run              # labelled events only (what can be scored)
 *   npm run eval:run -- --all     # every frozen event (use when labelling new ones)
 *   npm run eval:run -- --limit 10
 *   npm run eval:run -- --retry-failures   # re-call ONLY the rows that failed a blocking gate
 *
 * The previous harness held its own pasted SYSTEM_PROMPT. By 2026-11-11 that copy had drifted
 * to 5681 characters against production's 5340 — so every run was measuring a prompt the site
 * does not use, and reporting it as if it did. A copy of the thing under test is not the thing
 * under test, and nothing warns you when it stops matching.
 *
 * This file therefore imports inferPlayFriscoEvent and resolvePriceClass directly. It also
 * reproduces the two steps ingest.ts performs around them — visibleText() on the inputs, and
 * the price resolution afterwards — because what we are judging is THE ANSWER A PARENT SEES,
 * not the model's raw opinion. The red-team run that found a deterministic rule overriding a
 * correct model refusal is the standing proof that those two differ.
 */
import { config } from 'dotenv'
config({ path: '.env.local' }) // no-op in CI

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { inferPlayFriscoEvent } from '../src/lib/age-inference'
import { resolvePriceClass } from '../src/lib/price'
import { visibleText } from '../src/lib/source-text'
import { coverage, scorable, type FrozenEvent, type GoldenSet, type Label } from '../src/lib/eval-set'
import { rowsWorthRetrying } from '../src/lib/eval-score'

const EVENTS_FILE = 'eval/golden/events.json'
const LABELS_FILE = 'eval/golden/labels.json'
const OUT_FILE = 'eval/golden/run-latest.json'

export interface RunRow {
  id: string
  source: string
  title: string
  label_kid: string | null
  label_price: string | null
  /** The model's unmodified opinion. */
  model: {
    kid_relevant: boolean
    kid_confidence: string
    age_buckets: string[]
    price: string
    price_confidence: string
  } | null
  /** What the pipeline concluded after the deterministic rules — what a parent would see. */
  shipped: { price_class: string; price_confidence: string; shown: boolean } | null
  error: string | null
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required')
  const argv = process.argv.slice(2)
  const all = argv.includes('--all')
  const retry = argv.includes('--retry-failures')
  const limitArg = argv.indexOf('--limit')
  const limit = limitArg !== -1 ? Number(argv[limitArg + 1]) : Infinity

  const set: GoldenSet = {
    events: readJson<FrozenEvent[]>(EVENTS_FILE, []),
    labels: readJson<Label[]>(LABELS_FILE, []),
  }
  const cov = coverage(set)
  console.log('\nGOLDEN SET COVERAGE')
  console.log(`  frozen inputs        : ${cov.frozen}`)
  console.log(`  labelled             : ${cov.labelled}`)
  console.log(`  scorable (both)      : ${cov.scorable}`)
  console.log(`  frozen, not labelled : ${cov.unlabelled}`)
  // Labels whose input text we no longer hold. They can never be scored again. Printed every
  // run so the set's decay is visible next to the score rather than hidden behind it.
  console.log(`  labels with no input : ${cov.orphanLabels}  (unscorable — input text lost)`)

  // RETRY MODE. The model is non-deterministic, so one bad roll must not be
  // indistinguishable from a regression. This re-calls only the rows that failed a blocking
  // gate (and any that errored), then merges them back over the previous run — so the
  // question becomes "does this failure reproduce?", which is the one worth failing a build
  // over. Over-claim rows are deliberately NOT retried; see rowsWorthRetrying().
  let retryIds: Set<string> | null = null
  let priorRows: RunRow[] = []
  if (retry) {
    if (!existsSync(OUT_FILE)) throw new Error(`--retry-failures needs a previous ${OUT_FILE}`)
    const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as { rows: RunRow[] }
    priorRows = prev.rows
    retryIds = new Set(rowsWorthRetrying(prev.rows))
    if (retryIds.size === 0) {
      console.log('\nNothing failed a blocking gate in the previous run — nothing to retry.\n')
      return
    }
    console.log(`\nRETRY: ${retryIds.size} row(s) that failed a blocking gate`)
    retryIds.forEach(id => console.log(`  ${id}`))
  }

  const pairs = scorable(set)
  const targets: { event: FrozenEvent; label: Label | null }[] = all
    ? set.events.map(event => ({ event, label: set.labels.find(l => l.id === event.id) ?? null }))
    : pairs.map(p => ({ event: p.event, label: p.label }))

  const run = (retryIds ? targets.filter(t => retryIds!.has(t.event.id)) : targets).slice(0, limit)
  if (run.length === 0) {
    console.log('\nNothing to run. Label some frozen events first (npm run eval:worksheet).\n')
    return
  }
  console.log(`\nrunning the PRODUCTION classifier over ${run.length} frozen events\n`)

  const out: RunRow[] = []
  for (const { event, label } of run) {
    // Exactly the transformation ingest.ts applies before the call.
    const title = visibleText(event.title)
    const description = visibleText(event.description)
    let row: RunRow = {
      id: event.id, source: event.source, title: event.title,
      label_kid: label?.kid ?? null, label_price: label?.price ?? null,
      model: null, shipped: null, error: null,
    }
    try {
      const result = await inferPlayFriscoEvent({ title, description })
      if (!result) {
        // null is "no decision was made" — never a decision. Recorded as an error so it can
        // never be silently counted as agreement.
        row.error = 'classifier returned null (no decision)'
      } else {
        const resolved = resolvePriceClass({
          price: result.price,
          price_confidence: result.price_confidence,
          title, description,
          registration_required: event.registration_required,
        })
        row.model = {
          kid_relevant: result.kid_relevant,
          kid_confidence: result.kid_confidence,
          age_buckets: result.age_buckets,
          price: result.price,
          price_confidence: result.price_confidence,
        }
        row.shipped = {
          price_class: resolved.price_class,
          price_confidence: resolved.price_confidence,
          // The visibility rule: a low-confidence kid judgment is hidden.
          shown: result.kid_relevant === true && result.kid_confidence !== 'low',
        }
      }
    } catch (e: any) {
      row.error = String(e?.message ?? e)
    }
    out.push(row)
    process.stdout.write(row.error ? '!' : '.')
  }

  // In retry mode the new results REPLACE their old rows and everything else is carried
  // forward untouched, so the scorer still sees the whole set.
  const merged = retryIds
    ? priorRows.map(old => out.find(r => r.id === old.id) ?? old)
    : out

  writeFileSync(OUT_FILE, JSON.stringify({
    ran_at: new Date().toISOString(),
    scored_against: LABELS_FILE,
    rows: merged,
  }, null, 2) + '\n')
  const errs = merged.filter(r => r.error).length
  console.log(`\n\nwrote ${OUT_FILE} — ${merged.length} rows (${out.length} called this pass), ${errs} errors`)
  console.log('next: npm run eval:score\n')
}

main().catch(e => { console.error(String(e?.message ?? e)); process.exitCode = 1 })
