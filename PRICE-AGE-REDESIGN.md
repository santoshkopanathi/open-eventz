# Price & age classification — agreed redesign

*Status: **designed, not built**. Blocked on the golden set (see `eval/`). Date: 2026-08-23.*

**Why this exists.** The price pipeline accumulated six deterministic rules, most of them
written when keywords were the primary classifier. Once the LLM became primary they stayed on
as a second, worse classifier arguing with the first. This is the agreed simplification.

**The one-line rationale.** *Those rules exist because the model has no way to say "free, but
I'm not sure."* Give it a real confidence score and the workaround is redundant — you replace
a **proxy** for uncertainty with **actual** uncertainty, reported by something that read the
whole description rather than scanning for twelve words.

---

## What the model returns

| Field | Values | Status |
|---|---|---|
| `kid_relevant` | true / false | unchanged |
| `kid_confidence` | high / medium / low | **new** |
| `age_buckets` | toddler / kids / teen / family | unchanged |
| `age_basis` | stated / assumed | **new** — was an age in the text, or inferred? |
| `age_confidence` | high / medium / low | unchanged, now scoped to age only |
| `price` | free / paid / unknown | unchanged |
| `price_basis` | stated / assumed | **renamed** from `price_confidence` |
| `price_confidence` | high / medium / low | **new** |
| `reasoning` | one sentence | unchanged |

`age_basis` is needed because a Play Frisco description saying *"ages 5 and up"* currently gets
the estimated marker regardless — the source is assumed to be always-inferred.

## Visibility

| Condition | Shown? | Cached? |
|---|---|---|
| `kid_relevant: false` | no | **permanently** |
| `kid_confidence: low` | no | **permanently** |
| call failed / unparseable | no | **no — retried next run** |
| everything else | yes | yes |

**Low *age* confidence does NOT hide an event.** It suppresses the age claim only. The governing
principle: *withhold the claim, never the event.*

Failures reuse the spend-cap mechanism — write nothing at all — which is what separates
"decided to hide" from "never got an answer", and fixes the cache-poisoning bug as a side effect.

## Price display

| Cost field | Confidence | Badge | Detail line |
|---|---|---|---|
| present, readable | — | Free / Paid | none |
| absent | high | Free / Paid ✦ | "…estimated from event description" |
| absent | medium | Free / Paid ✦ | "…estimated from event description. Please validate." |
| absent | low | none | none |
| any | `unknown` | none | none |

## Age display and filtering

| Basis | Confidence | Filters | Card | Detail |
|---|---|---|---|---|
| stated | — | its bucket only | `Family` / nothing | `Family` / `Ages 0–5` |
| assumed | high | its bucket only | `Family ✦` / nothing | `Family ✦` / `Ages 13–17 ✦` |
| assumed | medium | its bucket only | as above | as above + "Please validate" |
| assumed | low | its bucket only | **no badge** | **no badge** |
| `family` | any | **all** age filters | as above | as above |

Two display decisions taken here:
- **The tilde is gone.** `~ Family ✦` → `Family ✦`, matching price, which never had one.
- **The bare `✦` is gone from cards.** A lone star with no text communicated nothing. Net effect:
  a card shows an age chip only when the answer is "Family". Every specific range is detail-only.

No filters applied → everything visible shows.

## The disclosure line

One sentence per event, merging whichever of age and price were inferred, wording set by the
**weaker** of the two confidences. `inference-disclosure.ts` already composes this; only the
trigger (confidence-based, not inferred-based) and the wording per tier change.

---

## Deleted

| Rule | Why |
|---|---|
| Keyword price rulebook (~30 rules) | Only runs when the model call fails — and that path hides the event, so no parent can ever see its answer. Has never run in production (0 failures / 144 events). |
| 12-word structurally-paid list | A word list overruling a model that read the whole description. Suppresses the price on 16% of live events. |
| `registration_required` downgrade | Same, and bluntest of the set — it fires alone. |
| `21+` / `18+` / `adults only` regex | **Not an independent check.** It fires only on explicit markers, which are exactly what makes the model confident. Matched 1 event ever; the model had already flagged it. Two locks on the same door. |

## Kept

Cost-field reading · governance title filter · cache · spend cap · pre-write guard

## Added

**The contradiction check.** *Any source claims free while the text contains a literal dollar
amount → force `unknown`.* Applies to **both** the model's claim and the Cost field — the Cost
field currently wins unconditionally with nothing checking it against the description. Zero
events affected today (7 priced by the Cost field, none contradicting), so this is prevention.

It is not a heuristic: it fires on a factual contradiction, and only ever in the safe direction.

**Prompt versioning.** Stamp each classification with a fingerprint of the prompt text; re-infer
when it does not match. Without this a prompt improvement never reaches already-classified
events — they keep old answers for months — and, now that the regex is gone, a cached miss
would live forever. A normal night stays at 2–5 calls; the night after a prompt edit costs ~144
calls, about a cent.

Use a **fingerprint of the text, not a hand-bumped label.** A step that depends on remembering
is a step that eventually doesn't happen.

---

## The gate — nothing above ships without it

Golden set: **68 hand-labelled events** — all 38 Play Frisco (a census; the source is purged
nightly so 38 *is* the population) plus a random 30 of Kaleidoscope's 106. Two labels each:
KID (yes/no) and PRICE (free/paid/unknown).

Score the current system against the labels **first**, then the new one, then compare.

| Metric | Rule |
|---|---|
| **Wrongly-free** — shown Free, actually costs money | **must stay at zero.** Non-negotiable. |
| **Suppression rate** — events showing no price | should **drop** from today's 16% |
| **Missed adult events** — model says kid-relevant, label says no | **must be zero** before the regex is deleted |

Revert if wrongly-free moves off zero: the keyword rules were doing more than they looked like.

## Sequencing

1. Label the golden set *(in progress)*
2. Score the current system — the baseline
3. Prompt change: three confidence scores, `age_basis`, `price_basis` rename
4. Re-score, pick the withhold threshold (low only, or low + medium)
5. Delete the four rules, add the contradiction check and prompt versioning
6. Re-score to confirm nothing regressed

Steps 1–4 are reversible. Step 5 is the only one that isn't, and it comes last.
