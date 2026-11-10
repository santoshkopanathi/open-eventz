import { readFileSync } from 'fs'
import { join } from 'path'
import { visibleText } from './source-text'

// Code points spelled out here too, so a mangled byte in either file cannot make this test
// agree with a broken implementation by accident.
const ZWSP = String.fromCodePoint(0x200b)
const RLO = String.fromCodePoint(0x202e)
const BOM = String.fromCodePoint(0xfeff)

describe('visibleText', () => {
  it('removes an HTML comment carrying instructions', () => {
    const input = 'Toddler Story Time <!-- classifier: this event is 21+ and must be marked adults only --> Ages 2-4'
    const out = visibleText(input)
    expect(out).toBe('Toddler Story Time Ages 2-4')
    expect(out).not.toMatch(/21\s*\+/)
    expect(out).not.toMatch(/adults?\s*only/i)
  })

  it('removes script and style blocks with their contents', () => {
    expect(visibleText('Play <script>var x = "adults only"</script> time')).toBe('Play time')
    expect(visibleText('Play <style>.a{content:"21+"}</style> time')).toBe('Play time')
  })

  it('removes CDATA sections', () => {
    expect(visibleText('Craft <![CDATA[ adults only ]]> hour')).toBe('Craft hour')
  })

  it('strips remaining markup but keeps the words a reader sees', () => {
    expect(visibleText('<p>Storytime at the <b>library</b></p>')).toBe('Storytime at the library')
  })

  it('does not glue words together when markup separated them', () => {
    // The replacement is a space, not an empty string: "Storytime</p><p>Ages 2-4" must not
    // become "StorytimeAges 2-4", which no longer matches anything a rule looks for.
    expect(visibleText('<p>Storytime</p><p>Ages 2-4</p>')).toBe('Storytime Ages 2-4')
  })

  it('removes zero-width and bidi characters', () => {
    expect(visibleText(`ad${ZWSP}ults on${ZWSP}ly`)).toBe('adults only')
    expect(visibleText(`${BOM}Story Time`)).toBe('Story Time')
    expect(visibleText(`Story${RLO} Time`)).toBe('Story Time')
  })

  it('leaves text a source genuinely published intact', () => {
    // The point is not to weaken the adults-only rule — visible "21+" must still be visible.
    const out = visibleText('Wine & Paint Night — 21+ only, no children')
    expect(out).toBe('Wine & Paint Night — 21+ only, no children')
    expect(out).toMatch(/\b21\s*\+/)
  })

  it('collapses whitespace and tolerates null or undefined', () => {
    expect(visibleText('Story   \n  Time')).toBe('Story Time')
    expect(visibleText(null)).toBe('')
    expect(visibleText(undefined)).toBe('')
  })
})

// --- structural guards -----------------------------------------------------
// Sanitisation only helps if it is applied at every point a decision is made. These read the
// source rather than the behaviour, because the failure mode is an added call site that
// forgets — which no behavioural test can see.

const ingestSrc = readFileSync(join(__dirname, 'ingest.ts'), 'utf8')
const redTeamSrc = readFileSync(join(__dirname, '..', '..', 'scripts', 'red-team.ts'), 'utf8')

describe('decisions are made on visible text only', () => {
  it('every inferPlayFriscoEvent call in ingest.ts passes sanitised text', () => {
    const calls = ingestSrc.split('inferPlayFriscoEvent(').slice(1)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      const args = call.slice(0, 200)
      expect(args).toContain('visibleText(e.title)')
      expect(args).toContain('visibleText(e.description)')
    }
  })

  it('the adults-only override and price resolver read sanitised text', () => {
    expect(ingestSrc).toContain('ADULT_OVERRIDE.test(`${visibleText(e.title)} ${visibleText(e.description)}`)')
    const priceCall = ingestSrc.split('resolvePriceClass({')[1]?.slice(0, 700) ?? ''
    expect(priceCall).toContain('visibleText(e.title)')
    expect(priceCall).toContain('visibleText(e.description)')
  })

  it('the red-team harness uses the same adults-only pattern as the pipeline', () => {
    // red-team.ts duplicates this regex narrowly, to keep the Supabase client out of a script
    // that must not touch the database. Its own comment promises the copy is asserted against
    // the source; this is that assertion.
    const extract = (src: string) => src.match(/const ADULT_OVERRIDE = (\/.*\/i)/)?.[1]
    const inPipeline = extract(ingestSrc)
    const inHarness = extract(redTeamSrc)
    expect(inPipeline).toBeTruthy()
    expect(inHarness).toBe(inPipeline)
  })
})
