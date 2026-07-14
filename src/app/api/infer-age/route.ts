import { NextRequest, NextResponse } from 'next/server'
import { inferPlayFriscoAge } from '@/lib/age-inference'

// Thin HTTP wrapper over the shared inference function (BUILD-LOG Decision 5).
// Ingest imports the function directly; this route exists for standalone testing
// via curl / the regression checklist. It is NOT in the ingest -> Claude path.
export async function POST(req: NextRequest) {
  let body: { title?: string; description?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title : ''
  const description = typeof body.description === 'string' ? body.description : ''
  if (!title && !description) {
    return NextResponse.json({ error: 'title or description required' }, { status: 400 })
  }

  const result = await inferPlayFriscoAge({ title, description })
  if (!result) {
    return NextResponse.json({ error: 'Inference failed or returned no result' }, { status: 502 })
  }

  return NextResponse.json(result)
}
