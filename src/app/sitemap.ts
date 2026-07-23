import type { MetadataRoute } from 'next'
import { getIndexableEvents } from '@/lib/seo-data'
import { SITE_URL, eventUrl, cityUrl } from '@/lib/site'

// Regenerated hourly (ISR) so newly-ingested events enter the sitemap and past
// ones fall out without a redeploy.
export const revalidate = 3600

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
