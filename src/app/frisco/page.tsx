import type { Metadata } from 'next'
import EventsApp from '@/components/EventsApp'
import CityEventIndex from '@/components/CityEventIndex'
import { cityUrl } from '@/lib/site'

export const revalidate = 3600

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
