/*
 * HEARTBEAT — did the pipeline run at all?
 *
 * Every other alert we have fires when a run FAILS. A run that never STARTS produces silence,
 * and silence is indistinguishable from success. That is not hypothetical: on 2026-10-22 the
 * nightly schedule did not fire at all — no success, no failure, no run record — and nothing
 * would have said so. The per-source freshness check would have caught the stale data, but it
 * runs INSIDE the workflow that did not run.
 *
 * So this lives in its own workflow, on its own schedule, and asks one question of the database:
 * has every source written something recently? It does not care why not — a dropped schedule, a
 * failed job, a silent zero and a broken source all produce the same answer, and all of them
 * need the same first response from a human.
 *
 * It alerts by FAILING. A red job triggers GitHub's own workflow-failure email, which is the
 * primary alert channel precisely because it needs no code of ours and cannot be broken by our
 * own logic (see GUARDRAILS.md Layer 6).
 *
 * Window: 30h, not 48h. The data-quality gate tolerates one missed night because it runs right
 * after an ingest; this runs independently and should notice a single missed day. Observed
 * scheduling delay on this repo is 3–9h, so 30h survives a late run without crying wolf.
 */
import { config } from 'dotenv'
config({ path: '.env.local' }) // no-op in CI (env comes from job secrets)

import { appendFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { sourceFreshnessChecks } from '../src/lib/data-quality'
import type { EventSource } from '../src/lib/types'

// Same completeness pattern as the data-quality gate: adding a fifth source without adding it
// here is a type error, not a source that quietly goes unwatched.
const SOURCE_SET: Record<EventSource, true> = {
  'frisco-library': true,
  'plano-library': true,
  'play-frisco': true,
  'kaleidoscope-park': true,
}
const SOURCES = Object.keys(SOURCE_SET) as EventSource[]

const MAX_AGE_HOURS = Number(process.env.HEARTBEAT_MAX_AGE_HOURS ?? 30)

function summary(lines: string[]): void {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (path) appendFileSync(path, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    // Cannot check → fail. A heartbeat that cannot read the database must not report health.
    summary(['### ❌ Heartbeat could not run', '', 'Supabase credentials are missing from the environment.'])
    process.exitCode = 1
    return
  }

  const db = createClient(url, key)
  const freshness = await Promise.all(
    SOURCES.map(async source => {
      const { data, error } = await db
        .from('events')
        .select('ingested_at')
        .eq('source', source)
        .order('ingested_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(`reading ${source}: ${error.message}`)
      return { source, lastIngestedAt: data?.[0]?.ingested_at ?? null }
    }),
  )

  const checks = sourceFreshnessChecks(freshness, new Date(), MAX_AGE_HOURS)
  const failed = checks.filter(c => !c.pass)

  const lines = [
    `### Heartbeat — ${failed.length === 0 ? '✅ the pipeline is running' : '❌ the pipeline has stopped writing'}`,
    '',
    `Window: ${MAX_AGE_HOURS}h. This check runs OUTSIDE the ingest workflow, so a schedule that never fired looks the same as a job that failed — which is the point.`,
    '',
    '| Source | Status | Detail |',
    '|---|---|---|',
    ...checks.map(c => `| ${c.name.replace(': freshness', '')} | ${c.pass ? '✅' : '❌'} | ${c.detail} |`),
  ]

  if (failed.length > 0) {
    lines.push(
      '',
      '**What to check, in order:**',
      '1. Actions → *Ingest events* — did a run start at all? A missing run is a dropped schedule, not a failure.',
      '2. If a run exists and is red, open the failing source job.',
      '3. If a run exists and is green, the source returned nothing we could parse — look for a `parsed 0 events` error.',
    )
  }

  summary(lines)
  // exitCode rather than exit(): let the Supabase client tear down its handles cleanly, which
  // on Windows otherwise trips a libuv assertion that can mask the code CI reads.
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch(err => {
  summary(['### ❌ Heartbeat errored', '', '```', String(err?.message ?? err), '```'])
  process.exitCode = 1
})
