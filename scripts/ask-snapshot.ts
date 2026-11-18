/*
 * FREEZE THE ASK EVAL CATALOG — the events the Ask eval questions are answered against.
 *
 *   npm run eval:ask:snapshot
 *
 * Writes eval/ask/catalog-snapshot.json (COMMITTED) and eval/ask/event-sheet.md (the owner's
 * labelling sheet). Captures what the list view would serve today: the same kid-visibility gate
 * and adults-only exclusion as /api/events, upcoming plus ongoing multi-day events.
 *
 * Refuses to overwrite an existing snapshot. The labels are answers to questions about THIS
 * catalog on THIS date ("this Saturday" means the Saturday after `as_of`); refreshing it would
 * silently change the questions under the labels. That is the lesson of the classifier golden
 * set (see scripts/eval-snapshot.ts). Pass --force only to start a new, unlabelled set.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Event } from '../src/lib/types'
import { cardAgeBadge } from '../src/lib/age-badge'
import { cardPriceBadge } from '../src/lib/price'

const DIR = 'eval/ask'
const SNAPSHOT = `${DIR}/catalog-snapshot.json`
const SHEET = `${DIR}/event-sheet.md`
const TZ = 'America/Chicago'

// Must match src/app/api/events/route.ts. Step 2 of the Ask backlog moves both into one shared
// loader; until then this copy is checked by eye against the route.
const LLM_CLASSIFIED = ['play-frisco', 'kaleidoscope-park']
const KID_VISIBILITY_GATE =
  `kid_relevant.eq.true,and(kid_relevant.is.null,source.not.in.(${LLM_CLASSIFIED.join(',')}))`

const cityOf = (e: Event) => (e.source === 'plano-library' ? 'Plano' : 'Frisco')

function todayCtMidnightUtc(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5))
  if (now.getUTCHours() < 5) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString()
}

async function main(): Promise<void> {
  if (existsSync(SNAPSHOT) && !process.argv.includes('--force')) {
    throw new Error(`${SNAPSHOT} exists. It is frozen: labels depend on it. Use --force only for a new set.`)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required')
  const db = createClient(url, key)

  const now = new Date()
  const iso = todayCtMidnightUtc(now)
  // Today's date in Chicago, read directly. Not derived from `iso`: that cutoff copies the
  // route's fixed UTC-5 offset, which in winter (UTC-6) is 11 pm the previous evening.
  const as_of = now.toLocaleDateString('en-CA', { timeZone: TZ }) // YYYY-MM-DD

  const rows: Event[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from('events').select('*')
      .or(KID_VISIBILITY_GATE).or('age_min.is.null,age_min.lt.18')
      .gte('start_datetime', iso).order('start_datetime').order('id').range(from, from + 499)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Event[]))
    if ((data ?? []).length < 500) break
  }
  const { data: ongoing, error: e2 } = await db.from('events').select('*')
    .or(KID_VISIBILITY_GATE).or('age_min.is.null,age_min.lt.18')
    .lt('start_datetime', iso).gte('end_datetime', iso).limit(500)
  if (e2) throw new Error(e2.message)

  const seen = new Set<string>()
  const events = [...((ongoing ?? []) as Event[]), ...rows]
    .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime) || a.id.localeCompare(b.id))

  mkdirSync(DIR, { recursive: true })

  // The sheet shows exactly what a card shows (same badge helpers), plus a short id to cite.
  const day = (s: string) => new Date(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })
  const time = (s: string) => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
  const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
  const lines = [
    `# Ask eval — event sheet`,
    ``,
    `Frozen catalog as of **${as_of}** (${events.length} events). "Today" for every question is ${as_of}.`,
    `Cite events by the **Ref** column. Price and Age are exactly what the list card shows`,
    `(blank Price = unknown; ✦ = estimated from the description).`,
    ``,
    `| Ref | Day | Time | City | Title | Venue | Price | Age | Reg. |`,
    `|---|---|---|---|---|---|---|---|---|`,
  ]
  events.forEach((e, i) => {
    const ref = `E${String(i + 1).padStart(3, '0')}`
    ;(e as Event & { ref?: string }).ref = ref
    lines.push(`| ${ref} | ${day(e.start_datetime)} | ${time(e.start_datetime)} | ${cityOf(e)} | ${cell(e.title)} | ${cell(e.location_name ?? '')} | ${cardPriceBadge(e)?.content ?? ''} | ${cardAgeBadge(e)?.content ?? ''} | ${e.registration_required ? 'yes' : ''} |`)
  })
  writeFileSync(SNAPSHOT, JSON.stringify({ as_of, captured_at: now.toISOString(), timezone: TZ, events }, null, 2) + '\n')
  writeFileSync(SHEET, lines.join('\n') + '\n')

  const by: Record<string, number> = {}
  for (const e of events) by[e.source] = (by[e.source] ?? 0) + 1
  console.log(`as_of ${as_of} · ${events.length} events · ${JSON.stringify(by)}`)
  console.log(`wrote ${SNAPSHOT} and ${SHEET}. Commit both.`)
}

main().catch(e => { console.error(String(e?.message ?? e)); process.exitCode = 1 })
