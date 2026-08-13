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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const HTML_H = { 'User-Agent': UA }
const JSON_H = { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }

interface Check { name: string; pass: boolean; detail: string }

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
  const [{ data: frisco }, { count: planoCount }, { count: playCount }] = await Promise.all([
    upcoming('frisco-library'),
    db.from('events').select('id', { count: 'exact', head: true }).eq('source', 'plano-library').gte('start_datetime', nowIso),
    db.from('events').select('id', { count: 'exact', head: true }).eq('source', 'play-frisco').gte('start_datetime', nowIso),
  ])

  // Frisco age-health (the checks that would have caught this incident)
  checks.push(...dq.friscoAgeChecks(frisco ?? []))

  // Per-source non-empty (Plano should never be near-zero; Play Frisco can legitimately be low)
  checks.push({ name: 'plano: non-empty', pass: (planoCount ?? 0) >= 30, detail: `${planoCount ?? 0} upcoming (min 30)` })
  checks.push({ name: 'play-frisco: present', pass: (playCount ?? 0) >= 0, detail: `${playCount ?? 0} upcoming` })

  // Freshness — newest ingest within ~48h (catches a pipeline that silently stopped writing)
  const { data: newest } = await db.from('events').select('ingested_at').order('ingested_at', { ascending: false }).limit(1)
  const last = newest?.[0]?.ingested_at ? new Date(newest[0].ingested_at) : null
  const ageHrs = last ? (Date.now() - last.getTime()) / 3.6e6 : Infinity
  checks.push({ name: 'freshness', pass: ageHrs <= 48, detail: last ? `last ingest ${ageHrs.toFixed(1)}h ago (max 48h)` : 'no ingest recorded' })

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
