import type { PriceClass } from '../types'

/**
 * Ground-truth price calibration set (v1.2 spec, Layer 6). Human-labeled real
 * Play Frisco descriptions. Single source of truth, consumed by BOTH tiers:
 *   - Tier 1 (automatic): price.test.ts asserts the deterministic fallback pipeline
 *     (fallbackPriceClass) resolves each case to `expected`. Runs in CI, costs nothing.
 *   - Tier 2 (manual): `npm run calibrate:price` runs the real LLM against these and
 *     prints a pass/fail table. Run when the prompt or model changes.
 *
 * GROWING SET: every time a wrong label is caught in production — especially a wrong
 * "free" — add that event's description and correct answer here so the failure mode is
 * locked in as a regression.
 */
export interface PriceCalibrationCase {
  id: string
  title: string
  description: string
  registration_required: boolean
  expected: PriceClass
  note: string
}

export const PRICE_CALIBRATION: PriceCalibrationCase[] = [
  {
    id: 'A-history-of-play',
    title: 'History of Play 2026',
    description:
      'Get ready to play your way through history! Jump into the fun as you explore games, ' +
      'toys, and activities from different time periods, no time machine required. Challenge ' +
      'your friends to old-school games, get creative with hands-on crafts, and discover how ' +
      "people have had fun throughout the years. Whether you're feeling competitive, crafty, " +
      'or just curious, this event is all about laughing, learning, and making playful memories together!',
    registration_required: false,
    expected: 'free',
    note: 'No price mentioned; drop-in activity; "feeling competitive" contains "fee" but means nothing about price. Free-by-default; Layers 2/3 do not fire.',
  },
  {
    id: 'B-fun-float-night',
    title: 'Fun Float Night',
    description:
      'Have some late night fun at the Water Park with us! We will have fun floats in the water ' +
      "and don't forget to bring your own for an extra splash of fun. We will have a live DJ, " +
      'snacks, and activities for all. EVENT COST: Event is free to members and Splash Pass ' +
      'holders. Event only attendees - $7 youth/$9 adult',
    registration_required: false,
    expected: 'paid',
    note: 'Explicit price ($7/$9) for non-members. Confirmed paid — not fooled by "free to members".',
  },
  {
    id: 'C-walnut-wednesdays',
    title: 'Walnut Wednesdays',
    description:
      'Walnut Wednesdays. 10 to 11 a.m., Weekly, June 17 through August 5. In The Depot at ' +
      'Frisco Heritage Center. Your weekly dose of hands-on fun! With engaging activities and ' +
      'playful learning, families can drop by, explore, and make new memories every week this summer.',
    registration_required: false,
    expected: 'free',
    note: 'No price mentioned; drop-in weekly family program; no structurally-paid keywords. Free-by-default.',
  },
  {
    id: 'D-wands-wizards-cookies',
    title: 'Heritage How-To: Wands, Wizards, & Cookies',
    description:
      'Step into the wizarding world and discover the magic of cookie decorating. In this fun, ' +
      'hands-on class, participants will create enchanting cookie designs. All supplies are ' +
      'included, and each participant will take home their creations. Each participant must have ' +
      'a purchased ticket. No refunds unless class is cancelled.',
    registration_required: true,
    expected: 'paid',
    note: 'Explicit paid signal ("purchased ticket"); also triggers Layer 2 ("class") and Layer 3 (registration required).',
  },
  {
    id: 'E-play-night-at-discovery',
    title: 'Play Night at Discovery',
    description:
      'Play Night at Discovery returns on July 31, which means FREE ADMISSION TO OUR MUSEUMS! ' +
      'Enjoy full access after-hours to the Frisco Discovery Center and our three partner museums. ' +
      'Play Night at Discovery is open to everyone.',
    registration_required: false,
    expected: 'free',
    note: 'Explicit "FREE ADMISSION" in the description → confirmed free. (Page also has a structured Cost: Free field, not yet scraped.)',
  },
  {
    id: 'F-wizards-birthday-party',
    title: "A Wizard's Birthday Party",
    description:
      'Step into the world of magic and celebrate a famous wizard. As the movie plays, cozy up with ' +
      'treats. Costumes are encouraged. Each person must purchase a ticket. No refunds unless event ' +
      'is cancelled. BUY TICKETS HERE.',
    registration_required: false,
    expected: 'paid',
    note: '"BUY TICKETS" + "No refunds" → paid (both caught by parser and LLM).',
  },
  {
    id: 'G-so-long-sweet-summer',
    title: 'So Long Sweet Summer',
    description:
      'Say goodbye to summer with one last splash at the Frisco Water Park. Float with inflatables, ' +
      'enjoy snacks and live music. Cost: Free for FAC Members and Splash Pass holders. Event pass: ' +
      '$7 youth, $9 adults.',
    registration_required: false,
    expected: 'paid',
    note: 'Member-gated pricing — a stated "$7 youth / $9 adults" for the general public → paid, not fooled by "Free for members" (paid is checked first). Same shape as Fun Float Night.',
  },
]

/**
 * KNOWN GAPS — real events the current pipeline mislabels. Each records the human ground
 * truth (`expected`), what `fallbackPriceClass` returns TODAY (`currentDeterministic`), whether
 * the LLM already gets it right, and the fix that will close the gap. The test asserts the
 * CURRENT behavior so CI stays green; when a fix lands, move the case up into PRICE_CALIBRATION
 * (it should then satisfy `expected`).
 */
export interface PriceCalibrationGap extends PriceCalibrationCase {
  currentDeterministic: PriceClass
  llmCorrect: boolean
  fix: string
}

export const PRICE_CALIBRATION_KNOWN_GAPS: PriceCalibrationGap[] = [
  {
    id: 'GAP-learn-to-fish',
    title: 'Learn to Fish',
    description:
      'Ready to try fishing for the first time? This beginner-friendly workshop is a great place to ' +
      'start. Learn the essentials — rods and reels, basic knot tying, fish habitats. Open to ages 5 ' +
      'and up with an accompanying adult. All equipment is provided. The class will be held indoors ' +
      'at the Frisco Heritage Center. Registration is required.',
    registration_required: true,
    expected: 'free',            // page shows a structured "Cost: Free"
    currentDeterministic: 'unknown',
    llmCorrect: false,           // description alone → free-by-default → Layers 2/3 → unknown
    fix: 'RESOLVED at ingest by the structured Cost: field. `interpretCostField("Free") → free` (confirmed), which overrides the description pipeline. This fixture still asserts the DESCRIPTION-only result (unknown), which is correct in isolation — no price words + "workshop"/"class" (Layer 2) + registration (Layer 3).',
    note: 'From the description alone this is genuinely unknown; the authoritative Cost:Free field (now scraped) makes it confirmed free with no ✦.',
  },
  {
    id: 'GAP-sensory-swim',
    title: 'Play For All Sensory Swim',
    description:
      'As part of our Play For All initiative, the Frisco Water Park will open early with a limited ' +
      'capacity of 250 guests and no background music, a more sensory-friendly atmosphere. We will ' +
      'have saddles for Lazy River tubes and sensory kits. Ticket available now!',
    registration_required: false,
    expected: 'paid',
    currentDeterministic: 'free', // parser blind spot → free-by-default (kept by design)
    llmCorrect: true,             // LLM reads "Ticket available now" as paid
    fix: 'Documented gap BY CHOICE (Option 2): the keyword set adds only unambiguous phrases ("purchase a ticket", "tickets on sale") and deliberately excludes "ticket available", which could false-positive on a free ticketed event. The LLM classifies this paid; a Cost field (if present) would also catch it.',
    note: 'Paid (water-park ticketed event). The LLM catches "Ticket available now"; the keyword fallback intentionally does not, to avoid flagging free ticketed events.',
  },
]

