/*
 * PUBLISHED-SURFACE CHECK — is what Google can see what we would publish right now?
 *
 * Runs against PRODUCTION over HTTP, from outside the app, because the thing it is checking is
 * the gap between our intent and what the platform actually serves. A test that imported the
 * page component would have passed throughout the month the sitemap was frozen.
 *
 *   npm run seo:check                       # against SITE_URL
 *   SEO_CHECK_BASE=http://localhost:3000 npm run seo:check
 *
 * Alerts by failing, like the heartbeat: a red job triggers GitHub's own workflow-failure mail.
 * See src/lib/seo-check.ts for the race argument behind "missing fails, extra does not".
 */
import { config } from 'dotenv'
config({ path: '.env.local' }) // no-op in CI

import { appendFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Event } from '../src/lib/types'
import { cityForSource, isIndexableEvent, startOfTodayCtIso } from '../src/lib/seo-indexable'
import { checkSurface, extractPublishedEventIds, type ExpectedEvent, type SurfaceResult } from '../src/lib/seo-check'

const BASE = (process.env.SEO_CHECK_BASE ?? 'https://openeventz.com').replace(/\/$/, '')

function summary(lines: string[]): void {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (path) appendFileSync(path, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
}

async function fetchSurface(path: string): Promise<string> {
  // Cache-bust, so a CDN edge cache cannot answer on the origin's behalf. The whole point is to
  // see what the platform serves, and a stale edge copy IS the failure we are looking for — but
  // we want the origin's current answer to distinguish "configured wrong" from "cached once".
  const res = await fetch(`${BASE}${path}?seo-check=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`)
  return res.text()
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    summary(['### ❌ Published-surface check could not run', '', 'Supabase credentials are missing from the environment.'])
    process.exitCode = 1
    return
  }

  // DATABASE FIRST, pages second — see the race note in src/lib/seo-check.ts.
  const db = createClient(url, key)
  const todayIso = startOfTodayCtIso()
  const { data, error } = await db
    .from('events')
    .select('*')
    .gte('start_datetime', todayIso)
    .order('start_datetime', { ascending: true })
    .limit(2000)
  if (error) throw new Error(`reading events: ${error.message}`)

  // cityForSource is a complete Record over EventSource, so there is no "no city" branch to
  // silently drop a source into — which is how Kaleidoscope went three weeks without appearing
  // on /frisco. See src/lib/seo-indexable.ts.
  const expected: ExpectedEvent[] = (data as Event[])
    .filter(e => isIndexableEvent(e, todayIso))
    .map(e => ({ id: e.id, title: e.title, city: cityForSource(e.source) }))

  const [sitemap, frisco, plano] = await Promise.all([
    fetchSurface('/sitemap.xml'),
    fetchSurface('/frisco'),
    fetchSurface('/plano'),
  ])

  const results: SurfaceResult[] = [
    checkSurface('/sitemap.xml', expected, extractPublishedEventIds(sitemap)),
    checkSurface('/frisco', expected.filter(e => e.city === 'frisco'), extractPublishedEventIds(frisco)),
    checkSurface('/plano', expected.filter(e => e.city === 'plano'), extractPublishedEventIds(plano)),
  ]

  const failed = results.filter(r => !r.pass)
  const lines = [
    `### Published surfaces — ${failed.length === 0 ? '✅ match the database' : '❌ are behind the database'}`,
    '',
    `Checked \`${BASE}\` over HTTP, against ${expected.length} indexable event(s). Read the database first and the pages second, so an in-flight ingest produces *extra* published events rather than missing ones.`,
    '',
    '| Surface | Status | Detail |',
    '|---|---|---|',
    ...results.map(r => `| \`${r.surface}\` | ${r.pass ? '✅' : '❌'} | ${r.detail} |`),
  ]

  if (failed.length > 0) {
    lines.push(
      '',
      '**What this means.** Events exist in the database and are indexable, but the page a crawler',
      'fetches does not list them. That is the 2026-10/11 failure: a cached render served for days',
      'while the nightly ingest kept adding events nobody could discover.',
      '',
      '**What to check, in order:**',
      '1. **If only ONE city page is short and the sitemap is fine**, it is not caching — it is the',
      '   source→city map. Check `SOURCE_CITY` in `src/lib/seo-indexable.ts`: a source missing from it',
      '   omits every one of its events from that city page while the sitemap still lists them. This is',
      '   exactly how Kaleidoscope went three weeks unlinked, and it is what this check found first.',
      '2. Did the route lose `dynamic = \'force-dynamic\'`? Any `revalidate` on a crawler-facing route reintroduces the cache failure.',
      '3. Is `X-Vercel-Cache` a HIT with `X-Nextjs-Prerender: 1`? Then it is being served from a prerender.',
      '4. Did a deploy fail, leaving an older build live?',
      '',
      '**Missing, by surface:**',
      ...failed.flatMap(r => [
        '',
        `*${r.surface}* — ${r.missing.length} missing:`,
        ...r.missing.slice(0, 15).map(e => `- \`${e.id}\` — ${e.title}`),
        ...(r.missing.length > 15 ? [`- …and ${r.missing.length - 15} more`] : []),
      ]),
    )
  }

  summary(lines)
  // exitCode rather than exit(), so the Supabase client tears down cleanly — see heartbeat.ts.
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch(err => {
  summary(['### ❌ Published-surface check errored', '', '```', String(err?.message ?? err), '```'])
  process.exitCode = 1
})
