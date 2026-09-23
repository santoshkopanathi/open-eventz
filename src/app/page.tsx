import type { Metadata } from 'next'
import EventsApp from '@/components/EventsApp'
import { SITE_URL } from '@/lib/site'
import { buildSiteJsonLd } from '@/lib/site-jsonld'

// `?city=frisco|plano` is a client-side deep link into the same page, not a separate
// document — the canonical keeps those variants from being treated as duplicates.
export const metadata: Metadata = {
  alternates: { canonical: SITE_URL },
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildSiteJsonLd()) }}
      />
      <EventsApp />
    </>
  )
}
