import type { Metadata } from 'next'
import EventsApp from '@/components/EventsApp'
import CityEventIndex from '@/components/CityEventIndex'
import { cityUrl } from '@/lib/site'

// Rendered per request, deliberately — see sitemap.ts for the measurement that prompted it.
//
// This was `revalidate = 3600`. On a low-traffic site that is close to useless: Next serves the
// STALE copy and regenerates in the background, so with crawler-sparse traffic almost every
// visit gets the old render. Measured 2026-11-10 — this page was serving events from Nov 7,
// which a current render cannot produce at all (getIndexableEvents filters on today), so it had
// not regenerated in three days despite an hourly window.
//
// The deeper reason not to cache it: every decision on this page is a function of the clock —
// which events are upcoming, and whether the page is indexable. **A time-dependent decision
// must not be cached past the time it depends on.** One Supabase query per request is the
// cheaper half of that trade.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Free Kids Events in Frisco, TX — This Week',
  description:
    'Discover free and low-cost kids events in Frisco, TX — Frisco Public Library storytimes and Play Frisco parks & rec programs, all in one place. Updated daily.',
  alternates: { canonical: cityUrl('frisco') },
  openGraph: {
    title: 'Free Kids Events in Frisco, TX',
    description: 'Free and low-cost kids events across Frisco Public Library and Play Frisco. Updated daily.',
    url: cityUrl('frisco'),
    siteName: 'Open Eventz',
    type: 'website',
  },
}

// The app itself, preselected to Frisco — search traffic lands in the working product instead
// of a separate list page. CityEventIndex below it keeps the city name, blurb and event titles
// in the server-rendered HTML this page ranks on; the app above is client-rendered.
export default function FriscoPage() {
  return (
    <>
      <EventsApp initialCity="frisco" />
      <CityEventIndex city="frisco" />
    </>
  )
}
