import { readFileSync } from 'fs'
import { join } from 'path'

// Surface parity for the supervision "can kids be dropped off?" callout.
//
// WHY THIS EXISTS. supervision.test.ts proves the LOGIC is right for every source. It cannot
// prove the badge is actually RENDERED — and that is the failure mode this project has hit
// twice: (1) the badge was silently narrowed to Frisco-only in a pre-git refactor and shipped
// blank for weeks; (2) the /events/[id] server page — the surface a shared link lands on —
// never rendered it at all from the day it shipped. Both passed every test, because no test
// asked "which surfaces show it?"
//
// This is a source-text check rather than a render test on purpose: the repo has no
// react-testing-library, and the same file-parity idea already guards the test docs
// (scripts/check-doc-parity.mjs). Adding a new detail surface means adding it here, which is
// the point — the list is the spec for "every place an event is shown in full".
const SURFACES = [
  'src/components/EventDetail.tsx',      // in-app detail panel (desktop drawer + mobile overlay)
  'src/app/events/[id]/page.tsx',        // server-rendered per-event page (shared links, SEO)
]

describe('supervision callout — rendered on every event detail surface', () => {
  test.each(SURFACES)('%s renders <SupervisionCallout>', file => {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    expect(src).toContain('SupervisionCallout')
  })

  test('every surface uses the shared component, not its own copy of the markup', () => {
    // getSupervisionBadge must be called only from the shared component (and its own tests),
    // so the presentation can never drift between surfaces.
    for (const file of SURFACES) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      expect(src).not.toContain('getSupervisionBadge')
    }
  })
})
