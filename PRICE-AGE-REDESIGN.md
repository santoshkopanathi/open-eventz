# Price & age classification — the agreed redesign

*Status: **designed, not built**. Design dated 2026-08-23; first eval run 2026-08-31.*
*Run 1 did NOT pass — the prompt is being iterated. See `eval/RUN-LOG.md` before acting on anything below.*
*Companion to `EVALS.md` (how we measured) and `GUARDRAILS.md` (the runtime controls).*

**Read this if:** you are picking this work up cold, or coming back to it in three months.
Every term is defined where it first appears. Nothing assumes you remember the conversation.

---

# 0. Terminology — read this first

**"Price" is never displayed.** The product shows a three-state **badge**: **Free**, **Paid**, or
**nothing at all**. Even when a page says `Cost: $25`, we store and show **Paid** — the amount is
discarded, and the model is explicitly told not to return one. Anywhere this document says
"withholding", it means *showing no badge*, never *hiding an amount*.

**The ✦ marker** is a small star on a badge meaning *"we worked this out from the description,
the source didn't state it."* Hovering it on desktop shows "Estimated from description". Price
already uses it (`Free ✦`); age used to prefix a tilde as well (`~ Family ✦`) — **that tilde is
being removed** so the two are consistent.

**"The prompt"** is a block of instructions, about 50 lines, stored in
`src/lib/age-inference.ts` and sent to Claude ahead of every event. It is exactly what you would
type into a chat, written once and reused. "Changing the prompt" means editing that text.

**"Deterministic"** means code that gives the same answer every time for the same input — a
lookup or a rule. As opposed to the model, which forms a judgment.

**The two sources this applies to** are Play Frisco and Kaleidoscope Park. The two library
sources publish structured age data and are free by institutional default; they never enter this
pipeline.

---

# 1. What the system does today

## Price, in six steps

| # | Step | Deterministic? | Reaches a user? |
|---|---|---|---|
| 1 | Scrape the structured `Cost:` field from the event page and interpret it | **yes** | yes — and it wins outright |
| 2 | Compute a keyword-based price as a placeholder | **yes** | **no** — see below |
| 3 | The model reads title + description → free / paid / unknown | no | yes |
| 4 | Downgrade an "assumed free" if the text has one of 12 words, or registration is required | **yes** | yes |
| 5 | Store `is_free` and `price_text` | yes (mechanical) | partly |
| 6 | Decide the badge and whether it wears a ✦ | yes (mechanical) | yes |

**Step 2 needs explaining, because it looks important and isn't.** At scrape time, before the
model runs, ~30 keyword rules compute a price and store it as a placeholder. If the model
answers, that placeholder is overwritten. If the model *fails*, the event is marked
not-kid-relevant and **hidden** — so the placeholder is attached to a row nobody can see.
**It has never been displayed to anyone, and structurally cannot be.**

**Step 5 needs explaining too.** `is_free` is a true/false/empty column, used by the internal
dashboard and by the event page's SEO title. `price_text` is a separate column holding the
literal string `'Free'` or `'Paid'`. **Nothing in the UI reads `price_text`** — it is written in
three places, carried through the cache, and never looked at.

## Age

The model returns age buckets (`toddler` 0–5, `kids` 6–12, `teen` 13–17, `family`) plus one
confidence score. That single score currently does two unrelated jobs: it decides whether to
show an age badge, **and** whether the event appears on the site at all.

## The cache

Once an event has been classified, the answer is stored and reused. That is why a normal night
costs 2–5 model calls instead of 144. The check is *"is `kid_relevant` empty?"* — empty means
never asked.

---

# 2. What is wrong with it

### 2.1 The product policy is fused into the prompt

The prompt tells the model two things at once:

1. Read the text and report what it says about price
2. If it says nothing, answer "free" — *"this is a city Parks & Recreation calendar, such events
   are FREE in the overwhelming majority of cases"*

You get back **one answer that blends both**. The model's own reasoning shows the blend:
*"no price is mentioned, so it defaults to free per community-event convention."* That sentence
contains a factual observation **and** a business decision.

**Two consequences:**

- **You cannot measure the model's reading ability.** When it says "free", you cannot tell
  whether the text said so or the model applied the assumption.
- **You cannot change the policy without editing the prompt** and re-classifying everything. A
  business rule that should be a one-line switch is buried in instructions to a model.

### 2.2 The 12-word rule is inconsistent, not wrong

Two real events, both with **zero** price information in the source:

| Event | Trigger word present? | What a parent sees |
|---|---|---|
| Parks For Pollinators | no | **Free ✦** |
| Heritage How-To: Calligraphy | yes — "workshop" | **no badge** |

Identical evidence, opposite outcomes, and the only difference is a word unrelated to cost.

**Every call the rule makes is defensible** — the eval confirmed that (§`EVALS.md`). Its defect
is that it fires on **vocabulary**, so it is right by correlation rather than by evaluation.
Where the correlation holds it works; where it breaks — a free drop-in toddler storytime
*class* — it silently withholds a badge it shouldn't.

### 2.3 One confidence score doing two jobs

The prompt defines confidence in terms of **age**: *"high = the age range was explicitly stated,
or the event clearly uses family/child language."* But the code also uses that number to decide
whether the event exists.

So an event plainly suitable for a family but vague about *which* ages gets a lowish score and
**disappears entirely**. An event was deleted because we were unsure about its age.

### 2.4 A failed model call hides an event forever

When the model call fails, the code writes `kid_relevant = false` (meaning *hide*). But `false`
is not *empty* — so the next night the cache reads it as a real stored answer and never asks
again. **One transient network blip and that event is hidden permanently**, with nothing
reporting it.

This is the same defect already solved for the spend cap, where the code deliberately writes
*nothing* so the event retries. The failure branch beside it still writes `false`.

### 2.5 Nothing was measured

Everything above was argument. Until the golden set (`EVALS.md`), nobody had ever compared this
system's output against a known-correct answer.

---

# 3. Decisions taken

*All agreed with the product owner during the 2026-08-23 review.*

| # | Decision |
|---|---|
| 1 | **Kid-relevance means "would a parent plausibly choose this as something to do with their child?"** — i.e. general-audience events a family would attend are **in**, not only events aimed at children |
| 2 | Excluded: adults-only by rule (21+, wine tastings) · adult-focused by content (breathwork workshops, adult ballet) · things that are not events (vendor applications, board meetings) |
| 3 | **No age badge in the list view.** Age drives filtering only. The badge appears in the detail view. |
| 4 | **Visibility is gated on kid-relevance confidence**, not age confidence |
| 5 | **Age at high or medium confidence** → filters into those specific buckets. **Age at low confidence, or no age at all** → falls back to family (all filters, `Family ✦`) — provided it passed the kid-relevance gate |
| 6 | **Distinguish confirmed family from estimated family**: `Family` when the source says so, `Family ✦` when we worked it out |
| 7 | **Price: keep the `Cost:` field**, then check the **Link field**, then the model |
| 8 | Link label **"Buy tickets" / "Get tickets"** → paid. **"Register here" / "Sign up"** → show nothing (registration is ambiguous; free events require it constantly) |
| 9 | A price findable **only by following a link to another page** resolves to `unknown` — no second crawl |
| 10 | **Add a real price confidence score** from the model, and **delete the 12-word rule.** Not both — see §5 |
| 11 | **Delete the keyword placeholder** (step 2) and **`price_text`** (part of step 5) — both dead |
| 12 | **Remove "community events default to free"** from the prompt |
| 13 | **Keep the `21+` word check for now** — deleting it is untestable until we have an adult sample |
| 14 | **Strike the "no-badge rate should drop" ship criterion** — see §6 |

---

# 4. The target design

## What the model returns

| Field | Values | Status |
|---|---|---|
| `kid_relevant` | true / false | unchanged, new definition (decision 1) |
| `kid_confidence` | high / medium / low | **new** |
| `age_buckets` | toddler / kids / teen / family | unchanged |
| `age_basis` | stated / assumed | **new** — did the text state an age, or did we infer it? |
| `age_confidence` | high / medium / low | unchanged, now scoped to age only |
| `price` | free / paid / unknown | unchanged |
| `price_basis` | stated / assumed | **renamed** from today's `price_confidence`, which was never a confidence — it recorded *where the answer came from*, not how sure the model was |
| `price_confidence` | high / medium / low | **new** — an actual certainty |
| `reasoning` | one sentence | unchanged — this is the audit trail |

`age_basis` is needed because today a Play Frisco description saying *"ages 5 and up"* still gets
the estimated marker, since the source is assumed to be always-inferred.

## Price — the order of operations

1. **`Cost:` field present and readable** → use it. Confirmed, plain badge, no ✦.
2. **Link label says "Buy tickets" / "Get tickets"** → **Paid**.
   Link label says "Register" / "Sign up" → *no signal*, continue.
3. **Otherwise the model decides**, returning price + basis + confidence.
4. **Contradiction check** (see below).

## Price — what the parent sees

| Situation | Badge | Detail-view line |
|---|---|---|
| From the `Cost:` field | **Free** / **Paid** | none |
| From the Link label | **Paid** | none |
| Model, **high** confidence | **Free ✦** / **Paid ✦** | "…estimated from event description" |
| Model, **medium** confidence | **Free ✦** / **Paid ✦** | "…estimated from event description. Please validate." |
| Model, **low** confidence | **no badge** | none |
| Model returns `unknown` | **no badge** | none |

## Age — visibility, filtering, display

| Signal | Shown? | Filters | Detail badge |
|---|---|---|---|
| `kid_relevant: false` | **no** | — | — |
| `kid_confidence: low` | **no** | — | — |
| Age stated in the text | yes | its buckets only | `Ages 6–12` — plain |
| Age inferred, **high/medium** confidence | yes | its buckets only | `Ages 6–12 ✦` |
| Age inferred, **low** confidence | yes | **all** age filters | `Family ✦` |
| No age returned at all | yes | **all** age filters | `Family ✦` |
| Source says all-ages / family | yes | **all** age filters | `Family` — plain |

**List view shows no age badge at any confidence.** With no filters applied, everything visible
appears.

## The contradiction check *(new)*

> **If any source claims free while the text contains a literal dollar amount → force `unknown`.**

Applies to **both** the model's answer and the `Cost:` field — the Cost field currently wins
unconditionally with nothing checking it against the description. Zero events are affected today
(7 are priced by the Cost field, none contradicting), so this is prevention, not a fix.

It is not a heuristic: it fires on a factual contradiction, and only ever in the safe direction.

## Prompt versioning *(new)*

Stamp each stored classification with a fingerprint of the prompt text. If an event's stamp does
not match the current prompt, re-classify it instead of using the cache.

**Why:** without this, a prompt improvement never reaches events already classified — they keep
their old answers for months, so your catalogue becomes a mix of old and new logic.

**Cost:** a normal night stays at 2–5 calls. The night after a prompt edit costs ~144 calls,
about a cent. Then back to normal.

**Use a fingerprint of the text, not a hand-bumped label.** A step that depends on remembering
is a step that eventually doesn't happen.

## Cache fix

On a failed or unparseable model call, **write nothing at all** — exclude the event from the
batch. It is absent tonight and classified normally tomorrow. This reuses the mechanism already
built for the spend cap, and fixes §2.4 as a side effect rather than as a separate change.

---

# 5. What gets deleted, and why

| Deleted | Why |
|---|---|
| The ~30-rule keyword price scanner | Only runs when the model call fails — and that path hides the event, so no parent can ever see its answer. Zero failures in 144 events. |
| The 12-word "structurally paid" list | Fires on vocabulary, not evidence (§2.2). Replaced by the model's price confidence. |
| The `registration_required` downgrade | Same, and the bluntest of the set — it fires on its own |
| The keyword placeholder (step 2) | Dead by construction |
| `price_text` (part of step 5) | Nothing reads it. Worse, it is a *second copy* of a fact already held in `price_class`, with nothing keeping the two in step — a latent inconsistency written in three places. |
| "Community events default to free" from the prompt | Fuses a business rule into a factual question (§2.1) |

## Kept

`Cost:` field reading · the governance title filter (drops council/board items before any model
call) · the cache · the spend cap · the pre-write guard · the `21+` word check (decision 13)

**The pre-write guard**, for reference, is the check that runs immediately before anything is
saved: it drops events starting between 12:01 and 7:00 AM Central, rejects a whole batch if most
events shifted by the same amount (a clock bug), rejects a batch smaller than half the stored set
(a partial scrape), and refuses to write at all if it cannot read current state. It concerns
times and volume, not classification — listed here only so its absence from the changes is
deliberate rather than an oversight.

## Why "add price confidence" and "keep the 12-word rule" cannot both happen

Both decide the same thing: *when do we withhold a Free badge?*

Take *"Heritage How-To: Calligraphy"* — no price mentioned:

- **The word rule** sees "workshop" → withhold
- **Price confidence** — the model reads it, judges *"instructor-led session, materials provided,
  probably costs money, not confident it's free"* → low confidence → withhold

Same event, same outcome, two mechanisms. Running both means **you cannot tell which one acted,
one silently overrides the other if they disagree, and neither can be measured** — because
removing one leaves the other covering for it.

**Decision: keep the confidence score, delete the word list.** The word list produces the right
answers today, but by correlation rather than evaluation, which is exactly why it is inconsistent
on the events it happens not to match.

---

# 6. The ship gate

**A "ship gate" is the pass/fail rule, written down before measuring**, that decides whether a
change is safe to release. Writing it afterwards is how people accidentally pick whichever rule
their change happens to pass.

## The revised gate

| Tier | Criterion | Why |
|---|---|---|
| **Blocking** | **Wrongly-free = 0** — never show "Free" on something that costs money | Not a threshold to tune. See below. |
| **Blocking** | **Over-claim count must not increase** (baseline: **12**) | This is where an undetected wrongly-free would hide |
| **Blocking** | **Calibration check passes** — see below | If the confidence score is dishonest, nothing built on it is safe |
| Informational | agreement rate, under-claim count | Reported, never gating |

**Definitions.** *Wrongly-free*: the system shows "Free" and the human label says paid.
*Over-claim*: the system shows a badge where the human could not determine an answer — it asserts
beyond the evidence. *Under-claim*: the system shows no badge where the human could determine one.

**Why wrongly-free is zero rather than a percentage.** The whole safety story is *"when the model
is unsure, something catches it before a parent sees it."* One wrongly-free proves that false —
the model was confident, it was wrong, and nothing caught it. That is not one data point among
many; it removes the reason you believed the rest was safe. So you cannot say "I'll act on the
third one."

**Why counts and not rates.** With 64 events, one event is 1.6%. A "4% error rate" means between
2 and 3 events, and two borderline calls flip it to 6%. **Small samples answer existence
questions, not rate questions.** So gate on existence.

## The calibration check — do this before deleting anything

**Calibration** means: when the model says "high confidence", is it actually right more often
than when it says "low"? A confidence score that does not track correctness is **worse than
none**, because you would be withholding badges based on a meaningless number.

The golden set gives a direct test. There are **22 events where a careful human, with the page
open, could not determine the answer.** Run the new prompt and look at what confidence it reports
on exactly those:

| Result | Meaning |
|---|---|
| Mostly **low** | The score tracks evidence. It is honest. Proceed. |
| Mostly **high** | It is measuring something else — probably fluency. **Stop.** Do not gate on it, and keep the word list until this is fixed. |

## Then: pick the withhold threshold from a table, not from taste

Once every event has a confidence value, the open product question — *what do we show when the
source is silent?* — becomes arithmetic. For each possible cutoff, count:

| Cutoff | Badges shown | Badges withheld that a human **could** determine | Wrongly-free |
|---|---|---|---|
| withhold nothing | … | … | … |
| withhold on **low** | … | … | … |
| withhold on **low + medium** | … | … | … |
| only when explicitly stated | … | … | … |

Read down it and pick the row you can live with. **Expect the wrongly-free column to read zero
everywhere**, since it already does — so the real trade is coverage against caution.

## Criterion struck on 2026-08-23, and why

The original gate contained a third criterion:

> *"Suppression rate — events showing no badge — should **drop** from today's 16%"*

**Removed, at the product owner's direction.** The reasoning: the no-badge rate is a property of
the **source data**, not of the system. If Frisco does not publish a price, no badge is the
correct outcome. There is no defensible target value, because the source controls it.

The numbers bear that out. The system currently shows no badge on **11%** of events, while a
careful human could not determine an answer on **34%**. The criterion asked us to get below 16% —
less than a third of the defensible floor. Chasing it would have meant asserting a badge on *more*
events with nothing behind it.

**Recorded as a revision, not a quiet edit**, because a legitimate revision (the premise was
disproved) and a self-serving one (we didn't like the answer) look identical afterwards. The
written record is the only thing that tells them apart.

## Also in the original gate, and still unresolved

> *"Missed adult events — the system shows an event the human label says is not for children —
> must be zero before the `21+` check is deleted"*

**Untestable.** The golden set contains no adult events at all; the three `KID: no` labels are
vendor applications, a reception and a vendor market. So "zero misses" was true by default and
meant nothing — a passing grade on an exam with no questions.

**To make it real:** deliberately sample 10–15 events *because* they are adults-only, label them,
and run the model with the word check disabled. Until then, decision 13 stands and the check
stays.

---

# 7. Sequencing

| | Step | Depends on |
|---|---|---|
| 1 | Fix the cache-poisoning bug (§2.4) | nothing — ship independently |
| 2 | Write the new prompt — three confidence scores, new kid-relevance definition, no default-to-free | product owner review of the wording, since **the wording is the policy** |
| 3 | Run it over the same 64 labelled events | step 2 |
| 4 | **Calibration check** | step 3 — **a gate, not a step** |
| 5 | Fill the threshold table, pick a row | step 4 passing |
| 6 | Code: delete the word list, the placeholder and `price_text`; add Link capture, `age_basis`, the contradiction check, prompt versioning | step 5 |
| 7 | Re-score against the same labels; check the gate | step 6 |

Steps 1–5 are reversible. Step 6 is the only one that is not, and it comes last.

---

# 8. Still open

1. **Where the withhold threshold sits** — answered by the table in §6 once step 3 has run
2. **Whether `Family ✦` should distinguish "model judged it family" from "we fell back because
   the age was unclear"** — currently both get `Family ✦`, on the grounds that to a parent they
   mean the same thing
3. **The adult-event sample** needed to settle the `21+` check
4. **Whether to score per instance or per distinct event.** The golden set counts *instances*: a
   recurring series like Parks For Pollinators occupies 5 of 64 slots, so it gets five votes.
   Per-instance measures what a parent experiences; per-distinct-event measures what the model
   actually judged. For a ship gate about model quality, per-distinct-event is the better basis —
   the over-claim baseline of 12 instances is only 8 distinct events.
