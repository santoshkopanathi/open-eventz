# Ask eval — run log

Each run: what was measured, before anything was tuned. Labels are **provisional**: written by
Claude on 2026-11-18 at the owner's request (no time before an interview), committed before any
Ask code existed (`56d81d7`), but not blind human labels — the labeller also built the system.
Catalog frozen 2026-11-18, 430 events. Model `claude-sonnet-4-6`. Raw data: `run-1.json` etc.

---

## Run 1 — 2026-11-18, select prompt v1 · **gates FAIL (8)** · logged before any tuning

| Gate (blocking) | Result |
|---|---|
| Cited event not in the retrieved set | **0** |
| Model's raw answer contains a fact token (counted before the fallback) | **8 of 13** ✗ |
| Answer *shown to a parent* contains a fact token | **0** (the check caught all 8) |
| Free-only question showed a non-free event | **0** |
| No-match question showed events or an answer | **0 of 5** |
| Off-topic question got anything but the redirect | **0 of 2** |
| City rule broken | **0** |
| Forbidden event shown (closure notice, unknown price as free, teen workshop for a toddler) | **0** |

| Not blocking | Result |
|---|---|
| Parse accuracy (dates, city, free, age, scope, price note) | **18/18 on every field; scope 20/20** |
| Recall@5 against the acceptable sets | **0.85** |
| Precision (shown cards inside the acceptable set) | **0.91** |
| Answer shown / cards only (fallback) / nothing matched / redirect | 5 / 8 / 5 / 2 |
| Cost | 37 calls, 35.1k tokens in, 2.8k out, **$0.147 total, $0.0073 per question** |

**What failed and why.** The parse and the safety rules held completely. The writing step did
not: 8 of the 13 drafted answers stated a fact, and the check turned every one into a cards-only
screen. Three causes, read from the raw answers:

1. **Echoing the parent.** "perfect for a Saturday morning", "options for your baby", "on
   Tuesday", "at no cost", "teens can enjoy". The prompt banned facts but the model treated the
   parent's own words as safe to repeat.
2. **Shortened titles.** "The 4th Street Plaza Holiday Tree Lighting" and "Live After 5" instead
   of the full stored titles, so the digits in them no longer matched a title and counted as
   numbers. (The check removes exact titles only.)
3. **"Free" in other words.** "a wonderful free outing", "at no cost".

**The known gap showed up.** T02 shipped "perfect for little ones": an age claim with no age
word, exactly the case the spec named as an accepted MVP gap. The card beside it shows the real
age range.

**Precision misses are judgment calls, not errors.** A06 added family STEAM events to a teens
question (the labels count only teen-specific events). A10 added "Game On: Open Play", whose
description says chess sets are welcome — arguably right; the label is strict.

**Cost was a third of the estimate.** $0.007 a question against the $0.02 guess. Prompt caching
did not engage (`cache_read = 0`): both system prompts are under the model's minimum cacheable
length, so the cache flag is harmless but does nothing yet.

**The fix to try (one change, then re-run):** tell the select prompt not to repeat the parent's
words for day, time, price or age; to copy titles character for character; and to write plain
text. Caveat for any later score: there is no held-out set, so tuning against these same 20
questions can overfit them. The owner-labelled set replaces this one.

---

## Run 2 — 2026-11-18, select prompt v2 · **gates FAIL (8)** · the one tuning attempt

Change: the select prompt now says not to repeat the parent's words for day, time, price or age,
to copy titles character for character, and to write plain text.

| | Run 1 | Run 2 |
|---|---|---|
| Raw answers with a fact token | 8 of 13 | **8 of 13** |
| Shown answers with a fact token | 0 | **0** |
| Every other blocking gate | 0 | **0** |
| Parse accuracy, every field | 18/18 | **18/18** (scope 20/20) |
| Recall@5 / precision | 0.85 / 0.91 | **0.87 / 0.87** |
| Answer shown / cards only | 5 / 8 | **5 / 8** |
| Cost per question | $0.0073 | **$0.0076** |

**Result: the instruction did not move the number.** The model still echoes the parent ("Tuesday",
"Thursday evening", "teens"), now with fewer title truncations but more "free" and "toddler"
slips. Two runs of the same prompt family, same outcome: telling the model not to state facts
does not reliably stop it. **The code check is the part that keeps parents safe**, and it caught
16 of 16 across both runs. Stopped tuning here: with no held-out set, more prompt edits against
these 20 questions would be fitting the test, not improving the product.

Precision dipped because A08 now includes "Renaissance Faire: Miniature Tudor Cottage Workshop",
a teen workshop, in a "whole family" answer. Not a forbidden event for A08 under the labels, but
outside its acceptable set.

**Next design option, not built:** have the model return a short "why it fits" phrase per event,
check each phrase on its own, and drop only the failing phrase instead of the whole answer. That
keeps more of the framing text without loosening the rule.

---

## Broken-prompt run — 2026-11-18 · **gates FAIL (20), as required**

The spec's "done when": a prompt told to state dates must be caught by the check and fail the
eval. The test prompt replaces the select instructions with "give each event's day, start time
and whether it is free".

- **17 of 17** drafted answers stated facts, e.g. *"this Saturday (Nov 21) … at 10:30 AM (free)"*.
- **0** reached a parent. All fell back to cards only.
- The eval exited with failure. Without the no-facts rules the model also cited events on
  no-match questions, which the no-match gate caught too.

So the check discriminates: ordinary prompt ≈ 60% of drafts blocked, broken prompt 100%, and in
both cases zero fact-bearing text shown.

---

## Hands-on finding — 2026-11-18, first owner test of the Ask box

**Question:** "give me top 3 event recommendations in Friso for my 10 year old son for this
weekend" (Frisco tab). **Got:** "Showing: … outside Frisco and Plano … Nothing matched. Open
Eventz covers Frisco and Plano only." The parse read the typo "Friso" as an uncovered city.

**Why the eval missed it:** none of the 20 questions has a typo. A gap in the question set,
not in the scoring. **Fix (in code, not the prompt):** when the parse says "unsupported", check
the question for a near-spelling of Frisco or Plano; use that city and say so on screen ("We
read 'friso' as Frisco"). A unit test pins it, and pins the false positive the first version
had: "piano lessons" must never become Plano. **Add to the next eval set:** at least two typo
questions and one look-alike word.
