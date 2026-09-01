# Eval run log

*One entry per evaluation run against the golden set. Newest last.*
*Concepts and method: `../EVALS.md`. The design under test: `../PRICE-AGE-REDESIGN.md`.*

**The golden set:** 68 events, 64 hand-labelled (KID yes/no + PRICE free/paid/unknown), labelled
blind against rules frozen before labelling. All 38 Play Frisco events (a census — the source is
purged nightly, so 38 *is* the population) plus a reproducibly-ordered random 30 of Kaleidoscope's
106. Worksheet: `price-golden-worksheet.md`.

---

# Baseline — the system as it stands (scored 2026-08-26)

| Metric | Value |
|---|---|
| **Wrongly-free** (shows Free, label says paid) | **0** |
| Wrongly-paid | 0 |
| Over-claim (badge shown, human could not determine) | 12 |
| Under-claim (no badge, human could determine) | 2 |
| Agreement with labels | 70% |
| Events showing a Free/Paid badge | 57 of 62 |

**How the labels were reached** — this matters for reading everything below:

| | Count |
|---|---|
| A `Cost:` field on the page gave the answer | **1** |
| Judged from the text by the labeller | **41** |
| Could not tell, even with the page open | **22** |

Only one of 64 answers came from hard evidence. **The labeller and the model are doing the same
thing — judging from prose — and disagreeing about how much signal is enough.** That reframes the
problem as a threshold, not an evidence gap, which is what makes a confidence score the right
mechanism rather than a compromise.

---

# Run 1 — prompt v2 (2026-08-31)

**What changed:** three separate confidence scores instead of one · broader kid-relevance
("would a parent plausibly choose this as something to do with their child?") · **"community
events default to free" removed from the prompt** · `age_basis` and `price_basis` added ·
`"adult"` removed from the bucket list · the verbatim test-case quote removed.

**What deliberately did NOT change:** the Link-field capture was excluded so any movement would be
attributable to the prompt alone.

**Mechanics:** 62 of 64 events ran (two have since aged out of the database). Zero errors.
Scripts: `run-v2.js`, `score-v2.js`. Raw output: `run-v2-results.json`.

## Raw output

| Price value | v1 (today) | v2 |
|---|---|---|
| free | 52 | **19** |
| paid | 5 | 7 |
| unknown | 7 | **36** |

Removing the free-by-default instruction worked exactly as intended — the model stopped assuming.

| Confidence | high | medium | low | missing |
|---|---|---|---|---|
| price | 9 | **2** | **49** | 2 |
| kid-relevance | 39 | 22 | 1 | — |
| age | 11 | 47 | 4 | — |

## The four gates

### Gate 1 — does confidence vary? ✅ PASS

It varies. But 79% of price confidence lands in `low`, which becomes the problem below.

### Gate 2 — calibration ✅ PASS, decisively

*Does the model report low confidence where a human found no evidence?*

- On the **22 events the labeller could not determine**: 21 `low`, 1 missing. **Zero `high`.**
- All **9 `high` ratings** landed on events the labeller *could* determine.

**High confidence appears only where evidence exists.** The score tracks evidence, not fluency.
This was the most likely thing to fail and it didn't — it is the strongest result of the run.

### Gate 3 — safety ✅ PASS

Of the 5 events labelled `paid`: four returned `paid` (three high, one medium); one
(*Frisco Camp Out*) returned `unknown`/low — a withhold, not an error. **Zero wrongly-free.**

### Gate 4 — kid-relevance ⚠️ PARTIAL

Eight events the labeller called kid-appropriate that v1 hides:

| Event | v2 |
|---|---|
| Cycle the City – Northwest Frisco | ✅ shows, `family` |
| Watercolor with Maya Modi | ✅ shows, `kids, teen` |
| Heritage How-To: Calligraphy | ✅ shows, `kids, teen` |
| Reception "The Shape of Now" | ✅ shows, `family` |
| Heritage How-To: Greeting Cards | ✅ shows, `kids, teen` |
| Watercolor and Mindful Self-Care | ❌ still hidden |
| Watercolor with Maya Modi *(2nd date)* | ❌ still hidden |
| Art in the Atrium – Call for Art | ❌ still hidden |

**5 of 8 recovered.** One leak in the other direction: *Reception, "Stories from the Archives"*
was labelled `KID: no` and v2 shows it.

**Two caveats on reading this gate.** *Call for Art* is a submissions notice, so the model is
arguably right and the label generous. And **the KID labels predate the agreed kid-relevance
definition**, so part of this gap is labels-versus-policy drift rather than model failure.

## Why we are not shipping it

The model now answers `unknown` on 36 of 62. What a parent would see:

| Policy applied to the model's output | Badges | Over-claim | Under-claim | **Wrongly-free** |
|---|---|---|---|---|
| show every answer; nothing for `unknown` | 26 | 12 | 26 | 0 |
| show only medium/high confidence | **11** | 0 | 29 | 0 |
| **`unknown`/low → Free** *(v1 behaviour rebuilt in code)* | 62 | 22 | 0 | **1** ❌ |
| **v1 today, for reference** | **57** | **12** | **2** | **0** |

**Both honest options are a large coverage loss** — 57 badges today becomes 26, or 11.

**And the third row breaks the safety gate.** *Frisco Camp Out 2026*: labelled `paid`, model says
`unknown`, and a free-by-default policy would override that and display **"Free."**

### The principle underneath it

> There is a difference between *"the model leaned free but wasn't certain"* and *"the model
> looked and said it cannot tell."* Converting the second into "Free" is not filling a gap —
> **it is discarding the answer you asked for.**

**Correction to an earlier claim.** I initially wrote that the 12-word keyword rule is what
prevents this failure today. **That is wrong.** The rule only fires when the model says `free`
with an assumed basis; here the model says `unknown` in both v1 and v2, so the rule is a no-op on
this event. What protects it today is simply that v1 shows no badge for `unknown`.
*(The rule does do real work elsewhere — on 5 of the 6 events it touches, the model said `free`
and the rule downgraded it.)*

**Honesty note on the finding.** The `paid` label on Frisco Camp Out was itself a lean —
*"dinner and breakfast provided, feels like too much for a free event."* It counts as wrongly-free
because the label is ground truth by definition, but it is not a proven error. **The gate tripped
on one soft label.**

## The actual defect: an unusable confidence distribution

`price_confidence` came back **low 49 · high 9 · medium 2**.

**Medium was used twice in 62 events.** A three-tier scale with an unused middle tier is
effectively binary, and with 79% in `low`, "withhold on low" is an off switch rather than a
threshold.

**Why it collapsed.** Two instructions pull the same way — *"do not apply any assumption about
what this kind of event usually costs"* and *"prefer a low-confidence lean over unknown"*. Together
they say: lean, but don't feel confident. The model complied exactly.

**And the middle tier was defined out of reach:** `medium` = *"strong contextual signal, though not
stated outright."* "Strong" is a high bar. Most of these events have a *reasonable* signal — a free
public park programme, a drop-in community activity — not a strong one, so they fell to `low`.

Note the model reports `low` on **28 of the 40 events the labeller could determine**. It is not
distinguishing "nothing to go on" from "decent grounds, just not stated."

## Two incidental findings

**The model omitted a required field twice** (~3%) — *Frosty 5K* and *Reception "The Shape of Now"*
returned no `price_confidence` at all. Model output is not a contract; the new fields need the same
defensive parsing the old ones already have. Scoring treated a missing value as `low` (the cautious
reading), but the code must make that choice explicitly.

**The same event was classified two opposite ways.** Both dates of *Watercolor with Maya Modi*:
one `kid_relevant: true, ["kids","teen"]`, the other `false, []`. Not model randomness — **the two
scraped descriptions differ** (505 vs 415 characters; one lacks a date/venue prefix and contains
different phrasing). A **data-capture bug**, user-visible on its own: a parent filtering for teens
would see one date of the workshop and not the other. It also means the eval is scoring the model
on inconsistent inputs.

## Decision

**Do not ship. Iterate the prompt, change one thing.**

The prompt did what was asked; what was asked was slightly wrong. **Change only the confidence tier
definitions** so `medium` is reachable:

| Tier | Current | Proposed |
|---|---|---|
| `high` | "an explicit statement of price or of being free" | unchanged — used 9 times, working |
| `medium` | "strong contextual signal, though not stated outright" | **"no explicit statement, but the event type and framing give reasonable grounds — a free public park programme, a drop-in community activity, an event with no sign of commerce"** |
| `low` | "a lean with little support" | **"little or nothing in the text bears on price"** |

Nothing else changes, so any movement is attributable to that one edit.

---

# Separate finding — the Link field is worth more than estimated (2026-08-31)

Measured across all 48 Play Frisco event pages. **31 carry a `Link:` field**, and it sits in the
HTML we already download — **no crawl required, one regex.**

| Label text | Count | Signal |
|---|---|---|
| "Get Tickets Here" · "Buy Tickets" · "Event Website & Tickets" | **7** | **paid** |
| "Register Here" · "Sign Up Here" | 5 | ambiguous → show nothing |
| "More Info" · "Learn More" · "Event Website" · named sites | 19 | no signal |

Four of the seven are already classified paid. **Three are currently `unknown` and would be
resolved outright** — and they are the workshops this whole review has been arguing about:

> Watercolor and Mindful Self-Care → *Get Tickets Here* → squadup.com
> Watercolor with Maya Modi ×2 → *Buy Tickets* → squadup.com

**Following the links** (as opposed to reading their labels) would add roughly two more events —
*Frosty 5K* and *Greeting Cards* — at the cost of a permanent dependency on five external domains
(friscotexas.gov 14 · perfectmind 7 · squadup 6 · two others). **Not worth it**, and consistent
with decision 9.

**Capture the label. Do not follow the link.**

---

# What to run next

1. Re-run with only the confidence tier definitions changed → does `medium` become usable?
2. If yes, recompute the policy table and pick a threshold row
3. Separately and independently: add the Link-field label capture, then re-measure
4. Still open: the labels-versus-policy drift on KID (labels predate the agreed definition), and
   whether to score per instance or per distinct event

---

# Run 2 — prompt v3 (2026-08-31)

**What changed from v2:** the `price_confidence` tier definitions, and **nothing else**. `medium`
was redefined from *"strong contextual signal, though not stated outright"* to *"no explicit
statement, but the event type and framing give reasonable grounds — a free public park programme,
a drop-in community activity, an event with no sign of commerce"*, and `low` to *"little or
nothing in the text bears on price."* Verified by diff: one block, four lines.

Script: `run-v3.js`. Results: `run-v3-results.json`. Scorer: `score.js`.

## The tier change worked

| `price_confidence` | v2 | **v3** |
|---|---|---|
| high | 9 | 10 |
| **medium** | **2** | **16** |
| low | 49 | 35 |

One sentence moved a whole tier from unusable to usable. Gates 2 and 3 still pass — zero
high-confidence answers on the 22 unknowables, zero wrongly-free. Gate 4 unchanged (5 of 8, one
leak), as expected since that wording wasn't touched.

## But the threshold turned out not to be the lever

| Policy | Badges |
|---|---|
| show every answer | 27 |
| withhold LOW | **26** |

**Withholding on low confidence removes exactly one badge.** Of 62 events the model answers
free/paid on 27 and says `unknown` on 35; almost all the `low` ratings sit on `unknown` answers
where they change nothing. **The model withholds by answering `unknown`, before confidence is
assigned.** The dial has almost no travel.

## The decisive comparison — against the labels

Rows = the human label, columns = what the system said.

**v1 (live today) — 71% agreement**

| | free | paid | unknown | total |
|---|---|---|---|---|
| labelled **free** | **35** | 0 | 0 | 35 |
| labelled **paid** | 0 | 4 | 1 | 5 |
| labelled **unknown** | 16 | 1 | 5 | 22 |

**v3 — 37% agreement** *(v2 was 39%)*

| | free | paid | unknown | total |
|---|---|---|---|---|
| labelled **free** | **10** | 0 | **25** | 35 |
| labelled **paid** | 0 | 4 | 1 | 5 |
| labelled **unknown** | 9 | 4 | 9 | 22 |

**Of the 35 events labelled FREE with no difficulty, v3 refuses to answer on 25.** On the 5
labelled paid, all three versions are identical — four correct, one withheld. **Safety behaviour
is unchanged across every version; the entire difference is willingness to answer.**

## Why — and this overturns the redesign's premise

The labels were reached using the same reasoning v1's prompt encodes. From the labeller's own
notes: *"no explicit free or paid signal. But this is a community clean-up event and normally
those would not be paid"* · *"leaning towards free"* (×5).

**That is the free-by-default prior.** The labeller applied it; v1 applies it; v2 and v3 were
explicitly forbidden from applying it. So they refuse where both the human and v1 answer
comfortably.

**The evidence on the prior itself:** zero wrongly-free across 62 events in every version. Weak
evidence — only 5 paid events exist to be wrong about — but removing the prior costs 25 badges
and buys nothing measurable.

## The subtler finding

**v1's model refuses selectively.** It answers `unknown` on 7 events, including Frisco Camp Out,
on its own judgment. It holds the prior *and* retains discretion to override it.

**A blanket policy in code has no discretion.** Converting every `unknown` to Free overwrites the
model's considered refusals along with its uninformed ones — which is exactly why that policy row
produces a wrongly-free while v1 does not.

> **The prompt-fusion problem is real, but the cure attempted here is worse than the disease.**
> Holding the prior inside the prompt lets the model apply it *with judgment*. Removing it made
> the model refuse 35 times; reapplying it blanket in code removes all judgment.

## Decision

**Keep v1's price behaviour.** It agrees with careful human judgment nearly twice as often at
identical safety. **Decisions 10 and 12 of `PRICE-AGE-REDESIGN.md` are reversed** — see that
document's revised scope.

The age and kid-relevance changes are a separate, measurable win and proceed.
