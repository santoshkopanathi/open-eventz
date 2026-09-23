import { SITE_URL } from './site'

// ===========================================================================
// Site-level structured data — the home page only.
//
// Google derives the site name it prints above a search result from `WebSite`
// markup on a site's home page. Without it, it falls back to whatever it can
// infer from the host — which is how open-eventz.vercel.app was listed as
// "Vercel", with Vercel's icon. The event pages and the city pages already
// carry their own JSON-LD; this is the one surface that names the site itself.
//
// Per Google's documentation this belongs on the domain root and nowhere else:
// site-name markup on an inner page is ignored, so `/frisco` must not emit it.
// ===========================================================================

export const SITE_NAME = 'Open Eventz'

const SITE_DESCRIPTION =
  'Free and low-cost events for kids in Frisco and Plano, TX — library storytimes, parks & recreation programs, and family activities, updated daily.'

/**
 * Pure: the home page's `WebSite` + `Organization` graph, ready to `JSON.stringify`
 * into a `<script type="application/ld+json">`. Both nodes carry `@id`s so the
 * WebSite can name its publisher rather than repeating the organization inline.
 */
export function buildSiteJsonLd() {
  const organizationId = `${SITE_URL}/#organization`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        // Must be exactly the indexed origin — the site name is matched to the
        // domain root, so a trailing slash or a stale host silently opts out.
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: 'en-US',
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
      },
    ],
  }
}
