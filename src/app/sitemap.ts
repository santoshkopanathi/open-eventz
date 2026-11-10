import type { MetadataRoute } from 'next'
import { getIndexableEvents } from '@/lib/seo-data'
import { SITE_URL, eventUrl, cityUrl } from '@/lib/site'

// Built per request, deliberately.
//
// This was `revalidate = 3600` — hourly ISR — and in production it did not regenerate at all.
// Measured twice, a fortnight apart: on 2026-10-22, 10 indexable events created since the
// previous deploy were absent; on 2026-11-10, 14 more over four days. Each deploy rebuilt the
// file and hid the symptom, so it looked intermittent rather than total. **The sitemap only
// ever changed when the site was rebuilt**, which meant every event the nightly ingest added
// stayed invisible to Google until an unrelated deploy happened to occur — the per-event SEO
// work silently doing nothing between releases.
//
// A sitemap is a few hundred URLs read by crawlers a handful of times a day; it does not need
// a cache. Dynamic costs one Supabase query per request and is correct by construction, which
// beats a cache whose refresh we cannot verify from outside.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await getIndexableEvents()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: cityUrl('frisco'), changeFrequency: 'daily', priority: 0.9 },
    { url: cityUrl('plano'), changeFrequency: 'daily', priority: 0.9 },
  ]

  const eventRoutes: MetadataRoute.Sitemap = events.map(e => ({
    url: eventUrl(e.id),
    lastModified: e.ingested_at ?? e.created_at,
    changeFrequency: 'weekly',
    priority: 0.7,
  }))

  return [...staticRoutes, ...eventRoutes]
}
