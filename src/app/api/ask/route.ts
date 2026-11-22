import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import type { Event } from '@/lib/types'
import { KID_VISIBILITY_GATE, NOT_ADULTS_ONLY } from '@/lib/catalog'
import { ask } from '@/lib/ask/ask'
import { parseQuestion, selectEvents, emptyUsage } from '@/lib/ask/llm'
import { TZ, addDays, MAX_DAYS_AHEAD } from '@/lib/ask/core'
import { takeAskSlot } from '@/lib/ask/ceiling'

/**
 * POST /api/ask — Ask Open Eventz. Behind a flag: with ASK_ENABLED unset this route refuses
 * every request, and the list view is unchanged (spec "Feature flag").
 *
 * Daily ceiling (spec "Runaway cost", owner-approved 2026-11-18): 100 questions a day, about
 * $2, counted in the database so every server instance shares one count (migration 010,
 * src/lib/ask/ceiling.ts). If the count can't be checked, Ask shows "unavailable": fail closed.
 * Logs nothing about the question (spec "Personal data in questions").
 */

async function loadCatalog(today: string): Promise<Event[]> {
  // A deliberately loose window (a day either side, in UTC): retrieve() then applies the exact
  // Central calendar dates, so no fixed UTC offset is assumed here.
  const startIso = `${addDays(today, -1)}T00:00:00Z`
  const endIso = `${addDays(today, MAX_DAYS_AHEAD + 2)}T00:00:00Z`
  const [up, on] = await Promise.all([
    supabase.from('events').select('*').or(KID_VISIBILITY_GATE).or(NOT_ADULTS_ONLY)
      .gte('start_datetime', startIso).lt('start_datetime', endIso).order('start_datetime').limit(1000),
    supabase.from('events').select('*').or(KID_VISIBILITY_GATE).or(NOT_ADULTS_ONLY)
      .lt('start_datetime', startIso).gte('end_datetime', startIso).limit(100),
  ])
  if (up.error) throw new Error(up.error.message)
  const seen = new Set<string>()
  return [...((on.data ?? []) as Event[]), ...((up.data ?? []) as Event[])].filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

export async function POST(request: Request) {
  if (process.env.ASK_ENABLED !== 'true') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json().catch(() => null) as { question?: unknown; tab?: unknown } | null
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 300) : ''
  const tab = body?.tab === 'plano' ? 'plano' : 'frisco'
  if (!question) return NextResponse.json({ error: 'Ask a question about events.' }, { status: 400 })

  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  // Over the ceiling, or if the shared count can't be checked, the parent keeps the normal list
  // (spec: "Fails to: Filter view").
  if (!(await takeAskSlot((fn, args) => supabase.rpc(fn, args), today))) return NextResponse.json({ kind: 'unavailable' })

  try {
    const result = await ask(question, tab, today, await loadCatalog(today), { parse: parseQuestion, select: selectEvents }, emptyUsage())
    const { debug: _debug, ...shown } = result // nothing internal reaches the browser
    return NextResponse.json(shown)
  } catch {
    return NextResponse.json({ kind: 'unavailable' })
  }
}
