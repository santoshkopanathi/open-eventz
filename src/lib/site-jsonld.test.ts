import { SITE_URL } from './site'
import { buildSiteJsonLd, SITE_NAME } from './site-jsonld'

type Node = { '@type': string; '@id'?: string; url?: string; name?: string; publisher?: { '@id': string } }

const graph = () => buildSiteJsonLd()['@graph'] as unknown as Node[]
const node = (type: string) => graph().find(n => n['@type'] === type)

describe('site JSON-LD', () => {
  test('emits a WebSite and an Organization', () => {
    expect(node('WebSite')).toBeDefined()
    expect(node('Organization')).toBeDefined()
  })

  // The whole point of the markup: Google prints this as the site name. A search
  // result showing the host's owner ("Vercel") instead is the failure it prevents.
  test('names the site Open Eventz', () => {
    expect(node('WebSite')?.name).toBe(SITE_NAME)
    expect(node('Organization')?.name).toBe(SITE_NAME)
    expect(SITE_NAME).toBe('Open Eventz')
  })

  // Regression: the site-name feature is matched to the indexed domain root, so a
  // trailing slash or any deviation from SITE_URL silently opts the site out.
  test('WebSite url is exactly the canonical origin, no trailing slash', () => {
    expect(node('WebSite')?.url).toBe(SITE_URL)
    expect(node('WebSite')?.url?.endsWith('/')).toBe(false)
    expect(node('Organization')?.url).toBe(SITE_URL)
  })

  test('the WebSite publisher resolves to the Organization node', () => {
    expect(node('WebSite')?.publisher?.['@id']).toBe(node('Organization')?.['@id'])
  })

  test('serialises to JSON safely (it is injected into a script tag)', () => {
    const json = JSON.stringify(buildSiteJsonLd())
    expect(json).not.toContain('</script')
    expect(JSON.parse(json)['@context']).toBe('https://schema.org')
  })
})
