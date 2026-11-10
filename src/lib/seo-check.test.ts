import { readFileSync } from 'fs'
import { join } from 'path'
import { checkSurface, extractPublishedEventIds, type ExpectedEvent } from './seo-check'
import { CITY_SOURCES, cityForSource } from './seo-indexable'

const ev = (id: string, title = id, city: ExpectedEvent['city'] = 'frisco'): ExpectedEvent => ({ id, title, city })

describe('checkSurface', () => {
  it('passes when every expected event is published', () => {
    const r = checkSurface('/sitemap.xml', [ev('a'), ev('b')], new Set(['a', 'b']))
    expect(r.pass).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.detail).toContain('all 2')
  })

  it('fails on a missing event and names one in the detail', () => {
    const r = checkSurface('/frisco', [ev('a', 'Storytime'), ev('b', 'STEM Lab')], new Set(['a']))
    expect(r.pass).toBe(false)
    expect(r.missing.map(m => m.id)).toEqual(['b'])
    expect(r.detail).toContain('1 of 2')
    expect(r.detail).toContain('STEM Lab')
  })

  it('tolerates extra published events rather than failing', () => {
    // The database is read before the pages, so an event written mid-check shows up as extra.
    // Failing on that would make the check cry wolf during every ingest.
    const r = checkSurface('/sitemap.xml', [ev('a')], new Set(['a', 'written-mid-check']))
    expect(r.pass).toBe(true)
    expect(r.extraCount).toBe(1)
    expect(r.detail).toContain('+1 extra')
  })

  it('does not report an empty expectation as healthy', () => {
    const r = checkSurface('/plano', [], new Set())
    expect(r.pass).toBe(true)
    expect(r.detail).toContain('vacuous')
  })

  it('notes a surface publishing events when nothing is indexable', () => {
    const r = checkSurface('/plano', [], new Set(['ghost']))
    expect(r.detail).toContain('lists 1')
  })
})

describe('extractPublishedEventIds', () => {
  it('reads the sitemap\'s absolute URLs', () => {
    const xml = '<url><loc>https://openeventz.com/events/play-frisco-7887</loc></url>'
    expect([...extractPublishedEventIds(xml)]).toEqual(['play-frisco-7887'])
  })

  it('reads a page\'s relative hrefs and deduplicates', () => {
    const html = '<a href="/events/abc-1">x</a><a href="/events/abc-1">x</a><a href="/events/abc-2">y</a>'
    expect([...extractPublishedEventIds(html)].sort()).toEqual(['abc-1', 'abc-2'])
  })

  it('drops a fragment left by an RSC chunk boundary', () => {
    // Next streams its payload in `self.__next_f.push` chunks and a boundary can fall inside a
    // URL, so the same event appears truncated AND complete. Counting the fragment as an extra
    // puts noise in the field an operator reads to decide if something is wrong.
    const html = '"/events/frisco-library-6a57b29bf4e"]);self.__next_f.push([1,"/events/frisco-library-6a57b29bf4e5db3d00c1e6c8"'
    expect([...extractPublishedEventIds(html)]).toEqual(['frisco-library-6a57b29bf4e5db3d00c1e6c8'])
  })

  it('keeps two genuinely distinct ids where neither is a prefix', () => {
    const html = '/events/play-frisco-7887 /events/play-frisco-7888'
    expect([...extractPublishedEventIds(html)].sort()).toEqual(['play-frisco-7887', 'play-frisco-7888'])
  })

  it('stops at the end of the id', () => {
    expect([...extractPublishedEventIds('<loc>https://x/events/abc_1</loc>')]).toEqual(['abc'])
  })
})

describe('every source belongs to exactly one city', () => {
  // The bug this prevents: kaleidoscope-park entered the pipeline on 2026-10-20 and was never
  // added to the city map. The app listed it, the sitemap listed it, and /frisco omitted all ten
  // of its events for three weeks — invisible from every direction except the one page built to
  // rank for the city.
  it('maps all four sources, with Kaleidoscope under Frisco', () => {
    expect(cityForSource('frisco-library')).toBe('frisco')
    expect(cityForSource('play-frisco')).toBe('frisco')
    expect(cityForSource('kaleidoscope-park')).toBe('frisco')
    expect(cityForSource('plano-library')).toBe('plano')
  })

  it('partitions the sources — no source in both cities, none in neither', () => {
    const all = [...CITY_SOURCES.frisco, ...CITY_SOURCES.plano]
    expect(new Set(all).size).toBe(all.length)
    for (const s of all) expect([...CITY_SOURCES[cityForSource(s)]]).toContain(s)
  })

  it('declares the map as a complete Record over EventSource', () => {
    // Structural: a city->sources list cannot be checked for completeness, which is why the
    // omission above was possible. The source->city Record makes a new source a type error.
    const src = readFileSync(join(__dirname, 'seo-indexable.ts'), 'utf8')
    expect(src).toContain("Record<Event['source'], CitySlug>")
  })
})
