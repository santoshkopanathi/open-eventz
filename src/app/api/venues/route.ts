import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('events')
    .select('location_name, location_address, location_lat, location_lng, source')
    .not('location_lat', 'is', null)
    .not('location_lng', 'is', null)
    .not('location_name', 'is', null)

  if (error) return NextResponse.json({ venues: [] })

  const seen = new Set<string>()
  const venues = (data ?? []).filter(r => {
    if (/virtual/i.test(r.location_name ?? '')) return false
    const key = `${r.location_name}|${r.source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return NextResponse.json({ venues })
}
