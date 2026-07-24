import { NextRequest } from 'next/server'
import { getEventById } from '@/lib/seo-data'
import { buildIcs, icsFilename } from '@/lib/ics'

// Serves a single event as an iCalendar resource. Because this is a real URL
// returning `text/calendar` (not a client-side Blob download), iOS Safari opens
// it directly in the "Add to Calendar" screen instead of routing it to Files.
// `inline` reinforces "open, don't save"; the filename is used by desktop browsers.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const event = await getEventById(eventId)
  if (!event) return new Response('Event not found', { status: 404 })

  const ics = buildIcs(event)
  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${icsFilename(event)}"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
