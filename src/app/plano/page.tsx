import type { Metadata } from 'next'
import EventsApp from '@/components/EventsApp'
import CityEventIndex from '@/components/CityEventIndex'
import { cityUrl } from '@/lib/site'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Free Kids Events in Plano, TX — This Week',
  description:
    'Discover free kids events in Plano, TX — storytimes, maker programs, and family activities across all Plano Public Library branches, all in one place. Updated daily.',
  alternates: { canonical: cityUrl('plano') },
  openGraph: {
    title: 'Free Kids Events in Plano, TX',
    description: 'Free kids events across all Plano Public Library branches. Updated daily.',
    url: cityUrl('plano'),
    siteName: 'Open Eventz',
    type: 'website',
  },
}

// The app itself, preselected to Plano — search traffic lands in the working product instead
// of a separate list page. CityEventIndex below it keeps the city name, blurb and event titles
// in the server-rendered HTML this page ranks on; the app above is client-rendered.
export default function PlanoPage() {
  return (
    <>
      <EventsApp initialCity="plano" />
      <CityEventIndex city="plano" />
    </>
  )
}
