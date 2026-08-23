/*
 * Post-ingest data-quality gate. Runs against the REAL Supabase data (not mocks) + canaries the
 * live sources, then writes a pass/fail summary and exits non-zero on any failure — so a silent
 * source change (like BiblioCommons going client-side-rendered) becomes a RED job, not a green
 * ingest over corrupt data. Runs as the `data-quality` job in .github/workflows/ingest.yml after
 * the source jobs, and locally via `npm run validate`. See INGEST-DESIGN.md §Data-quality gate.
 */
import { config } from 'dotenv'
config({ path: '.env.local' }) // no-op in CI (env comes from job secrets); loads .env.local locally

import { appendFileSync } from 'node:fs'
import type { EventSource } from '../src/lib/types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const HTML_H = { 'User-Agent': UA }
const JSON_H = { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }

interface Check { name: string; pass: boolean; detail: string }

// Every source the gate watches. Completeness-checked against `EventSource` (same pattern as the
// supervision policy map), so adding a fifth source without adding it here is a TYPE ERROR rather
// than a source that silently goes unwatched. `import type` is erased, so this does not pull
// src/lib in before dotenv runs.
const SOURCE_SET: Record<EventSource, true> = {
  'frisco-library': true,
  'plano-library': true,
  'play-frisco': true,
  'kaleidoscope-park': true,
}
const SOURCES = Object.keys(SOURCE_SET) as EventSource[]

// Layer 1 — live-source canary. Confirms BiblioCommons still exposes audience_ids we can resolve
// (the exact contract that broke). Independent of our DB, so it catches a source change directly.
async function friscoCanary(): Promise<Check> {
  const name = 'canary: frisco audience API'
  try {
    const tj: any = await (await fetch('https://friscolibrary.bibliocommons.com/events/event_audiences?client_scope=events&limit=0', { headers: JSON_H })).json()
    const arr: any[] = tj.audiences || tj.event_audiences || tj.data || (Array.isArray(tj) ? tj : Object.values(tj)[0]) || []
    const tax = new Set(arr.filter(a => a?.id).map(a => a.id))
    if (tax.size === 0) return { name, pass: false, detail: 'audience taxonomy empty' }
    const lst = await (await fetch('https://friscolibrary.bibliocommons.com/v2/events?page=1', { headers: HTML_H })).text()
    const ids = [...new Set([...lst.matchAll(/events\/([a-zA-Z0-9]+)"/g)].map(m => m[1]))].slice(0, 5)
    let resolved = 0
    for (const id of ids) {
      const def: any = (await (await fetch(`https://friscolibrary.bibliocommons.com/events/events/${id}?client_scope=events`, { headers: JSON_H })).json())?.event?.definition
      if ((Array.isArray(def?.audience_ids) ? def.audience_ids : []).some((x: string) => tax.has(x))) resolved++
    }
    return { name, pass: resolved > 0, detail: `${resolved}/${ids.length} sampled events had resolvable audience_ids` }
  } catch (e: any) {
    return { name, pass: false, detail: String(e?.message ?? e) }
  }
}

async function main() {
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const dq = await import('../src/lib/data-quality')
  const db = supabaseAdmin()
  const checks: Check[] = []
  const nowIso = new Date().toISOString()

  // Upcoming events per source — the population users actually see (mirrors /api/events).
  const upcoming = (src: string) => db.from('events').select('*').eq('source', src).gte('start_datetime', nowIso).limit(1000)
  // Rows (not just counts) for every source — the start-time check needs the actual timestamps.
  const [{ data: frisco }, { data: plano }, { data: play }, { data: kaleidoscope }] = await Promise.all([
    upcoming('frisco-library'),
    upcoming('plano-library'),
    upcoming('play-frisco'),
    upcoming('kaleidoscope-park'),
  ])
  const planoCount = plano?.length ?? 0
  const playCount = play?.length ?? 0
  const kaleidoscopeCount = kaleidoscope?.length ?? 0

  // Frisco age-health (the checks that would have caught this incident)
  checks.push(...dq.friscoAgeChecks(frisco ?? []))

  // Per-source non-empty (Plano should never be near-zero; Play Frisco can legitimately be low)
  checks.push({ name: 'plano: non-empty', pass: planoCount >= 30, detail: `${planoCount} upcoming (min 30)` })
  checks.push({ name: 'play-frisco: present', pass: playCount >= 0, detail: `${playCount} upcoming` })
  checks.push({ name: 'kaleidoscope-park: non-empty', pass: kaleidoscopeCount >= 5, detail: `${kaleidoscopeCount} upcoming (min 5)` })

  // Start-time sanity per source — catches a wall-clock time parsed in the wrong timezone, which
  // shifted every Frisco/Plano event 5–6h early when the nightly ingest moved to a UTC runner.
  // Per-source so a red line names the source whose timezone handling broke.
  checks.push(dq.startTimeChecks(frisco ?? [], 'frisco'))
  checks.push(dq.startTimeChecks(plano ?? [], 'plano'))
  checks.push(dq.startTimeChecks(play ?? [], 'play-frisco'))
  checks.push(dq.startTimeChecks(kaleidoscope ?? [], 'kaleidoscope-park'))

  // Freshness — PER SOURCE (2026-08-22). This was a single global "newest ingested_at ≤ 48h",
  // which could never fail: Plano writes ~700 rows a night, so one healthy source kept the check
  // green while Kaleidoscope Park's API 404'd for three consecutive nights. Now every source must
  // have written recently on its own name, so a red line says WHICH source stopped.
  const newestPerSource = await Promise.all(
    SOURCES.map(async source => {
      const { data } = await db.from('events').select('ingested_at').eq('source', source)
        .order('ingested_at', { ascending: false, nullsFirst: false }).limit(1)
      return { source, lastIngestedAt: data?.[0]?.ingested_at ?? null }
    })
  )
  checks.push(...dq.sourceFreshnessChecks(newestPerSource))

  // Live-source canary
  checks.push(await friscoCanary())

  // Report
  const failed = checks.filter(c => !c.pass)
  const rows = checks.map(c => `| ${c.pass ? '✅' : '❌'} | ${c.name} | ${c.detail} |`).join('\n')
  const summary = `### Data-quality gate — ${failed.length ? `❌ ${failed.length} FAILED` : '✅ all passed'}\n\n| | Check | Detail |\n|---|---|---|\n${rows}\n`
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n') } catch { /* ignore */ }
  }
  if (failed.length) {
    console.error(`[validate] ${failed.length} check(s) failed`)
    process.exit(1)
  }
  console.log('[validate] all checks passed')
}

main().catch(err => {
  console.error('[validate] fatal:', err)
  process.exit(1)
})
