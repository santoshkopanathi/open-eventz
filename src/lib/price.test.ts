import {
  detectPriceSignal,
  hasStructurallyPaidKeyword,
  resolvePriceClass,
  fallbackPriceClass,
  signalToRawPrice,
  interpretCostField,
  priceClassToFields,
  getPriceBadge,
  cardPriceBadge,
  detailPriceBadge,
} from './price'
import { ESTIMATED_TOOLTIP } from './age-badge'
import { PRICE_CALIBRATION, PRICE_CALIBRATION_KNOWN_GAPS } from './__fixtures__/price-calibration'

// ---------------------------------------------------------------------------
// detectPriceSignal — keyword signal detection (fallback parser)
// ---------------------------------------------------------------------------

describe('detectPriceSignal', () => {
  // The false-positive class that motivated v1.2: substrings must not trip paid detection.
  const notPaid = [
    ['"feeling" contains "fee"', 'Come see whether you are feeling competitive this weekend.'],
    ['"coffee" contains "fee"', 'Enjoy coffee and conversation in the community room.'],
    ['"feedback" contains "fee"', 'We welcome your feedback after the session.'],
    ['"costume" contains "cost"', 'Wear your best costume for the parade.'],
    ['"at no cost" — cost without a number', 'Join us at no cost to explore the trails.'],
  ] as const
  test.each(notPaid)('not a paid signal: %s', (_label, text) => {
    expect(detectPriceSignal(text)).not.toBe('paid')
  })

  const paid = [
    ['dollar amount', 'Tickets are $95 per family.'],
    ['cost: with number', 'Cost: $10 at the door.'],
    ['buy tickets', 'Buy tickets online before it sells out.'],
    ['whole-word fee', 'A small fee applies for materials.'],
    ['purchased ticket', 'Each participant must have a purchased ticket.'],
    ['no refund', 'All sales final, no refund after purchase.'],
    ['per child', 'The rate is billed per child.'],
  ] as const
  test.each(paid)('paid: %s', (_label, text) => {
    expect(detectPriceSignal(text)).toBe('paid')
  })

  const free = [
    ['free admission', 'Free admission for the whole family.'],
    ['no cost', 'This program is offered at no cost.'],
    ['free to attend', 'The event is free to attend.'],
  ] as const
  test.each(free)('explicit free: %s', (_label, text) => {
    expect(detectPriceSignal(text)).toBe('free')
  })

  test('paid wins over "free to members" when a real cost is stated', () => {
    expect(detectPriceSignal('Free to members. Non-members $7 youth/$9 adult.')).toBe('paid')
  })

  const ambiguous = [
    ['tickets at the gate', 'Grab your wristband at the gate on arrival.'],
    ['members only', 'This is a members only preview night.'],
    ['reservation required', 'Reservation required to attend.'],
    ['donations welcome', 'Donations welcome but not required.'],
  ] as const
  test.each(ambiguous)('ambiguous: %s', (_label, text) => {
    expect(detectPriceSignal(text)).toBe('ambiguous')
  })

  test('no signal at all → none', () => {
    expect(detectPriceSignal('A story time in the park with local authors.')).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Layer 2 — structurally-paid keyword detection (whole-word)
// ---------------------------------------------------------------------------

describe('hasStructurallyPaidKeyword', () => {
  test.each(['Cookie Decorating Class', 'Summer Soccer Camp', 'Art Workshop', 'Tennis Clinic', 'Youth League', 'Chess Tournament', 'Swim Lessons'])(
    'flags structurally-paid type: %s',
    title => expect(hasStructurallyPaidKeyword(title)).toBe(true)
  )

  test.each(['Classic Car Show', 'Classroom Storytime', 'Camping Photos Display', 'History of Play', 'Walnut Wednesdays'])(
    'does NOT flag on substrings/unrelated: %s',
    title => expect(hasStructurallyPaidKeyword(title)).toBe(false)
  )
})

// ---------------------------------------------------------------------------
// resolvePriceClass — Layers 2 & 3 (downgrade inferred-free → unknown)
// ---------------------------------------------------------------------------

describe('resolvePriceClass', () => {
  const base = { title: 'Family Fun', description: 'A drop-in event.', registration_required: false }

  test('inferred free with no risk signals stays free', () => {
    expect(resolvePriceClass({ price: 'free', price_confidence: 'inferred', ...base })).toEqual({
      price_class: 'free',
      price_confidence: 'inferred',
      decided_by: 'model',
    })
  })

  test('Layer 2: inferred free + structurally-paid keyword → unknown', () => {
    expect(
      resolvePriceClass({ price: 'free', price_confidence: 'inferred', title: 'Cookie Class', description: 'Fun class.', registration_required: false })
    ).toEqual({ price_class: 'unknown', price_confidence: 'inferred', decided_by: 'rule-keyword' })
  })

  test('Layer 3: inferred free + registration_required → unknown', () => {
    expect(
      resolvePriceClass({ price: 'free', price_confidence: 'inferred', title: 'Mystery Event', description: 'Come join us.', registration_required: true })
    ).toEqual({ price_class: 'unknown', price_confidence: 'inferred', decided_by: 'rule-registration' })
  })

  test('explicit free (confirmed) overrides Layer 2 keyword suspicion', () => {
    expect(
      resolvePriceClass({ price: 'free', price_confidence: 'confirmed', title: 'Free Summer Camp', description: 'No cost to attend.', registration_required: true })
    ).toEqual({ price_class: 'free', price_confidence: 'confirmed', decided_by: 'model' })
  })

  test('paid is never downgraded', () => {
    expect(
      resolvePriceClass({ price: 'paid', price_confidence: 'confirmed', title: 'Cookie Class', description: 'Buy tickets.', registration_required: true })
    ).toEqual({ price_class: 'paid', price_confidence: 'confirmed', decided_by: 'model' })
  })
})

// ---------------------------------------------------------------------------
// Layer 1.5 — the CONFIRMED guard. "confirmed" drops the ✦ and the "estimated from event
// description" line, so it must be earned from the text, not claimed by the model.
// ---------------------------------------------------------------------------

describe('resolvePriceClass — the confirmed guard', () => {
  test('downgrades a claimed "confirmed" when the text states no price', () => {
    // The real case: Frosty 5K came back paid/confirmed on text with no price, fee or ticket
    // wording, reasoned from "an organized 5K with a sign-up link implies an entry fee". A
    // sound inference; not a confirmation. Without this guard a parent saw a plain "Paid".
    expect(
      resolvePriceClass({
        price: 'paid',
        price_confidence: 'confirmed',
        title: 'Frosty 5K',
        description: 'A festive fun run for all ages. Visit the Frosty 5K website to sign up.',
        registration_required: false,
      })
    ).toEqual({ price_class: 'paid', price_confidence: 'inferred', decided_by: 'model' })
  })

  test('the dangerous direction: a claimed-confirmed FREE keeps its marker', () => {
    // An unmarked "Free admission" on an event we only assumed was free is the single failure
    // this pipeline exists to prevent.
    const r = resolvePriceClass({
      price: 'free',
      price_confidence: 'confirmed',
      title: 'Community Parade',
      description: 'A parade through downtown with music.',
      registration_required: false,
    })
    expect(r.price_confidence).toBe('inferred')
    expect(r.price_class).toBe('free')
  })

  test('leaves a genuinely confirmed price alone — paid', () => {
    expect(
      resolvePriceClass({
        price: 'paid', price_confidence: 'confirmed',
        title: 'Princess Tea', description: 'Tickets are $25 per child.', registration_required: true,
      }).price_confidence
    ).toBe('confirmed')
  })

  test('leaves a genuinely confirmed price alone — free', () => {
    expect(
      resolvePriceClass({
        price: 'free', price_confidence: 'confirmed',
        title: 'Diwali', description: 'Free admission for all.', registration_required: true,
      }).price_confidence
    ).toBe('confirmed')
  })

  test('never UPGRADES an inferred claim to confirmed, even with explicit text', () => {
    // One-directional on purpose. A model that under-states its confidence keeps its ✦, which
    // is the safe direction to be wrong in.
    expect(
      resolvePriceClass({
        price: 'paid', price_confidence: 'inferred',
        title: 'Workshop', description: 'Tickets are $25.', registration_required: false,
      }).price_confidence
    ).toBe('inferred')
  })

  test('does NOT veto a confirmation the model made from unusual phrasing', () => {
    // The limit of the guard, asserted on purpose. "our FREE community music series" is not a
    // phrase the fallback detector recognises, but it plainly states a price and the model
    // reads it correctly. An earlier version of this guard deferred to that detector and
    // stripped the confirmation from six such events — over-hedging, which is not free: if
    // everything wears the ✦, the ✦ stops meaning anything.
    expect(
      resolvePriceClass({
        price: 'free', price_confidence: 'confirmed',
        title: 'Live After 5',
        description: 'We make your evening plans easy with our FREE community music series.',
        registration_required: true,
      }).price_confidence
    ).toBe('confirmed')
  })

  test('the guard is a floor, not a judge — ambiguous money wording still passes', () => {
    // "Donations welcome" mentions money, so a confirmed claim survives. The guard asks only
    // "could this text support a confirmation at all", never "is the model right". Catching a
    // bad confirmation made from weak wording is the model's job and the eval's, not a
    // regex's — a stricter rule here is what broke the six events above.
    expect(
      resolvePriceClass({
        price: 'free', price_confidence: 'confirmed',
        title: 'Gallery Night', description: 'Donations welcome at the door.', registration_required: false,
      }).price_confidence
    ).toBe('confirmed')
  })

  test('vetoes only on total silence about money', () => {
    expect(
      resolvePriceClass({
        price: 'paid', price_confidence: 'confirmed',
        title: 'Community Walk', description: 'Join us for a stroll through the park at 10am.',
        registration_required: false,
      }).price_confidence
    ).toBe('inferred')
  })
})

// ---------------------------------------------------------------------------
// decided_by — which layer settled the price. Stored so that "unknown" can be told apart
// from "unknown", since model abstention and a deterministic override need opposite fixes.
// ---------------------------------------------------------------------------

describe('resolvePriceClass — decided_by attribution', () => {
  test('model, when its answer stands', () => {
    expect(resolvePriceClass({
      price: 'free', price_confidence: 'inferred',
      title: 'Story Time', description: 'Come along.', registration_required: false,
    }).decided_by).toBe('model')
  })

  test('rule-keyword, when Layer 2 overrode an inferred free', () => {
    expect(resolvePriceClass({
      price: 'free', price_confidence: 'inferred',
      title: 'Pottery Workshop', description: 'Come along.', registration_required: false,
    }).decided_by).toBe('rule-keyword')
  })

  test('rule-registration, when Layer 3 overrode an inferred free', () => {
    expect(resolvePriceClass({
      price: 'free', price_confidence: 'inferred',
      title: 'Community Parade', description: 'Come along.', registration_required: true,
    }).decided_by).toBe('rule-registration')
  })

  test('keyword is attributed before registration when both apply', () => {
    // Both would downgrade; the attribution records the first rule that fired, so a fix can
    // be aimed at the right one rather than at whichever is guessed.
    expect(resolvePriceClass({
      price: 'free', price_confidence: 'inferred',
      title: 'Pottery Workshop', description: 'Come along.', registration_required: true,
    }).decided_by).toBe('rule-keyword')
  })

  test('a model "unknown" is attributed to the model, not to a rule', () => {
    // This is the distinction the column exists for: both end as unknown, and they need
    // opposite fixes — a prompt change versus a threshold change.
    expect(resolvePriceClass({
      price: 'unknown', price_confidence: 'inferred',
      title: 'Pottery Workshop', description: 'Come along.', registration_required: true,
    }).decided_by).toBe('model')
  })
})

// ---------------------------------------------------------------------------
// priceClassToFields — derived display fields (Layer 5)
// ---------------------------------------------------------------------------

describe('priceClassToFields', () => {
  test('free → is_free true', () => expect(priceClassToFields('free')).toEqual({ is_free: true, price_text: 'Free' }))
  test('paid → is_free false', () => expect(priceClassToFields('paid')).toEqual({ is_free: false, price_text: 'Paid' }))
  test('unknown → null', () => expect(priceClassToFields('unknown')).toEqual({ is_free: null, price_text: null }))
})

describe('signalToRawPrice', () => {
  test('none → inferred free (the default)', () => expect(signalToRawPrice('none')).toEqual({ price: 'free', price_confidence: 'inferred' }))
  test('ambiguous → inferred unknown', () => expect(signalToRawPrice('ambiguous')).toEqual({ price: 'unknown', price_confidence: 'inferred' }))
  test('free → confirmed free', () => expect(signalToRawPrice('free')).toEqual({ price: 'free', price_confidence: 'confirmed' }))
  test('paid → confirmed paid', () => expect(signalToRawPrice('paid')).toEqual({ price: 'paid', price_confidence: 'confirmed' }))
})

// ---------------------------------------------------------------------------
// interpretCostField — the authoritative structured Cost: value
// ---------------------------------------------------------------------------

describe('interpretCostField', () => {
  test.each(['Free', 'FREE', 'Free admission', 'free with registration'])('"%s" → free', v =>
    expect(interpretCostField(v)).toBe('free'))
  test.each(['$35', '$7', '$7 youth / $9 adults', 'Paid', 'PAID', '$10 fee'])('"%s" → paid', v =>
    expect(interpretCostField(v)).toBe('paid'))
  test.each([null, undefined, '', '   ', 'See website', 'Varies'])('%p → null (no signal)', v =>
    expect(interpretCostField(v as string)).toBeNull())
})

// ---------------------------------------------------------------------------
// Layer 4 — getPriceBadge / card / detail. Play Frisco price wears the ✦ only when
// INFERRED; a Cost-field-confirmed price (price_confidence='confirmed') gets no ✦ (Option A).
// ---------------------------------------------------------------------------

describe('getPriceBadge', () => {
  test('Play Frisco inferred free → free-inferred (✦)', () => {
    expect(getPriceBadge({ source: 'play-frisco', price_class: 'free', price_confidence: 'inferred', is_free: true }))
      .toMatchObject({ kind: 'free-inferred', label: 'Free', inferred: true })
  })
  test('Play Frisco inferred paid → paid-inferred (✦)', () => {
    expect(getPriceBadge({ source: 'play-frisco', price_class: 'paid', price_confidence: 'inferred', is_free: false }))
      .toMatchObject({ kind: 'paid-inferred', label: 'Paid', inferred: true })
  })
  test('Play Frisco CONFIRMED free (Cost field) → free-confirmed, NO ✦', () => {
    expect(getPriceBadge({ source: 'play-frisco', price_class: 'free', price_confidence: 'confirmed', is_free: true }))
      .toMatchObject({ kind: 'free-confirmed', label: 'Free', inferred: false })
  })
  test('Play Frisco CONFIRMED paid (Cost field) → paid-confirmed, NO ✦', () => {
    expect(getPriceBadge({ source: 'play-frisco', price_class: 'paid', price_confidence: 'confirmed', is_free: false }))
      .toMatchObject({ kind: 'paid-confirmed', label: 'Paid', inferred: false })
  })
  test('Play Frisco unknown → null (no badge)', () => {
    expect(getPriceBadge({ source: 'play-frisco', price_class: 'unknown', price_confidence: 'inferred', is_free: null })).toBeNull()
  })
  test('Play Frisco not-yet-classified (price_class null) → null', () => {
    expect(getPriceBadge({ source: 'play-frisco', price_class: null, price_confidence: null, is_free: true })).toBeNull()
  })
  test('library free → free-confirmed, no ✦', () => {
    expect(getPriceBadge({ source: 'frisco-library', price_class: null, price_confidence: null, is_free: true }))
      .toMatchObject({ kind: 'free-confirmed', inferred: false })
  })
  test('library with null is_free → null', () => {
    expect(getPriceBadge({ source: 'frisco-library', price_class: null, price_confidence: null, is_free: null })).toBeNull()
  })
})

describe('cardPriceBadge / detailPriceBadge rendering', () => {
  const pfInferredFree = { source: 'play-frisco' as const, price_class: 'free' as const, price_confidence: 'inferred' as const, is_free: true }
  const pfInferredPaid = { source: 'play-frisco' as const, price_class: 'paid' as const, price_confidence: 'inferred' as const, is_free: false }
  const pfConfirmedFree = { source: 'play-frisco' as const, price_class: 'free' as const, price_confidence: 'confirmed' as const, is_free: true }
  const pfConfirmedPaid = { source: 'play-frisco' as const, price_class: 'paid' as const, price_confidence: 'confirmed' as const, is_free: false }
  const libFree = { source: 'frisco-library' as const, price_class: null, price_confidence: null, is_free: true }

  test('card: inferred free → "Free ✦" with tooltip', () => {
    const r = cardPriceBadge(pfInferredFree)
    expect(r?.content).toBe('Free ✦')
    expect(r?.tooltip).toBe(ESTIMATED_TOOLTIP)
  })
  test('card: inferred paid → "Paid ✦"', () => {
    expect(cardPriceBadge(pfInferredPaid)?.content).toBe('Paid ✦')
  })
  test('card: CONFIRMED free (Cost field) → plain "Free", no ✦/tooltip', () => {
    const r = cardPriceBadge(pfConfirmedFree)
    expect(r?.content).toBe('Free')
    expect(r?.tooltip).toBeUndefined()
  })
  test('card: CONFIRMED paid (Cost field) → plain "Paid", no ✦', () => {
    expect(cardPriceBadge(pfConfirmedPaid)?.content).toBe('Paid')
  })
  test('detail: inferred free → "Free ✦"', () => {
    expect(detailPriceBadge(pfInferredFree)?.content).toBe('Free ✦')
  })
  test('detail: CONFIRMED free → "Free admission" (no ✦)', () => {
    expect(detailPriceBadge(pfConfirmedFree)?.content).toBe('Free admission')
  })
  test('detail: library free → "Free admission"', () => {
    expect(detailPriceBadge(libFree)?.content).toBe('Free admission')
  })
})

// ---------------------------------------------------------------------------
// Layer 6 Tier 1 — calibration set, deterministic (no-LLM) pipeline
// ---------------------------------------------------------------------------

describe('price calibration set — deterministic fallback pipeline', () => {
  test.each(PRICE_CALIBRATION.map(c => [c.id, c] as const))('%s resolves to its ground-truth class', (_id, c) => {
    const resolved = fallbackPriceClass({
      title: c.title,
      description: c.description,
      registration_required: c.registration_required,
    })
    expect(resolved.price_class).toBe(c.expected)
  })
})

// Documented gaps: assert TODAY's (wrong) deterministic output so CI stays green and the miss
// is recorded. When a fix lands, the case moves into PRICE_CALIBRATION and must satisfy `expected`.
describe('price calibration — KNOWN GAPS (documented, awaiting a fix)', () => {
  test.each(PRICE_CALIBRATION_KNOWN_GAPS.map(c => [c.id, c] as const))(
    '%s currently mislabels (records current behavior, not ground truth)',
    (_id, c) => {
      const resolved = fallbackPriceClass({
        title: c.title,
        description: c.description,
        registration_required: c.registration_required,
      })
      expect(resolved.price_class).toBe(c.currentDeterministic)
      // Guardrail: these are genuine gaps — current output must differ from ground truth.
      expect(c.currentDeterministic).not.toBe(c.expected)
    }
  )
})
