/*
 * FREEZE EVAL INPUTS — capture the text the classifier will be judged on, before it is gone.
 *
 *   npm run eval:snapshot
 *
 * Captures every event from the LLM-classified sources into eval/golden/events.json, which is
 * COMMITTED. Append-only: an id already frozen is never rewritten, because refreshing a frozen
 * input silently changes the question a human label was the answer to.
 *
 * Why this exists. The first golden set read its inputs live from the database at run time. On
 * 2026-11-11 we measured what remained of it: 8 of 64. Kaleidoscope's connector had been
 * rebuilt, its id scheme changed, and all 26 of its rows were purged as unmatched; 30 Play
 * Frisco rows had aged off the city feed. The descriptions had never been copied anywhere, so
 * 56 human judgments became unusable — not wrong, just answers to questions nobody has.
 *
 * The eval had been reporting a score the whole time. It simply skipped what it could not find.
 */
import { config } from 'dotenv'
config({ path: '.env.local' }) // no-op in CI

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { freeze, type FrozenEvent, type GoldenSet, type Label } from '../src/lib/eval-set'

const EVENTS_FILE = 'eval/golden/events.json'
const LABELS_FILE = 'eval/golden/labels.json'

// The sources whose events reach inferPlayFriscoEvent. Library feeds carry structured age and
// price, so they are not classified and have nothing for this eval to measure.
const CLASSIFIED_SOURCES = ['play-frisco', 'kaleidoscope-park']

function load(): FrozenEvent[] {
  if (!existsSync(EVENTS_FILE)) return []
  return (JSON.parse(readFileSync(EVENTS_FILE, 'utf8')) as GoldenSet['events']) ?? []
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required')
  const db = createClient(url, key)

  const captured_at = new Date().toISOString()
  const incoming: FrozenEvent[] = []

  for (const source of CLASSIFIED_SOURCES) {
    // Paged explicitly: PostgREST caps an unpaginated select at 1000 rows and says nothing
    // about it, and a snapshot that silently stopped at 1000 would be the same class of bug
    // this whole file is about.
    for (let from = 0; ; from += 500) {
      const { data, error } = await db
        .from('events')
        .select('id, source, title, description, start_datetime, registration_required')
        .eq('source', source)
        .order('id')
        .range(from, from + 499)
      if (error) throw new Error(`${source}: ${error.message}`)
      const rows = data ?? []
      for (const r of rows) {
        incoming.push({
          id: r.id,
          source: r.source,
          title: r.title ?? '',
          description: r.description ?? '',
          start_datetime: r.start_datetime ?? null,
          registration_required: r.registration_required === true,
          captured_at,
        })
      }
      if (rows.length < 500) break
    }
  }

  const existing = load()
  // A labelled id is immutable; an unlabelled one is refreshed when the source text has
  // moved. See freeze(): the freeze protects answered questions, not bytes. This is not a
  // loophole — the first snapshot captured 17 descriptions the source had truncated, and
  // the connector fix landed hours later. Holding those forever would mean labelling a
  // known-bad input on purpose.
  const labels: Label[] = existsSync(LABELS_FILE)
    ? JSON.parse(readFileSync(LABELS_FILE, 'utf8'))
    : []
  const labelledIds = new Set(labels.filter(l => l.kid || l.price).map(l => l.id))
  const { merged, added, refreshed, kept } = freeze(existing, incoming, labelledIds)
  writeFileSync(EVENTS_FILE, JSON.stringify(merged, null, 2) + '\n')

  const bySource: Record<string, number> = {}
  for (const e of merged) bySource[e.source] = (bySource[e.source] ?? 0) + 1

  console.log(`\nFROZEN EVAL INPUTS — ${EVENTS_FILE}\n`)
  console.log(`  already frozen (untouched) : ${kept}`)
  console.log(`  newly captured             : ${added.length}`)
  console.log(`  refreshed (unlabelled, text moved): ${refreshed.length}`)
  console.log(`  held immutable (labelled)  : ${labelledIds.size}`)
  console.log(`  total frozen               : ${merged.length}`)
  console.log(`  by source                  : ${JSON.stringify(bySource)}`)
  if (added.length) {
    console.log(`\n  new ids need labels before they can be scored. Run: npm run eval:worksheet`)
  }
  console.log('\n  Commit this file. An input that only exists in the database is not frozen.\n')
}

main().catch(e => { console.error(String(e?.message ?? e)); process.exitCode = 1 })
