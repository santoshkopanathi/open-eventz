import { test, expect, type Page } from '@playwright/test'

// --- Fixtures ---------------------------------------------------------------
// A future start so events aren't filtered by the "past events" cutoff had the real API run;
// here every /api/* call is mocked, so the client renders exactly what we return.
function ev(over: Record<string, unknown>) {
  return {
    id: 'x', source: 'frisco-library', title: 'Event', description: 'Some description.',
    start_datetime: '2026-08-01T15:00:00Z', end_datetime: null,
    location_name: 'Somewhere', location_address: null, location_lat: null, location_lng: null,
    is_free: true, price_text: 'Free', age_min: null, age_max: null, age_label: null,
    is_recurring: false, recurrence_label: null, thumbnail_url: null, event_url: 'https://example.com',
    category: 'library', registration_required: false,
    kid_relevant: null, age_buckets: null, age_confidence: null, age_reasoning: null,
    price_class: null, price_confidence: null, price_reasoning: null,
    ingested_at: '', created_at: '',
    ...over,
  }
}

const BRANCHES = ['Davis Library', 'Haggard Library', 'Harrington Library', 'Parr Library', 'Schimelpfenig Library', 'Virtual']

const FRISCO = [
  ev({ id: 'f1', source: 'frisco-library', title: 'Frisco Kids Program', age_min: 6, age_max: 12 }),         // structured → NO card badge
  ev({ id: 'p1', source: 'play-frisco', title: 'Play Family Day', kid_relevant: true, age_confidence: 'high', age_buckets: ['family'] }), // ~ Family ✦
  ev({ id: 'p2', source: 'play-frisco', title: 'Teen Art Workshop', kid_relevant: true, age_confidence: 'high', age_buckets: ['teen'] }), // ✦
  // Inferred free (family + free) → "~ Family ✦" + "Free ✦"; ONE combined disclosure in detail
  ev({ id: 'p3', source: 'play-frisco', title: 'Inferred Free Playtime', kid_relevant: true, age_confidence: 'high', age_buckets: ['family'], price_class: 'free', price_confidence: 'inferred', is_free: true, price_text: 'Free' }),
  // Inferred paid (family + paid, no Cost field) → "Paid ✦" + combined paid disclosure
  ev({ id: 'p4', source: 'play-frisco', title: 'Ticketed Family Outing', kid_relevant: true, age_confidence: 'high', age_buckets: ['family'], price_class: 'paid', price_confidence: 'inferred', is_free: false, price_text: 'Paid' }),
  // Cost-field CONFIRMED free (Option A) → plain "Free" on card, NO ✦, no price disclosure
  ev({ id: 'p5', source: 'play-frisco', title: 'Cost Field Free Program', kid_relevant: true, age_confidence: 'high', age_buckets: ['family'], price_class: 'free', price_confidence: 'confirmed', is_free: true, price_text: 'Free' }),
  ev({ id: 'f2', source: 'frisco-library', title: 'Weekly Storytime', age_min: 0, age_max: 5, is_recurring: true, recurrence_label: 'Recurring', registration_required: true }),
]

const PLANO = [
  ev({ id: 'pl1', source: 'plano-library', title: 'Plano All Ages Fair', age_min: 0, age_max: 17, age_buckets: ['family'], location_name: 'Haggard Library' }), // Family (gold)
  ev({ id: 'pl2', source: 'plano-library', title: 'Plano Kids Club', age_min: 6, age_max: 12, location_name: 'Davis Library' }), // structured → NO card badge
]

let lastEventsUrl = ''

async function mockApi(page: Page) {
  lastEventsUrl = ''
  await page.route('**/api/venues*', r => r.fulfill({ json: { venues: [] } }))
  await page.route('**/api/branches*', r => r.fulfill({ json: { branches: BRANCHES } }))
  await page.route('**/api/likes/**', r => r.fulfill({ json: { count: 0 } }))
  await page.route('**/api/events*', r => {
    lastEventsUrl = r.request().url()
    const isPlano = new URL(lastEventsUrl).searchParams.getAll('source').includes('plano-library')
    r.fulfill({ json: { events: isPlano ? PLANO : FRISCO } })
  })
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.getByRole('tab', { name: /Frisco City/ })).toBeVisible()
})

// --- §1 / §2  card + detail badge rendering ---------------------------------

test('cards omit structured age ranges but keep Family / inferred markers (§1.1–1.5)', async ({ page }) => {
  const main = page.locator('main')
  await expect(main.getByText('Frisco Kids Program')).toBeVisible()
  // structured age ranges are gone from cards
  await expect(main.getByText(/^Ages \d/)).toHaveCount(0)
  // inferred family + bare inferred marker present
  await expect(main.getByText('~ Family ✦').first()).toBeVisible()
  await expect(main.getByText('✦', { exact: true }).first()).toBeVisible()
  // recurring badge shows full text on desktop (mobile collapses to an icon — see next test)
  await expect(main.getByText('Recurring').first()).toBeVisible()
})

test('Registration/Recurring badges: full text on desktop, icon-only on mobile', async ({ page }) => {
  const main = page.locator('main')
  // Desktop (default 1280px): the long labels render as full text
  await expect(main.getByText('Registration', { exact: true }).first()).toBeVisible()
  await expect(main.getByText('Recurring', { exact: true }).first()).toBeVisible()
  // Mobile: labels collapse to line-icons — text hidden, chip still present via its aria-label
  await page.setViewportSize({ width: 375, height: 800 })
  await expect(main.getByText('Registration', { exact: true }).first()).toBeHidden()
  await expect(main.getByText('Recurring', { exact: true }).first()).toBeHidden()
  await expect(main.getByLabel('Registration required').first()).toBeVisible()
  await expect(main.getByLabel('Recurring event').first()).toBeVisible()
})

test('inferred free Play Frisco event → "Free ✦" on card + ONE combined disclosure in detail (Def A)', async ({ page }) => {
  const main = page.locator('main')
  // Card shows the inferred-free marker
  await expect(main.getByText('Free ✦').first()).toBeVisible()
  // Detail shows the single combined age+price disclosure (never two lines)
  await main.getByText('Inferred Free Playtime').click()
  const detail = page.locator('aside')
  await expect(detail.getByText('Free ✦')).toBeVisible()
  await expect(detail.getByText("Family suitability and 'Free' admission status estimated from event description")).toBeVisible()
})

test('inferred PAID Play Frisco event → "Paid ✦" on card + combined paid disclosure (Def A)', async ({ page }) => {
  const main = page.locator('main')
  await expect(main.getByText('Paid ✦').first()).toBeVisible()
  await main.getByText('Ticketed Family Outing').click()
  const detail = page.locator('aside')
  await expect(detail.getByText('Paid ✦')).toBeVisible()
  await expect(detail.getByText("Family suitability and 'Paid' admission status estimated from event description")).toBeVisible()
})

test('Cost-field CONFIRMED free → plain "Free" (no ✦), price omitted from disclosure (Option A)', async ({ page }) => {
  const main = page.locator('main')
  await main.getByText('Cost Field Free Program').click()
  const detail = page.locator('aside')
  // Confirmed free reads "Free admission" with NO ✦ marker
  await expect(detail.getByText('Free admission')).toBeVisible()
  await expect(detail.getByText('Free ✦')).toHaveCount(0)
  // Age is still inferred → disclosure mentions age only, NOT price
  await expect(detail.getByText('Family suitability estimated from event description')).toBeVisible()
  await expect(detail.getByText(/admission status/)).toHaveCount(0)
})

test('detail shows ~ Family ✦ + disclosure, no "Family event"/"Suitable for" (§2.4)', async ({ page }) => {
  await page.locator('main').getByText('Play Family Day').click()
  const detail = page.locator('aside')
  await expect(detail.getByText('~ Family ✦')).toBeVisible()
  await expect(detail.getByText('Family suitability estimated from event description')).toBeVisible()
  await expect(detail.getByText('Family event')).toHaveCount(0)
  await expect(detail.getByText(/Suitable for/)).toHaveCount(0)
})

// --- §4 / §5  filters: multi-select, count badges, dropdowns -----------------

test('age dropdown multi-select shows count badge and sends OR params (§4.2, §5.5)', async ({ page }) => {
  await page.getByRole('button', { name: /Age range/ }).click()
  await page.getByRole('checkbox', { name: 'Toddlers (0–5)' }).check()
  await page.getByRole('checkbox', { name: 'Teens' }).check()
  // button shows the count badge "2"
  await expect(page.getByRole('button', { name: /Age range/ })).toContainText('2')
  // request carried both age ranges (OR)
  await expect.poll(() => lastEventsUrl).toContain('age=0-5')
  expect(lastEventsUrl).toContain('age=13-17')
})

test('"Clear filters" is hidden by default and appears only once a filter is active', async ({ page }) => {
  // Default state: the date window is default and nothing is selected → no Clear link.
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
  // The dedicated date row is present (From/to inputs — the anti-wrap layout).
  await expect(page.locator('main').getByText('From', { exact: true })).toBeVisible()
  // Applying an age filter makes the filter state non-default → Clear appears.
  await page.getByRole('button', { name: /Age range/ }).click()
  await page.getByRole('checkbox', { name: 'Teens' }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible()
  // Clicking it resets to default → Clear disappears again.
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
})

test('Plano tab shows branch dropdown, confirmed gold "Family" badge (§1.3, §5.2)', async ({ page }) => {
  await page.getByRole('tab', { name: /Plano City/ }).click()
  await expect(page.getByRole('button', { name: /Branches/ })).toBeVisible()
  const familyBadge = page.locator('main').getByText('Family', { exact: true }).first()
  await expect(familyBadge).toBeVisible()
  await expect(familyBadge).toHaveCSS('background-color', 'rgb(243, 237, 227)') // Weekend Paper fill-subtle #F3EDE3 (was gold #F5F0DE)
})

test('branch dropdown: one selected shows name, two show group + badge (§5.4, §5.5)', async ({ page }) => {
  await page.getByRole('tab', { name: /Plano City/ }).click()
  const branchBtn = page.getByRole('button', { name: /Branches/ })
  await branchBtn.click()
  await page.getByRole('checkbox', { name: 'Haggard' }).check()
  await expect(page.locator('button.rounded-full', { hasText: 'Haggard' })).toBeVisible()   // single → name
  await page.getByRole('checkbox', { name: 'Davis' }).check()
  await expect(page.getByRole('button', { name: /Branches/ })).toContainText('2') // two → count badge
})

// --- §3.2 (v1.0) per-city filter persistence --------------------------------

test('per-city filter state persists across tab switches', async ({ page }) => {
  await page.getByRole('tab', { name: /Plano City/ }).click()
  await page.getByRole('button', { name: /Branches/ }).click()
  await page.getByRole('checkbox', { name: 'Haggard' }).check()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: /Frisco City/ }).click()
  await page.getByRole('tab', { name: /Plano City/ }).click()
  // Haggard still selected after the round trip (scope to the dropdown pill, not a card)
  await expect(page.locator('button.rounded-full', { hasText: 'Haggard' })).toBeVisible()
})

// --- Failure states ---------------------------------------------------------
// These two exist to stop the error and empty states from silently collapsing back into one.
// They were one state until 2026-08-17: a 500 fell through to `data.events ?? []` and rendered
// "No events match your filters", blaming the user's filters for a backend outage. See the
// fallback table in GUARDRAILS.md.

test('backend failure says WE could not load — never blames the filters (§1.7)', async ({ page }) => {
  await page.route('**/api/venues*', r => r.fulfill({ json: { venues: [] } }))
  await page.route('**/api/branches*', r => r.fulfill({ json: { branches: BRANCHES } }))
  await page.route('**/api/events*', r => r.fulfill({ status: 500, json: { error: 'boom' } }))
  await page.goto('/')

  await expect(page.getByText(/couldn.t load events right now/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  // The filter message must NOT appear — that is the bug this test exists for.
  await expect(page.getByText('No events match your filters.')).toHaveCount(0)
  // And the spinner must not survive a failure.
  await expect(page.getByText(/loading events/i)).toHaveCount(0)
})

test('a genuine zero-result query still blames the filters, and offers Clear (§1.7)', async ({ page }) => {
  await page.route('**/api/venues*', r => r.fulfill({ json: { venues: [] } }))
  await page.route('**/api/branches*', r => r.fulfill({ json: { branches: BRANCHES } }))
  await page.route('**/api/events*', r => r.fulfill({ json: { events: [] } }))
  await page.goto('/')

  await expect(page.getByText('No events match your filters.')).toBeVisible()
  // The error copy must NOT appear for an empty-but-successful request.
  await expect(page.getByText(/couldn.t load events right now/i)).toHaveCount(0)
})

test('Try again recovers once the backend comes back (§1.7)', async ({ page }) => {
  await page.route('**/api/venues*', r => r.fulfill({ json: { venues: [] } }))
  await page.route('**/api/branches*', r => r.fulfill({ json: { branches: BRANCHES } }))
  let fail = true
  await page.route('**/api/events*', r =>
    fail ? r.fulfill({ status: 500, json: { error: 'boom' } }) : r.fulfill({ json: { events: FRISCO } }))
  await page.goto('/')

  await expect(page.getByText(/couldn.t load events right now/i)).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Frisco Kids Program')).toBeVisible()
})
