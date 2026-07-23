import type { Metadata } from 'next'
import CityLanding from '@/components/CityLanding'
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

export default function PlanoPage() {
  return <CityLanding city="plano" />
}
