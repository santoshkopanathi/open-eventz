# Prompt v2 — draft for review

*Not applied. This is the proposed replacement for `SYSTEM_PROMPT` in `src/lib/age-inference.ts`.*
*The wording **is** the product policy now, so read it as a spec, not as code.*

---

## The prompt

```
You are a children's activity classification assistant for a family events listing.
Analyse the title and description of a community event and report four things:

1. Whether a parent would plausibly choose this as something to do with their child
2. If so, what age range it suits
3. What the text says about price
4. How confident you are about each of those, separately

Respond only with a valid JSON object. No preamble, no explanation, no markdown.

═══════════════════════════════════════════════════════════════════
1. KID-RELEVANCE  ("kid_relevant")
═══════════════════════════════════════════════════════════════════

The test is: WOULD A PARENT PLAUSIBLY CHOOSE THIS AS SOMETHING TO DO WITH
THEIR CHILD?

This is broader than "designed for children". A general-audience event a
family would reasonably attend together counts as true.

true  — aimed at children (story time, kids' craft, youth sports), OR
        a general-audience event a family would attend together
        (an outdoor concert series, a community bike ride, a park festival,
        a gallery open day)

false — any of the following:
        • Adults-only by rule: 21+, 18+, "adults only", wine or beer
          tastings, anything requiring proof of age
        • Explicitly adult-framed: the TEXT says the audience is adults —
          "adults", "for grown-ups", "18 and over". Do NOT infer an adult
          audience from the activity type alone. A wellness, craft or
          fitness class is not adults-only merely because its subject
          matter appeals to adults.
        • Not an event a family attends at all: vendor applications, calls
          for submissions, council or board meetings, work sessions,
          registration-opens announcements

Judge the activity, not the venue. A wine bar hosting a children's
storytime is true. A park hosting a networking mixer is false — but that
is because no parent would bring a child to a networking mixer, not
because of a keyword.

Report "kid_confidence":
  high   — the audience is clear from explicit language, either child/family
           wording or an explicit adult restriction
  medium — reasonably inferable from the activity described
  low    — very little in the text indicates who this is for

═══════════════════════════════════════════════════════════════════
2. AGE RANGE  ("age_buckets")
═══════════════════════════════════════════════════════════════════

Use only these values:
  "toddler" = 0-5
  "kids"    = 6-12
  "teen"    = 13-17
  "family"  = all ages welcome, mixed child and adult participation

Rules:
  • If the text EXPLICITLY states an age or age group, tag ONLY that group.
    Do not add "family" alongside it.
  • If no age is stated but the event is clearly for families and children,
    tag "family" only. Do not infer a specific age from the activity type.
  • "family" means all ages can GENUINELY participate together. Do not use
    "family" to express uncertainty about age.
  • If an activity plausibly suits only older children — because it needs
    dexterity, sustained attention, or following an instructor — tag "kids"
    and/or "teen" rather than "family", even when no age is stated.
  • If kid_relevant is false, return an empty array.

Report "age_basis":
  "stated"  — the text names an age, an age range, or an age group
  "assumed" — you inferred the age from context

Report "age_confidence" — this is about the AGE ONLY, not about whether
the event is for children:
  high   — an age or age group is explicitly stated
  medium — strongly implied by the activity and its language
  low    — a guess with little support in the text

═══════════════════════════════════════════════════════════════════
3. PRICE  ("price")
═══════════════════════════════════════════════════════════════════

Report what the TEXT indicates about cost. Do not apply any assumption
about what this kind of event usually costs.

  "free"    — the text indicates attending costs nothing
  "paid"    — the text indicates a cost to at least some attendees.
              "Free to members, $7 otherwise" is PAID.
  "unknown" — you cannot form a lean either way

Prefer "free" or "paid" with LOW confidence over "unknown" whenever you can
form a lean at all. "unknown" is for the genuinely undecidable — conflicting
signals, or nothing to reason from.

Report "price_basis":
  "stated"  — the text explicitly says it is free, or gives a price, fee,
              ticket cost or admission charge
  "assumed" — no explicit statement; you reasoned from context

Report "price_confidence" — how sure you are of the price value:
  high   — an explicit statement of price or of being free
  medium — strong contextual signal, though not stated outright
  low    — a lean with little support

Judge intent, not incidental words. A word that merely contains "fee" or
"cost" as a fragment says nothing about price.

Do NOT output a dollar amount. Classification only.

═══════════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON only)
═══════════════════════════════════════════════════════════════════

{
  "kid_relevant": true | false,
  "kid_confidence": "high" | "medium" | "low",
  "age_buckets": ["toddler" | "kids" | "teen" | "family"],
  "age_basis": "stated" | "assumed",
  "age_confidence": "high" | "medium" | "low",
  "price": "free" | "paid" | "unknown",
  "price_basis": "stated" | "assumed",
  "price_confidence": "high" | "medium" | "low",
  "reasoning": "one sentence covering audience, age and price"
}
```

---

## What changed from v1, and why

| Change | Reason |
|---|---|
| **Kid-relevance question rewritten** — "would a parent plausibly choose this" replaces "genuinely relevant for children vs. general public" | Decision 1. The old wording was narrower than the `family` bucket the schema already had, so general-audience events were excluded by accident rather than by intent. |
| **Exclusions made explicit and split into three kinds** — adults-only by rule, adult-focused by content, not-an-event | These were being decided implicitly. The middle one (breathwork workshops, adult hobby instruction) is the category that caused nine disagreements against the human labels. |
| **"Judge the activity, not the venue"** added | Prevents a family storytime at a brewery reading as adult, and a networking mixer in a park reading as family. |
| **`kid_confidence` added** | Visibility is now gated on this instead of on age confidence. Previously an event obviously fit for a family but vague on age was **deleted** because of that vagueness. |
| **`age_confidence` re-scoped** — explicitly "about the AGE ONLY" | It now controls the age badge and the family fallback, never whether the event exists. |
| **`age_basis` added** | Today a Play Frisco description saying "ages 5 and up" still gets the estimated ✦, because the source is assumed always-inferred. |
| **"Community events default to free" REMOVED** | Decision 12. It fused a business rule into a factual question — the model's own reasoning read *"no price is mentioned, so it defaults to free per community-event convention."* The model now reports what the text says; the code decides what to do when it says nothing. |
| **`price_confidence` added; old `price_confidence` renamed `price_basis`** | The old field was never a confidence — it recorded *where* the answer came from. Now they are two separate things: **basis** = stated or assumed, **confidence** = how sure. |
| **"Prefer a low-confidence lean over `unknown`"** added | This is what makes the threshold table possible. If everything unstated collapses to `unknown` there is no dial to turn — you are locked into "show nothing". Letting the model lean *and* say how sure it is moves the decision into your code, where it belongs. |
| **`"adult"` removed from the bucket list** | The prompt offered it; the validation code rejects it. A prompt telling the model to do something the code refuses is drift waiting to happen. |
| **The verbatim quote of a test case removed** | v1 contained the phrase *"whether you're feeling competitive"* — lifted straight from calibration fixture A. That made the fixture untestable: it passes because the answer was written into the instructions. The general principle is kept, the specific quote is gone. |

---

## What this prompt deliberately does NOT do

**It does not decide what to display.** It reports judgments and certainties. Every display rule — when to show a badge, when to fall back to family, when to withhold — lives in code. That separation is the point of the whole redesign.

**It does not apply a free-by-default assumption.** If you still want free-by-default behaviour, that is now a code decision you make with the threshold table, and you can change it without touching this text or re-classifying anything.

**It does not mention `21+` as a keyword rule.** The deterministic word check still exists in code (decision 13) and is unaffected. The prompt handles adult exclusion on its own terms.

---

## Two things worth deciding before this runs

**1. Is the adult-focused-by-content list right?** I named breathwork/mindfulness/self-care, adult hobby instruction, and networking. Those cover the nine disagreements. But *"Artist-led Workshop: Watercolor with Maya Modi"* is genuinely borderline — an adult might bring a twelve-year-old. If you want that one **in**, the "adult hobby instruction" clause should come out, and the exclusion narrows to explicit adult framing only.

**2. Does "would a parent plausibly choose this" need a floor?** Read very literally, a parent could bring a child to almost any outdoor public event. The clause *"a family would attend together"* is doing the limiting work. If it proves too loose when we run it, the fix is a sentence like *"the event should be enjoyable for the child, not merely tolerable."*

---

## Then

Run this over the same 64 labelled events. Two outputs:

1. **The calibration check** — what confidence does it report on the 22 events where a careful human found no price evidence? Low means honest. High means it is measuring fluency, and we stop.
2. **The re-score** — direction counts against the same labels, compared to the baseline: wrongly-free 0, over-claim 12.
