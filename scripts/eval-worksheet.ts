/*
 * LABELLING WORKSHEET — generate one, then read it back.
 *
 *   npm run eval:worksheet              # write eval/golden/worksheet.md for unlabelled events
 *   npm run eval:worksheet -- --all     # include already-labelled ones (to revise)
 *   npm run eval:worksheet -- --parse   # read the filled worksheet back into labels.json
 *
 * The worksheet shows ONLY the text the classifier sees. That is the point: a label made from
 * the event's web page instead of its stored description is a label for a different question,
 * and it will read as a model failure forever. If the stored text does not say the price, the
 * honest answer is `unknown` — which is a real label here, not a skipped one.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { FrozenEvent, Label, KidLabel, PriceLabel } from '../src/lib/eval-set'

const EVENTS_FILE = 'eval/golden/events.json'
const LABELS_FILE = 'eval/golden/labels.json'
const SHEET = 'eval/golden/worksheet.md'

const KID: KidLabel[] = ['yes', 'no', 'unknown']
const PRICE: PriceLabel[] = ['free', 'paid', 'unknown']

function read<T>(p: string, f: T): T { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : f }

function generate(all: boolean): void {
  const events = read<FrozenEvent[]>(EVENTS_FILE, [])
  const labels = read<Label[]>(LABELS_FILE, [])
  const labelled = new Set(labels.filter(l => l.kid || l.price).map(l => l.id))
  const todo = all ? events : events.filter(e => !labelled.has(e.id))

  const out: string[] = [
    '# Labelling worksheet',
    '',
    'Fill the `kid:` and `price:` values on each answer line, then run `npm run eval:worksheet -- --parse`.',
    '',
    '- **kid** — `yes` / `no` / `unknown`. Would a parent reasonably bring a child to this?',
    '- **price** — `free` / `paid` / `unknown`.',
    '',
    '> `unknown` for price is a REAL answer, and the most important one. It means: reading only the',
    '> text below, you cannot tell. Do not open the event page to find out — the classifier cannot',
    '> either, and a label it had no way to reach measures nothing.',
    '',
    `Generated ${new Date().toISOString()} — ${todo.length} events.`,
    '',
    '---',
    '',
  ]
  todo.forEach((e, i) => {
    const existing = labels.find(l => l.id === e.id)
    out.push(`### ${i + 1}. ${e.title || '(no title)'}`)
    out.push('')
    out.push(`\`${e.id}\` · ${e.source} · ${(e.start_datetime ?? 'no date').slice(0, 10)} · registration: ${e.registration_required ? 'YES' : 'no'}`)
    out.push('')
    const body = (e.description || '(no description stored)').trim()
    out.push(body.split('\n').map(l => `> ${l}`).join('\n'))
    out.push('')
    out.push(`ANSWER kid: ${existing?.kid ?? '?'} | price: ${existing?.price ?? '?'} | note: ${existing?.note ?? ''}`)
    out.push('')
  })
  writeFileSync(SHEET, out.join('\n'))
  console.log(`\nwrote ${SHEET} — ${todo.length} events to label`)
  console.log('fill the ANSWER lines, then: npm run eval:worksheet -- --parse\n')
}

function parse(): void {
  if (!existsSync(SHEET)) throw new Error(`${SHEET} not found — generate it first`)
  const text = readFileSync(SHEET, 'utf8')
  const labels = read<Label[]>(LABELS_FILE, [])
  const byId = new Map(labels.map(l => [l.id, l]))

  // Each block is an id line followed, eventually, by its ANSWER line.
  const blocks = text.split(/^### /m).slice(1)
  let updated = 0, skipped = 0
  const bad: string[] = []
  for (const b of blocks) {
    const idM = b.match(/^`([^`]+)`/m)
    const ansM = b.match(/^ANSWER kid:\s*([^|]*)\|\s*price:\s*([^|]*)\|\s*note:\s*(.*)$/m)
    if (!idM || !ansM) { skipped++; continue }
    const id = idM[1].trim()
    const kidRaw = ansM[1].trim().toLowerCase()
    const priceRaw = ansM[2].trim().toLowerCase()
    const note = ansM[3].trim()
    if (kidRaw === '?' && priceRaw === '?') { skipped++; continue }
    // A typo must not become a silent null. An unparseable answer is reported and the
    // existing label is left alone — losing a judgment to a spelling mistake is exactly the
    // kind of quiet decay this set exists to prevent.
    if (kidRaw !== '?' && !KID.includes(kidRaw as KidLabel)) { bad.push(`${id}: kid="${kidRaw}"`); continue }
    if (priceRaw !== '?' && !PRICE.includes(priceRaw as PriceLabel)) { bad.push(`${id}: price="${priceRaw}"`); continue }
    const prev = byId.get(id)
    const next: Label = {
      id,
      kid: kidRaw === '?' ? (prev?.kid ?? null) : (kidRaw as KidLabel),
      price: priceRaw === '?' ? (prev?.price ?? null) : (priceRaw as PriceLabel),
      note: note || prev?.note,
      labelled_at: new Date().toISOString().slice(0, 10),
    }
    byId.set(id, next)
    updated++
  }
  const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  writeFileSync(LABELS_FILE, JSON.stringify(merged, null, 2) + '\n')
  console.log(`\nlabels updated: ${updated}   left blank: ${skipped}   total labels: ${merged.length}`)
  if (bad.length) {
    console.log(`\n  UNRECOGNISED ANSWERS (left unchanged — fix and re-parse):`)
    bad.forEach(l => console.log(`    ${l}`))
    process.exitCode = 1
  }
  console.log(`\ncommit ${LABELS_FILE}\n`)
}

const argv = process.argv.slice(2)
try {
  if (argv.includes('--parse')) parse()
  else generate(argv.includes('--all'))
} catch (e: any) { console.error(String(e?.message ?? e)); process.exitCode = 1 }
