import { SITE_URL, eventUrl, cityUrl, sourceOrg, sourceCity } from './site'

describe('site URL helpers', () => {
  test('SITE_URL has no trailing slash', () => {
    expect(SITE_URL.endsWith('/')).toBe(false)
  })

  test('eventUrl builds a canonical /events/[id] absolute URL', () => {
    expect(eventUrl('abc')).toBe(`${SITE_URL}/events/abc`)
  })

  test('cityUrl builds a city landing absolute URL', () => {
    expect(cityUrl('frisco')).toBe(`${SITE_URL}/frisco`)
    expect(cityUrl('plano')).toBe(`${SITE_URL}/plano`)
  })
})

describe('source → org / city', () => {
  test('each source maps to a named organizer with a url', () => {
    for (const s of ['frisco-library', 'plano-library', 'play-frisco'] as const) {
      const org = sourceOrg(s)
      expect(org.name.length).toBeGreaterThan(0)
      expect(org.url).toMatch(/^https?:\/\//)
    }
  })

  test('sourceCity routes plano-library to plano and Frisco sources to frisco', () => {
    expect(sourceCity('plano-library')).toBe('plano')
    expect(sourceCity('frisco-library')).toBe('frisco')
    expect(sourceCity('play-frisco')).toBe('frisco')
  })
})
