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
    ingested_at: '', created_at: '',
    ...over,
  }
}

const BRANCHES = ['Davis Library', 'Haggard Library', 'Harrington Library', 'Parr Library', 'Schimelpfenig Library', 'Virtual']

const FRISCO = [
  ev({ id: 'f1', source: 'frisco-library', title: 'Frisco Kids Program', age_min: 6, age_max: 12 }),         // structured → NO card badge
  ev({ id: 'p1', source: 'play-frisco', title: 'Play Family Day', kid_relevant: true, age_confidence: 'high', age_buckets: ['family'] }), // ~ Family ✦
  ev({ id: 'p2', source: 'play-frisco', title: 'Teen Art Workshop', kid_relevant: true, age_confidence: 'high', age_buckets: ['teen'] }), // ✦
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
  // recurring badge present
  await expect(main.getByText('↻ Recurring').first()).toBeVisible()
})

test('detail shows ~ Family ✦ + disclosure, no "Family event"/"Suitable for" (§2.4)', async ({ page }) => {
  await page.locator('main').getByText('Play Family Day').click()
  const detail = page.locator('aside')
  await expect(detail.getByText('~ Family ✦')).toBeVisible()
  await expect(detail.getByText(/estimated from event description/i)).toBeVisible()
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

test('Plano tab shows branch dropdown, confirmed gold "Family" badge (§1.3, §5.2)', async ({ page }) => {
  await page.getByRole('tab', { name: /Plano City/ }).click()
  await expect(page.getByRole('button', { name: /Branches/ })).toBeVisible()
  const familyBadge = page.locator('main').getByText('Family', { exact: true }).first()
  await expect(familyBadge).toBeVisible()
  await expect(familyBadge).toHaveCSS('background-color', 'rgb(245, 240, 222)') // gold #F5F0DE
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
