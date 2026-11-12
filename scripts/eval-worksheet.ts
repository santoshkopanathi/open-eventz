/*
 * LABELLING WORKSHEET — generate one, then read it back.
 *
 *   npm run eval:worksheet              # write eval/golden/worksheet.md for unlabelled events
 *   npm run eval:worksheet -- --all     # include already-labelled ones (to revise)
 *   npm run eval:worksheet -- --parse   # read the filled worksheet back into labels.json
 *   npm run eval:worksheet -- --source kaleidoscope-park   # one source at a time
 *
 * Labelling is human time and it is the scarce input here, so the sheet is scopeable. One
 * source in a sitting is a finishable unit of work; 54 judgments in one file is a chore
 * someone abandons halfway, and a half-filled sheet is worse than a scoped one because
 * nobody can tell which half was skipped on purpose.
 *
 * ONE BLOCK PER PROGRAM, NOT PER DATE. A recurring series occupies one row per occurrence, but
 * every occurrence carries the identical title and description — so it is ONE judgment, and a
 * human asked to make it 30 times is being asked to pad a number. 124 frozen events are 50
 * distinct programs: "Saturday Music Series at Frisco Fresh Market" alone is 30 of them.
 *
 * The answer is applied to every date in the group, and the group's ids are written into the
 * block so the parser needs no re-derivation.
 *
 * The worksheet shows ONLY the text the classifier sees. That is the point: a label made from
 * the event's web page instead of its stored description is a label for a different question,
 * and it will read as a model failure forever. If the stored text does not say the price, the
 * honest answer is `unknown` — a real label here, not a skipped one.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { FrozenEvent, Label, KidLabel, PriceLabel } from '../src/lib/eval-set'

const EVENTS_FILE = 'eval/golden/events.json'
const LABELS_FILE = 'eval/golden/labels.json'
const SHEET = 'eval/golden/worksheet.md'

const KID: KidLabel[] = ['yes', 'no', 'unknown']
const PRICE: PriceLabel[] = ['free', 'paid', 'unknown']

function read<T>(p: string, f: T): T { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : f }

/** Same title + same opening of the description = the same judgment. */
function programKey(e: FrozenEvent): string {
  return `${(e.title ?? '').trim().toLowerCase()}||${(e.description ?? '').trim().slice(0, 300).toLowerCase()}`
}

function group(events: FrozenEvent[]): FrozenEvent[][] {
  const m = new Map<string, FrozenEvent[]>()
  for (const e of events) {
    const k = programKey(e)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(e)
  }
  return [...m.values()].sort((a, b) => b.length - a.length)
}

function generate(all: boolean, source: string | null): void {
  const events = read<FrozenEvent[]>(EVENTS_FILE, [])
  const labels = read<Label[]>(LABELS_FILE, [])
  const labelled = new Set(labels.filter(l => l.kid || l.price).map(l => l.id))
  const unlabelled = all ? events : events.filter(e => !labelled.has(e.id))
  const todo = source ? unlabelled.filter(e => e.source === source) : unlabelled
  if (source && todo.length === 0) {
    const seen = [...new Set(events.map(e => e.source))].join(", ")
    throw new Error(`no unlabelled events for source "${source}". Sources in the set: ${seen}`)
  }
  const groups = group(todo)

  const out: string[] = [
    '# Labelling worksheet',
    '',
    `**${groups.length} judgments** covering ${todo.length} frozen events${source ? ` from \`${source}\`` : ''}.`,
    'A recurring series is one judgment applied to all its dates.',
    '',
    'Fill the `kid:` and `price:` values on each ANSWER line, then run',
    '`npm run eval:worksheet -- --parse`. Partial is fine: anything left as `?` is skipped and',
    'can be done later.',
    '',
    '- **kid** — `yes` / `no` / `unknown`. Would a parent reasonably bring a child to this?',
    '- **price** — `free` / `paid` / `unknown`.',
    '',
    '> `unknown` for price is a REAL answer, and the most important one. It means: reading only',
    '> the text below, you cannot tell. **Do not open the event page to find out** — the',
    '> classifier cannot either, and a label it had no way to reach measures nothing.',
    '',
    `Generated ${new Date().toISOString()}.`,
    '',
    '---',
    '',
  ]

  groups.forEach((g, i) => {
    // Show the fullest text in the group. A truncated copy is a past occurrence the nightly
    // fetch no longer reaches, and labelling the short version would hand the eval the very
    // input defect the connector fix removed.
    const rep = [...g].sort((a, b) => (b.description ?? '').length - (a.description ?? '').length)[0]
    const existing = labels.find(l => l.id === rep.id)
    const dates = g
      .map(e => (e.start_datetime ?? '').slice(0, 10))
      .filter(Boolean)
      .sort()

    out.push(`### ${i + 1}. ${rep.title || '(no title)'}`)
    out.push('')
    out.push(
      `${rep.source} · ${g.length === 1 ? (dates[0] ?? 'no date') : `${g.length} dates, ${dates[0]} → ${dates[dates.length - 1]}`}` +
      ` · registration: ${rep.registration_required ? '**YES**' : 'no'}`,
    )
    if (/[…]\s*$/.test(rep.description ?? '')) {
      out.push('')
      out.push('> ⚠ This text is still truncated by the source and cannot be refreshed (every')
      out.push('> occurrence is in the past, so the nightly fetch no longer retrieves it).')
      out.push('> Label what is here or leave it — it is not worth agonising over.')
    }
    out.push('')
    out.push(`<!-- ids: ${g.map(e => e.id).join(' ')} -->`)
    out.push('')
    out.push((rep.description || '(no description stored)').trim().split('\n').map(l => `> ${l}`).join('\n'))
    out.push('')
    out.push(`ANSWER kid: ${existing?.kid ?? '?'} | price: ${existing?.price ?? '?'} | note: ${existing?.note ?? ''}`)
    out.push('')
  })

  writeFileSync(SHEET, out.join('\n'))
  console.log(`\nwrote ${SHEET}`)
  console.log(`  ${groups.length} judgments covering ${todo.length} frozen events${source ? ` from ${source}` : ''}`)
  console.log(`  ~${Math.round(groups.length / 60 * 10) / 10} hours at a minute each`)
  console.log('\nfill the ANSWER lines, then: npm run eval:worksheet -- --parse\n')
}

function parse(): void {
  if (!existsSync(SHEET)) throw new Error(`${SHEET} not found — generate it first`)
  const text = readFileSync(SHEET, 'utf8')
  const labels = read<Label[]>(LABELS_FILE, [])
  const byId = new Map(labels.map(l => [l.id, l]))

  const blocks = text.split(/^### /m).slice(1)
  let answered = 0, rows = 0, skipped = 0
  const bad: string[] = []

  for (const b of blocks) {
    const idsM = b.match(/^<!-- ids:\s*([^>]+?)\s*-->$/m)
    const ansM = b.match(/^ANSWER kid:\s*([^|]*)\|\s*price:\s*([^|]*)\|\s*note:\s*(.*)$/m)
    if (!idsM || !ansM) { skipped++; continue }
    const ids = idsM[1].trim().split(/\s+/).filter(Boolean)
    const kidRaw = ansM[1].trim().toLowerCase()
    const priceRaw = ansM[2].trim().toLowerCase()
    const note = ansM[3].trim()
    if (kidRaw === '?' && priceRaw === '?') { skipped++; continue }
    // A typo must not become a silent null. An unparseable answer is reported and the existing
    // label left untouched — losing a judgment to a spelling mistake is the same quiet decay
    // this whole set exists to prevent.
    if (kidRaw !== '?' && !KID.includes(kidRaw as KidLabel)) { bad.push(`${ids[0]}: kid="${kidRaw}"`); continue }
    if (priceRaw !== '?' && !PRICE.includes(priceRaw as PriceLabel)) { bad.push(`${ids[0]}: price="${priceRaw}"`); continue }

    answered++
    // One judgment, applied to every date of the program.
    for (const id of ids) {
      const prev = byId.get(id)
      byId.set(id, {
        id,
        kid: kidRaw === '?' ? (prev?.kid ?? null) : (kidRaw as KidLabel),
        price: priceRaw === '?' ? (prev?.price ?? null) : (priceRaw as PriceLabel),
        note: note || prev?.note,
        labelled_at: new Date().toISOString().slice(0, 10),
      })
      rows++
    }
  }

  const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  writeFileSync(LABELS_FILE, JSON.stringify(merged, null, 2) + '\n')
  console.log(`\njudgments read: ${answered}   events labelled: ${rows}   left blank: ${skipped}`)
  console.log(`total labels: ${merged.length}`)
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
  else {
    const i = argv.indexOf('--source')
    const source = i !== -1 ? argv[i + 1] ?? null : null
    generate(argv.includes('--all'), source)
  }
} catch (e: any) { console.error(String(e?.message ?? e)); process.exitCode = 1 }
