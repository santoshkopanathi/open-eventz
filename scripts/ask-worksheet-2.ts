/*
 * Builds eval/ask/LABELLING-2.md: the owner's BLIND worksheet for the held-out questions
 * (H01-H03 synonym, Y01-Y03 typo). For each question it lists every event the hard rules allow
 * (city, age, dates), one row per program, in date order — no ranking, no hint of Claude's view.
 *
 *   npx tsx scripts/ask-worksheet-2.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Event } from '../src/lib/types'
import { passesAgeFilter } from '../src/lib/age-filter'
import { cityOf, isCatalogVisible } from '../src/lib/catalog'
import { isNonEvent, centralDate, shortDay } from '../src/lib/ask/core'
import { cardAgeBadge } from '../src/lib/age-badge'
import { cardPriceBadge } from '../src/lib/price'

interface Spec { id: string; tab: 'frisco' | 'plano'; question: string; city: 'frisco' | 'plano'; age: [number, number] | null; from: string | null; to: string | null }
const SPECS: Spec[] = [
  { id: 'H01', tab: 'frisco', question: 'Something sporty for my 9-year-old', city: 'frisco', age: [9, 9], from: null, to: null },
  { id: 'H02', tab: 'plano', question: 'Anything about bugs for my 4-year-old?', city: 'plano', age: [4, 4], from: null, to: null },
  { id: 'H03', tab: 'plano', question: 'Where can my 15-year-old learn about money?', city: 'plano', age: [15, 15], from: null, to: null },
  { id: 'Y01', tab: 'plano', question: 'fun things in Friso this Saturday for my 7-year-old', city: 'frisco', age: [7, 7], from: '2026-11-21', to: '2026-11-21' },
  { id: 'Y02', tab: 'frisco', question: 'storytime in Plnao tomorrow', city: 'plano', age: null, from: '2026-11-19', to: '2026-11-19' },
  { id: 'Y03', tab: 'frisco', question: 'piano lessons for my 8-year-old', city: 'frisco', age: [8, 8], from: null, to: null },
]

const s = JSON.parse(readFileSync('eval/ask/catalog-snapshot.json', 'utf8')) as { as_of: string; events: Event[] }
const all = s.events.map((e, i) => ({ e, ref: 'E' + String(i + 1).padStart(3, '0') }))
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
const cell = (t: string) => t.replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
const desc = (e: Event) => cell((e.description ?? '').replace(/<[^>]+>/g, ' ')).slice(0, 160)

const out: string[] = [
  '# Ask eval — blind labelling, round 2 (held-out questions)',
  '',
  `**Today for every question is Wednesday, Nov 18, 2026** (the frozen catalog date).`,
  '',
  "These six questions are new. Claude has not written answers for them, and won't until yours are",
  'committed. They are **held out**: never used while building or tuning, only for checking.',
  '',
  '**For each question**, read the list under it. It holds every event the strict rules allow',
  '(right city, right age, right dates), one row per program, in date order. The list is not',
  'ranked and nothing is highlighted. Pick what a careful person would show.',
  '',
  '- **Show:** up to 5 Refs, best first. If a program repeats, one Ref is enough.',
  '- **Fine but not needed:** Refs that are OK to show but not required (optional).',
  '- **Never show:** Refs that would be wrong to show (optional).',
  '- **None** is a valid answer.',
  '- **Notes:** anything you weren\'t sure about.',
  '',
  'Same rules as last time: no city named → the tab you are on; a city named → that city.',
  '',
]

for (const q of SPECS) {
  const pool = all.filter(({ e }) => {
    if (!isCatalogVisible(e) || isNonEvent(e) || cityOf(e) !== q.city) return false
    if (q.age && !passesAgeFilter(e, [q.age])) return false
    const d = centralDate(e.start_datetime)
    if (q.from && (d < q.from || d > q.to!)) return false
    return true
  })
  const byTitle = new Map<string, typeof pool>()
  for (const x of pool) { const k = x.e.title.trim().toLowerCase(); byTitle.set(k, [...(byTitle.get(k) ?? []), x]) }
  out.push(`## ${q.id} · ${q.tab === 'plano' ? 'Plano' : 'Frisco'} tab`, '', `> ${q.question}`, '')
  out.push(`${pool.length} events, ${byTitle.size} programs.`, '')
  out.push('| Ref | First date | Also on | Title | Price | Age | What it says (start) |', '|---|---|---|---|---|---|---|')
  for (const xs of byTitle.values()) {
    const f = xs[0]
    const more = xs.length > 1 ? `${xs.length - 1} more` : ''
    out.push(`| ${f.ref} | ${shortDay(centralDate(f.e.start_datetime))} ${time(f.e.start_datetime)} | ${more} | ${cell(f.e.title)} | ${cardPriceBadge(f.e)?.content ?? ''} | ${cardAgeBadge(f.e)?.content ?? ''} | ${desc(f.e)} |`)
  }
  out.push('', '- Show: ', '- Fine but not needed: ', '- Never show: ', '- Notes: ', '')
}
writeFileSync('eval/ask/LABELLING-2.md', out.join('\n'))
console.log('wrote eval/ask/LABELLING-2.md')
