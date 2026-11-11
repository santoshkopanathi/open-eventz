import { parseLongDescription } from './kaleidoscope-parse'

// The real shape: the park's CMS writes the first ~200 chars of the body into the page's meta
// description, and the Event JSON-LD carries that truncated copy. The full prose is a run of
// sibling <p> elements in the same HTML.
const page = (body: string) => `<html><head><title>x</title></head><body>
<div class="calendar-help"><p>Stay in the Know</p></div>
<div class="event-body">
${body}
</div>
<footer><p>Kaleidoscope Park 2026</p></footer>
</body></html>`

const PARA_1 = 'Bring color and creativity to the park during Chalk the Park, a community art event for all ages.'
const PARA_2 = 'Artists will work through the day and judging takes place at 5:30pm.'
const PARA_3 = 'PARKING: use the garage at 6605 Warren Parkway.'
const BODY = `<p>${PARA_1}</p>\n<p>${PARA_2}</p>\n<p>${PARA_3}</p>`

describe('parseLongDescription — recovering the text the source truncated', () => {
  it('returns the full sibling run when the JSON-LD copy is cut off', () => {
    const truncated = PARA_1.slice(0, 80) + '…'
    const got = parseLongDescription(page(BODY), truncated)
    expect(got).toBe([PARA_1, PARA_2, PARA_3].join('\n\n'))
  })

  it('anchors when the summary SPANS several short paragraphs', () => {
    // The real failing case: "Every First Saturday | 7 PM – 9 PM" is its own <p>, so the
    // summary is longer than the paragraph it starts in. A one-directional prefix test missed
    // this page entirely and left it truncated.
    const lead = 'Every First Saturday | 7 PM to 9 PM'
    const rest = 'Bring a blanket and come dance the night away at our monthly series.'
    const html = page(`<p>${lead}</p>\n<p>${rest}</p>`)
    const got = parseLongDescription(html, `${lead} ${rest.slice(0, 40)}…`)
    expect(got).toBe(`${lead}\n\n${rest}`)
  })

  it('stops at a new section rather than swallowing the footer', () => {
    // Markup between two paragraphs means the description ended. The footer paragraph sits
    // outside the body div and must not be collected.
    const got = parseLongDescription(page(BODY), PARA_1.slice(0, 80) + '…')
    expect(got).not.toContain('Kaleidoscope Park 2026')
    expect(got).not.toContain('Stay in the Know')
  })
})

describe('parseLongDescription — fails closed', () => {
  // Every null below costs a shorter description, which is what we already had. Returning
  // the wrong block of prose would feed the classifier text about a different event.
  it('returns null when there is no JSON-LD description to anchor on', () => {
    expect(parseLongDescription(page(BODY), null)).toBeNull()
    expect(parseLongDescription(page(BODY), '')).toBeNull()
  })

  it('returns null when the summary is too short to anchor safely', () => {
    // A 10-character probe would match page furniture.
    expect(parseLongDescription(page(BODY), 'Chalk…')).toBeNull()
  })

  it('returns null when the anchor matches no paragraph', () => {
    expect(parseLongDescription(page(BODY), 'A completely different event description here…')).toBeNull()
  })

  it('returns null — not something shorter — when the JSON-LD was NOT truncated', () => {
    // An untruncated page already holds its full text. A "fix" that shortened it would be a
    // regression wearing a fix's clothes.
    const full = [PARA_1, PARA_2, PARA_3].join(' ')
    const html = page(`<p>${PARA_1}</p>`)
    expect(parseLongDescription(html, full)).toBeNull()
  })

  it('returns null on markup with no paragraphs at all', () => {
    expect(parseLongDescription('<html><body><div>no paragraphs</div></body></html>', PARA_1 + '…')).toBeNull()
  })
})

describe('parseLongDescription — bounded', () => {
  it('caps the result so a markup change cannot pull in the whole page', () => {
    const long = 'x'.repeat(500)
    const many = Array.from({ length: 40 }, (_, i) => `<p>${i === 0 ? PARA_1 : long}</p>`).join('\n')
    const got = parseLongDescription(page(many), PARA_1.slice(0, 80) + '…')
    expect(got!.length).toBeLessThanOrEqual(6000)
  })
})

describe('structural guard', () => {
  it('ingest applies parseLongDescription to the Kaleidoscope connector', () => {
    const src = require('node:fs').readFileSync('src/lib/ingest.ts', 'utf8') as string
    expect(src).toMatch(/parseLongDescription\(html, parsed\.description\)/)
    // Must be assigned back, or the recovered text is computed and thrown away.
    expect(src).toMatch(/if \(fullDescription\) parsed\.description = fullDescription/)
  })
})
