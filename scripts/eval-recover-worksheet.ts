/*
 * RECOVER THE ORIGINAL INPUTS from the worksheet a human actually read.
 *
 *   npm run eval:recover            # report what it would do
 *   npm run eval:recover -- --write # write eval/golden/events.json
 *
 * WHY THIS EXISTS, and the mistake it corrects.
 *
 * On 2026-11-11 I measured that 56 of the 64 labelled events had been purged from the database
 * and concluded their description text "existed nowhere else" — I had checked the three JSON
 * artefacts (`run-v2-results.json`, `run-v3-results.json`, `baseline-system-answers.json`) and
 * all three stored the title without the body. I wrote "56 human judgments are permanently
 * unscorable" into five documents.
 *
 * It was wrong. `eval/price-golden-worksheet.md` — the document the labeller filled in, tracked
 * in git the whole time — carries the full source text of every event in a quoted block, because
 * its entire purpose was to show a human exactly what the model would see. **I searched the
 * machine-generated artefacts and not the human-facing one**, which is backwards: the
 * human-facing one is the only artefact guaranteed to contain the question, since a label is
 * meaningless without it.
 *
 * FIDELITY, checked before trusting it. Eight of the 68 events still exist in the database and
 * had been frozen from it. Seven match the worksheet text exactly. The eighth, play-frisco-7439,
 * differs because the city REWROTE the event between August and November — "Second Saturday at
 * Heritage" (347 chars) became "Second Saturday: Fall Fun at Heritage" (465 chars).
 *
 * That one divergence is the argument for this script rather than against it. The frozen copy
 * taken from November's database is a DIFFERENT EVENT from the one the human judged, so the
 * label and the input had already drifted apart inside the golden set — exactly the corruption
 * the append-only freeze exists to prevent, which happened because the first snapshot was taken
 * from the database months after the labelling.
 *
 * So for a labelled event, the worksheet text is MORE authoritative than the database:
 *
 *     the frozen input is whatever the human was looking at when they answered.
 *
 * This is why the script is allowed to overwrite a labelled id, which `freeze()` forbids. It is
 * not a refresh to newer text — it is a restoration of the original question. The distinction
 * is the whole point, so the script prints every overwrite it performs and never runs silently.
 *
 * `start_datetime` is left null: the worksheet does not record it, and nothing in the eval reads
 * it. Inventing one would be worse than admitting it is unknown.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { FrozenEvent, Label } from '../src/lib/eval-set'

const SHEET = 'eval/price-golden-worksheet.md'
const BASELINE = 'eval/baseline-system-answers.json'
const EVENTS_FILE = 'eval/golden/events.json'
const LABELS_FILE = 'eval/golden/labels.json'

/** When these judgments were made. The input entered the set then, not today. */
const CAPTURED_AT = '2026-08-01T00:00:00.000Z'

interface Recovered {
  n: number
  id: string
  source: string
  title: string
  description: string
  registration_required: boolean
}

export function parseWorksheet(sheet: string, idForN: (n: number) => { id: string; source: string } | undefined): Recovered[] {
  // Event blocks are "## <n>. <title>". The rules section uses ### so it cannot collide.
  const blocks = sheet.split(/^## (?=\d+\. )/m).slice(1)
  const out: Recovered[] = []
  for (const b of blocks) {
    const head = b.match(/^(\d+)\.\s*(.+)$/m)
    if (!head) continue
    const n = Number(head[1])
    const sys = idForN(n)
    if (!sys) continue
    const meta = b.match(/\*\*source:\*\*\s*([^|]+)\|\s*\*\*registration required:\*\*\s*(\w+)/)
    // The description is the quoted block — the lines that begin "> ".
    const quoted = [...b.matchAll(/^> (.*)$/gm)].map(m => m[1]).join('\n').trim()
    if (!quoted) continue
    out.push({
      n,
      id: sys.id,
      source: meta ? meta[1].trim() : sys.source,
      title: head[2].trim(),
      description: quoted,
      registration_required: meta ? meta[2].trim().toLowerCase() === 'yes' : false,
    })
  }
  return out
}

function main(): void {
  const write = process.argv.includes('--write')
  for (const f of [SHEET, BASELINE]) {
    if (!existsSync(f)) throw new Error(`${f} not found`)
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { n: number; id: string; source: string }[]
  const byN = new Map(baseline.map(r => [r.n, r]))
  const recovered = parseWorksheet(readFileSync(SHEET, 'utf8'), n => byN.get(n))

  const existing: FrozenEvent[] = existsSync(EVENTS_FILE) ? JSON.parse(readFileSync(EVENTS_FILE, 'utf8')) : []
  const labels: Label[] = existsSync(LABELS_FILE) ? JSON.parse(readFileSync(LABELS_FILE, 'utf8')) : []
  const labelled = new Set(labels.filter(l => l.kid || l.price).map(l => l.id))
  const byId = new Map(existing.map(e => [e.id, e]))

  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
  const added: string[] = []
  const restored: string[] = []
  const unchanged: string[] = []

  for (const r of recovered) {
    const frozenEvent: FrozenEvent = {
      id: r.id,
      source: r.source,
      title: r.title,
      description: r.description,
      start_datetime: null,
      registration_required: r.registration_required,
      captured_at: CAPTURED_AT,
    }
    const prior = byId.get(r.id)
    if (!prior) {
      byId.set(r.id, frozenEvent)
      added.push(r.id)
      continue
    }
    if (norm(prior.title) === norm(r.title) && norm(prior.description) === norm(r.description)) {
      unchanged.push(r.id)
      continue
    }
    // An overwrite. Only ever a restoration of the text the labeller read, and only announced,
    // never silent — see the header for why this is permitted where freeze() refuses.
    byId.set(r.id, { ...frozenEvent, start_datetime: prior.start_datetime })
    restored.push(r.id)
  }

  console.log(`\nRECOVERY FROM ${SHEET}\n`)
  console.log(`  events in the worksheet : ${recovered.length}`)
  console.log(`  newly frozen            : ${added.length}`)
  console.log(`  already identical       : ${unchanged.length}`)
  console.log(`  RESTORED (text differed): ${restored.length}`)
  for (const id of restored) {
    const prior = existing.find(e => e.id === id)!
    const r = recovered.find(x => x.id === id)!
    console.log(`    ${id}${labelled.has(id) ? '  [LABELLED]' : ''}`)
    console.log(`      db        : ${norm(prior.title).slice(0, 60)}  (${norm(prior.description).length} chars)`)
    console.log(`      worksheet : ${norm(r.title).slice(0, 60)}  (${norm(r.description).length} chars)`)
    console.log(`      -> the worksheet text is the question the label answered`)
  }

  const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  const scorable = merged.filter(e => labelled.has(e.id)).length
  console.log(`\n  frozen total  : ${existing.length} -> ${merged.length}`)
  console.log(`  SCORABLE      : ${existing.filter(e => labelled.has(e.id)).length} -> ${scorable}`)

  if (!write) {
    console.log(`\n  dry run. Re-run with --write to apply.\n`)
    return
  }
  writeFileSync(EVENTS_FILE, JSON.stringify(merged, null, 2) + '\n')
  console.log(`\n  wrote ${EVENTS_FILE}. Commit it, then: npm run eval:run\n`)
}

if (require.main === module) {
  try { main() } catch (e: any) { console.error(String(e?.message ?? e)); process.exitCode = 1 }
}
