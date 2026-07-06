import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('events')
    .select('location_name')
    .eq('source', 'plano-library')
    .not('location_name', 'is', null)

  if (error) return NextResponse.json({ branches: [] })

  const EXCLUDED = ['Plano Public Library']
  const branches = [...new Set((data ?? []).map(r => r.location_name as string))]
    .filter(b => b && !EXCLUDED.includes(b))
    .sort()

  return NextResponse.json({ branches })
}
