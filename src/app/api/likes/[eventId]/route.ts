import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('like_counts')
    .select('count')
    .eq('event_id', eventId)
    .single()

  if (error) return NextResponse.json({ count: 0 })
  return NextResponse.json({ count: data?.count ?? 0 })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  const unlike = body?.unlike === true

  const { data: existing } = await db
    .from('like_counts')
    .select('count')
    .eq('event_id', eventId)
    .single()

  const delta = unlike ? -1 : 1

  if (existing) {
    const newCount = Math.max(0, existing.count + delta)
    const { data } = await db
      .from('like_counts')
      .update({ count: newCount, updated_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .select('count')
      .single()
    return NextResponse.json({ count: data?.count ?? newCount })
  } else {
    const { data } = await db
      .from('like_counts')
      .insert({ event_id: eventId, count: 1 })
      .select('count')
      .single()
    return NextResponse.json({ count: data?.count ?? 1 })
  }
}
