# Open items

A running checklist of what is pending and who owns it. **Last reviewed 2026-11-17.**

This is not a replacement for `../02-product/BACKLOG.md`, which holds the reasoning for each
product item. This file holds the *state*: what is blocked, what is time-bound, and what is
waiting on a hand-run step that no CI job will do for us. The backlog explains; this tracks.

Owners: **OWNER** = a human action I cannot take (production SQL, billing, labelling judgment,
a Google account). **BUILD** = work that can be coded.

---

## 1. Blocking now

### Migration 009 must run before the next nightly ingest · OWNER · **urgent**

`supabase/migrations/009_price_decided_by.sql` adds the `price_decided_by` column. It has
**not** been run — the live database returns `42703 column events.price_decided_by does not
exist`.

**The code that writes it is already deployed.** Commit `bf61758` (pushed 2026-11-13 13:08
CST) writes `price_decided_by` unconditionally in both upsert paths
(`src/lib/ingest.ts:595`, `:1183`) and selects it in the prior-read (`:958`). Every source
job will therefore fail on the next run.

**It was predicted on 11-13 and it happened.** Measured 2026-11-17, four nights later:

| | |
|---|---|
| Error, every night since 11-14 | `Could not find the 'price_decided_by' column of 'events' in the schema cache` |
| Sources dead | **play-frisco** and **kaleidoscope-park** — the two LLM-classified sources |
| Sources healthy | frisco-library, plano-library — they never write the column. Last ingested 11-17 12:24 |
| Last good write to the dead two | **2026-11-13 11:29 UTC** |
| Still being served | 47 upcoming play-frisco, 20 upcoming kaleidoscope-park — stale, and not refreshed or purged |
| **LLM calls paid for and discarded** | **316 calls, $1.90**, across four nights |

**The second-order finding, which is the interesting one.** The spend ceiling guards against
*runaway* cost. It does not guard against *wasted* cost. The classifier pass runs to completion,
bills for every call, and only then does the write fail and throw the whole batch away — so the
pipeline paid full price for four nights of work it discarded. Fail-closed protected the data and
spent the money anyway. A pre-flight schema check would have cost nothing and saved all of it.

**To clear it:** paste the migration into the Supabase SQL Editor and run it. It is additive —
one nullable column, a CHECK constraint, and a partial index — with no backfill, because
inventing provenance in the column whose job is recording provenance would be a poor joke.
Verification queries are at the bottom of the migration file. Then trigger the ingest manually
rather than waiting for the next cron, so the two dead sources catch up.

**Then close the class, not the instance** — see §6.

### A separate, smaller failure appeared on 11-17 · BUILD
`kaleidoscope-park: https://www.kaleidoscopepark.org/events/funder-s-forum-gathering/ HTTP 404`
New on 11-17 and unrelated to 009. Most likely an event withdrawn upstream between the listing
page and the detail fetch. Worth confirming it degrades gracefully rather than failing the run.

---

## 2. Time-bound

### #15 Billing handover · OWNER · **2026-11-18 — tomorrow**
Anthropic billing. Dated, and the date is the whole point. See `BACKLOG.md:634`.

---

## 3. Owner actions, not dated

### 55 labelling judgments · OWNER
The golden set is 65 labelled of 184 frozen events. 55 distinct judgments remain — many events
are repeats of the same program, which is why 119 unlabelled events collapse to 55 decisions.

| Source | Events | Judgments |
|---|---|---|
| kaleidoscope-park | 41 | 20 |
| play-frisco | 78 | 35 |

Start with Kaleidoscope, which is the smaller half:
`npm run eval:worksheet -- --source kaleidoscope-park`, then `-- --parse` to read it back.

### #14 Search Console migration · OWNER
Needs a Google account action. See `BACKLOG.md:616`.

### The `git add -A` decision · OWNER
On 2026-11-13 five previously-untracked files were swept into the public PM repo by a
`git add -A` and pushed under a commit message describing none of them. Three options were
put up — leave them, stop at not repeating it, or scrub the history with a force-push — and
**none has been chosen yet.** Until it is, the files remain public.

---

## 4. Product gaps

### #9 No conversions since 2026-08-18 · BUILD · **the one that matters**
Everything built so far measures model quality. Nothing measures whether a parent found an
event and went to it. This is the gap that changes the shape of the project's story, and it
is a product gap rather than an engineering one. `BACKLOG.md:493`.

### #8 Inferred dates are published but never graded · BUILD
15 live inferred occurrences. The venue's own next-date grades every one within days and
nothing records the verdict. `BACKLOG.md:474`.

### #26 LLM-as-judge · BUILD · ~2-3 hours
Can a model screen prompt changes? `BACKLOG.md:819`.

---

## 5. The eval's own gaps

Listed because an eval with unexamined gaps is the thing it exists to prevent.

| Gap | Why it matters |
|---|---|
| **The golden-set gate has never gone red in CI** | A guard nobody has watched fail is not yet a guard. The red-team suite has caught something; this one has not been seen to. |
| `eval-run.ts` applies the price rules to events whose price production **locks** | The eval exercises a path production does not take for those rows, so agreement there proves less than it appears to. |
| The documented `wrongly-paid` counter is not implemented | `EVALS.md` describes five direction counts; the code tallies four. |
| Confidence calibration is ungraded | Nothing asks whether a high confidence tracks correctness. The cheap first test: run it on the events a careful human could not determine — it should report low confidence. |
| Over-claim and wrongly-hidden are not split by cause | Both are single numbers mixing a model abstention with one of our own rule overrides, which need opposite fixes. Migration 009 is what finally makes that query answerable. |

---

## 6. The class behind the 009 incident · BUILD

Running 009 fixes tonight. It does not fix the design. **A schema change applied by hand, and
code that depends on it, deployed by a system with no way to know the schema has not caught up.**
Nothing connects the two. The code shipped at 13:08 on 11-13 and the column still did not exist
four days later.

Two ways to close it, and they are not exclusive:

1. **A pre-flight schema check in the ingest.** Before the classifier pass, assert that every
   column the upsert will write exists. Fail in the first second, at zero cost, instead of after
   316 billed calls. This is the one that would have saved the $1.90 and it fits the existing
   guard style — a check that is *able* to fail.
2. **Expand-contract.** The code tolerates the column being absent until the migration lands. More
   standard, and the right answer for a team; heavier here, where migrations are hand-run on purpose.

### An open question worth answering first
The runs are recorded with `status: 'err'`, so the workflow went red four nights running and the
≤48h per-source freshness guard should have fired on both dead sources. **Nothing was acted on for
four days.** Before building anything, find out which is true:

- the alert fired and was not seen — then this is a routing and attention problem, not a detection
  problem, and the fix is where alerts land, not another check;
- the alert did not fire — then a guard that should have caught a four-day outage did not, which
  is more serious than the outage and belongs with the "a guard nobody has watched fail" item in §5.

Either answer is worth having. Do not skip to the fix.

## Closed recently

Kept short, and only to stop re-opening settled questions.

- **Evals in CI** — live 2026-11-13, blocking on prompt/model/rule changes plus weekly.
- **The over-claim gate** — demoted to advisory after measuring a ±2 noise floor. Do not
  re-promote it without re-measuring.
- **The free-by-default prior** — tested against all 15 source pages, zero paid. It stays,
  and the earlier decision to strip it out of the prompt is reversed.
- **Product scope** — kids' events **and** family events. Settled, and already stated in the
  shipped prompt. `EVALS.md` Settled decision 1.
- **#30 Kaleidoscope truncation** — fixed 2026-11-11.
- **#25 red-team set** — built, finding closed 2026-11-10.
