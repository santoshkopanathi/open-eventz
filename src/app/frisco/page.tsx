import type { Metadata } from 'next'
import CityLanding from '@/components/CityLanding'
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

export default function FriscoPage() {
  return <CityLanding city="frisco" />
}
