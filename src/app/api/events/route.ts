import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Convert a YYYY-MM-DD date string to a UTC ISO string at midnight CT (CDT = UTC-5)
function dateToCtMidnightUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0)).toISOString()
}

// Convert a YYYY-MM-DD date string to a UTC ISO string at end-of-day CT (next day midnight CT)
function dateToCtEndOfDayUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1, 5, 0, 0)).toISOString()
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const sources = searchParams.getAll('source')
  const branches = searchParams.getAll('branch')
  const is_free = searchParams.get('is_free')
  const age = searchParams.get('age')
  const date_from = searchParams.get('date_from')
  const date_to = searchParams.get('date_to')

  let query = supabase
    .from('events')
    .select('*')
    .order('start_datetime', { ascending: true })

  if (sources.length === 1) query = query.eq('source', sources[0])
  if (sources.length > 1) query = query.in('source', sources)
  if (branches.length === 1) query = query.eq('location_name', branches[0])
  if (branches.length > 1) query = query.in('location_name', branches)
  if (is_free === 'true') query = query.eq('is_free', true)

  // Date filters: convert user-selected dates (CT local) to UTC boundaries
  if (date_from) query = query.gte('start_datetime', dateToCtMidnightUtc(date_from))
  if (date_to) query = query.lt('start_datetime', dateToCtEndOfDayUtc(date_to))

  if (age) {
    const parts = age.split('-').map(Number)
    const ageMin = parts[0]
    const ageMax = parts.length === 2 ? parts[1] : parts[0]
    // Require explicit age data — events with null age fields are excluded
    query = query.not('age_min', 'is', null)
    query = query.not('age_max', 'is', null)
    // Event age range must overlap with the requested group
    query = query.lte('age_min', ageMax)
    query = query.gte('age_max', ageMin)
  }

  // Always exclude adults-only events (age_min >= 18 marks Frisco Library adult events)
  query = query.or('age_min.is.null,age_min.lt.18')

  // Cutoff = midnight CT today
  const now = new Date()
  const todayCT = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  todayCT.setUTCHours(5, 0, 0, 0) // midnight CDT (UTC-5)
  if (now.getUTCHours() < 5) todayCT.setUTCDate(todayCT.getUTCDate() - 1)
  const iso = todayCT.toISOString()

  // Primary: events starting today or later
  const { data: upcoming, error } = await query.gte('start_datetime', iso).limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Supplemental: multi-day events that started before today but end on/after today
  let ongoingQuery = supabase
    .from('events')
    .select('*')
    .lt('start_datetime', iso)
    .gte('end_datetime', iso)
  if (sources.length === 1) ongoingQuery = ongoingQuery.eq('source', sources[0])
  if (sources.length > 1) ongoingQuery = ongoingQuery.in('source', sources)
  if (branches.length === 1) ongoingQuery = ongoingQuery.eq('location_name', branches[0])
  if (branches.length > 1) ongoingQuery = ongoingQuery.in('location_name', branches)
  if (is_free === 'true') ongoingQuery = ongoingQuery.eq('is_free', true)
  if (age) {
    const parts = age.split('-').map(Number)
    const ageMin = parts[0]
    const ageMax = parts.length === 2 ? parts[1] : parts[0]
    ongoingQuery = ongoingQuery.not('age_min', 'is', null)
    ongoingQuery = ongoingQuery.not('age_max', 'is', null)
    ongoingQuery = ongoingQuery.lte('age_min', ageMax)
    ongoingQuery = ongoingQuery.gte('age_max', ageMin)
  }
  ongoingQuery = ongoingQuery.or('age_min.is.null,age_min.lt.18')
  const { data: ongoing } = await ongoingQuery.limit(100)

  // Merge, deduplicate by id, sort by start_datetime
  const seen = new Set<string>()
  let all = [...(ongoing ?? []), ...(upcoming ?? [])].filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  }).sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))

  // Exclude Frisco Library adult programs that BiblioCommons mislabels under children feeds
  if (age && (sources.length === 0 || sources.includes('frisco-library'))) {
    const FRISCO_ADULT_KW = [
      'book club', 'write club', 'figure club', "reader's choice",
      "entrepreneur's workshop", 'esl book',
    ]
    all = all.filter(e => {
      if (e.source !== 'frisco-library') return true
      const t = e.title.toLowerCase()
      return !FRISCO_ADULT_KW.some(kw => t.includes(kw))
    })
  }

  return NextResponse.json({ events: all })
}
