# Open items

A running checklist of what is pending and who owns it. **Last reviewed 2026-11-13.**

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

| | |
|---|---|
| Last successful ingest | 2026-11-13 11:30 UTC — **before** the writing code landed |
| Next scheduled ingest | `40 3 * * *` → **2026-11-14 03:40 UTC** (21:40 CST tonight) |
| Failure mode | fail-closed: the batch is rejected, nothing is written, the job exits non-zero |
| Blast radius | stale data, not wrong data. The ≤48h per-source freshness guard catches it the following night |

**To clear it:** paste the migration into the Supabase SQL Editor and run it. It is additive —
one nullable column, a CHECK constraint, and a partial index — with no backfill, because
inventing provenance in the column whose job is recording provenance would be a poor joke.
Verification queries are at the bottom of the migration file.

---

## 2. Time-bound

### #15 Billing handover · OWNER · **2026-11-18**
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
