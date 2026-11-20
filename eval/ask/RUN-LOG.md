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

---

## Owner labels — 2026-11-19 · blind · these replace Claude's labels from here on

The owner labelled all 20 questions in chat (`labels-owner.json`, commit `020deeb`), from the
same text the model sees (title, time, venue, first 300 characters of the description) plus the
card's price/age/registration labels. The owner had not seen Claude's labels or the model's
answers to these questions. **Owner's judgment: blind.** Claude's `labels.json` is kept for
history and for the parse expectations (dates, city, free, age), which the owner accepted.

Richer than Claude's labels: *acceptable* / *secondary* (fine to show, not required) /
*not good* / *forbidden*, plus **duplicate groups** (copies of one program count once).

**Decisions made while labelling (built in `e140c84`):**
1. One card per program, unless the parent asked for that very thing ("chess").
2. A general question gets a varied mix: "Here are a variety of things you could do…".
3. An uncovered city ("Dallas"): "Nothing matched. Open Eventz covers Frisco and Plano only.",
   then up to 5 varied events from the tab's city under a heading. Never a silent swap.
4. "LIBRARY CLOSED" notices must never be shown (now a blocking gate everywhere).
5. New price note: "Open Eventz only shows whether an event is 'free' or 'paid'. It does not
   determine if something is cheap or pricey."

**Two owner corrections worth keeping.** Q14: first picked a 10 AM event for "tonight", then
corrected to none. Q16: first included an unknown-price event in a "free" answer, then kept the
rule. A careful human missed both on first pass; both are rules the code enforces, which is the
point of putting them in code.

**What labelling exposed — fix A.** An undated topic question ("Where can my kid play chess?")
matched 253 Plano events and the model saw only the first 25 by start time, nearly all
storytimes; three of the owner's five chess picks were in December, out of reach. A search
problem, not a model problem.

---

## Run 3 — 2026-11-19 · old code, owner labels · gates FAIL (6)

Measures the change of answer key alone.

| | Run 2 (Claude labels) | Run 3 (owner labels) |
|---|---|---|
| Safety gates (invented, free, city, no-match, off-topic, forbidden) | 0 | **0** |
| Raw drafts stating a fact | 8 of 13 | **6 of 13** (all caught, 0 shown) |
| Parse accuracy, every field | 18/18 | **18/18** |
| Recall@5 / precision | 0.87 / 0.87 | **0.81 / 0.87** |
| Duplicate cards shown | — | **3** |
| N05 Dallas | — | **0/4** (fallback not built) |

---

## Run 4 — 2026-11-19 · owner decisions + fix A built · gates FAIL (5)

| | Run 3 | Run 4 |
|---|---|---|
| Safety gates | 0 | **0** |
| Raw drafts stating a fact | 6 | **5** (all caught, 0 shown) |
| Parse accuracy | 18/18 | **18/18** |
| Recall@5 / precision | 0.81 / 0.87 | **0.80 / 0.89** |
| Duplicate cards shown | 3 | **2** (both are chess sessions, which the rule allows when chess was asked for) |
| N05 Dallas fallback | 0/4 | **3/4** |
| A10 chess | Open Play + tonight's meet-up | **tonight + both December meet-ups** (reached past the old cap) |
| Cost per question | $0.0076 | **$0.0079** |

**What moved, and what didn't.** The two built behaviours work: Dallas now gets the headed
fallback, and the chess question reaches December. Recall is flat overall because single
picks moved: A01 chose the clean-energy talk (owner: not good) over Art Shop; A08 picked a
different five; A10 chose three chess sessions over "Open Play". These are one run each, and the
classifier work measured a ±2 noise floor on single runs, so a one-point move is not a finding.
**Next measurement worth doing: run the same set 3–4 times and report the spread.**

**New gap in the word check:** A03's shown answer says "happening this week!". "weekend" is
blocked; "week" is not. Not tuned here; listed for the next change.

**"Variety" framing works as decided:** A02 and T03 open "Here are a variety of things you
could do".
