# Open items

A running checklist of what is pending and who owns it. **Last reviewed 2026-11-18.**

This is not a replacement for `../02-product/BACKLOG.md`, which holds the reasoning for each
product item. This file holds the *state*: what is blocked, what is time-bound, and what is
waiting on a hand-run step that no CI job will do for us. The backlog explains; this tracks.

Owners: **OWNER** = a human action I cannot take (production SQL, billing, labelling judgment,
a Google account). **BUILD** = work that can be coded.

---

## 0. Resolved 2026-11-18, and what it exposed

**009 is run and the outage is over.** All four sources ingested cleanly at 02:56-02:57 UTC:
frisco-library 167, plano-library 325, play-frisco 58, kaleidoscope-park 21, `errors: []` on every
run. The 11-17 Kaleidoscope 404 did not recur. Cost $0.018.

**The waste was compounding, not flat.** This clean run made **1 and 2** LLM calls, because the
classification cache hit. The four failed nights each made 79, since nothing was ever written and
so the cache could never populate. The cost was not "79 calls wasted once" — it was 79 calls that
could never fall to zero. A failed write at the end of a pipeline re-bills the whole pipeline.

### Provenance re-run — DONE 2026-11-18 03:39-03:42 UTC

Scope deliberately limited to **upcoming** events, since nothing reads a past one. 69 rows had
`kid_relevant` cleared to force re-classification, snapshotted first (the nightly fetch is
upcoming-only, so nulling a row the fetch will not re-collect hides it permanently). All came back:

| | |
|---|---|
| Rows re-classified | **69 / 69** — play-frisco 48, kaleidoscope-park 21 |
| Left unclassified | **0.** Snapshot restore not needed |
| Verdicts | play-frisco 35 relevant / 13 not · kaleidoscope 20 / 1 |
| LLM calls | **69** (48 + 21) |
| Cost | **$0.414** — estimate was ~$0.76, so 55% of it |
| Errors | `[]` on all four source runs |

The 10 play-frisco rows fetched but not re-called were past-dated and hit the cache, which is the
cache behaving exactly as designed.

**Measured provenance, upcoming rows only:**

| Value | Count |
|---|---|
| `source-cost-field` | 36 — all play-frisco |
| `source-declared` | 21 — all kaleidoscope-park |
| `model` | 11 |
| `rule-keyword` | 1 |
| `source-institution` | **0** |
| `rule-registration` | 0 |

So **11 of 69 visible prices rest on a model judgment — 16%.** That is now a measured number
rather than a quoted one, and it is the figure to use.

### ⚠️ `price_decided_by` is still 69 of 2,394 rows overall · BUILD

| | |
|---|---|
| Populated | **69** (was 3) |
| NULL | **2,325** |
| frisco-library | 0 of 587 — **0 of 142 upcoming** |
| plano-library | 0 of 1,680 — **0 of 325 upcoming** |
| play-frisco | 48 of 88 — **48 of 48 upcoming** ✅ |
| kaleidoscope-park | 21 of 39 — **21 of 21 upcoming** ✅ |

The re-run fixed 100% of what a visitor can see on the two LLM-classified sources. **The library
half is untouched and cannot be fixed by re-running** — it needs the code change below. 467
upcoming library events still have no provenance.

Two separate causes, both confirmed in the code:

1. **NULL is sticky.** `src/lib/ingest.ts:977` carries `prior.price_decided_by` forward on a cache
   hit. Every pre-migration row has NULL, so re-ingesting a known event copies NULL back in. Only
   brand-new events ever acquire a value — which is why a run touching 571 rows populated 3.
2. **The library connectors never set it.** `price_decided_by` is written only in the play-frisco
   and kaleidoscope paths. The migration defines `source-institution` for library programming and
   nothing ever writes it, so 2,267 library rows cannot acquire provenance at all.

**The documentation consequence, which matters more than the bug.** `GUARDRAILS.md` (A13),
`INGEST-DESIGN.md` and the interview primer all state a live distribution — *2,252 institutional /
38 source-declared / 31 Cost-field / 56 model-judged, of which 35 rest on the free-by-default
prior* — in a way that reads as though the column records it. **It does not.** That split was
derived by other means before the column existed. The numbers describe what the column *would*
say once populated. This is the same failure already recorded in `BUILD-LOG.md` under "Writing a
number into a document is not the same as knowing it", now on its third appearance.

**What is actually recoverable, and what is not:**

- **Library rows — safe to set.** Institutional free is true *by source*, no judgment involved.
  A deterministic backfill of 2,267 rows invents nothing.
- **Cost-field rows — probably recoverable** from the stored `raw_json`.
- **Model-judged rows — not recoverable.** Which layer decided is genuinely unknown for those, and
  deriving it would be exactly the invented provenance the migration refused. **Done for upcoming
  rows 2026-11-18** by clearing the cache and re-running, $0.414. Past rows stay NULL on purpose.

Until the library half is fixed, do not quote a site-wide distribution as something the database
can answer. The **upcoming** figures above it *can* answer, for two of four sources.

---

## 1. ~~Blocking now~~ — cleared 2026-11-18

### ~~Migration 009 must run before the next nightly ingest~~ · **DONE 2026-11-18**

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

### Ask Open Eventz — built on a branch, not live · BUILD + OWNER · updated 2026-11-19
Branch `ask-open-eventz` (folder `06-app-ask/`), flag off. Not merged, not pushed. **Owner labels
done 2026-11-19 (blind)**; the owner's five labelling decisions and retrieval fix A are built.
Open before it could go live, in order:
1. **Repeat runs** (BUILD): run the same 20 questions 3–4 times and report the spread before
   claiming any recall change. Then a **held-out set** (OWNER labels) with typo and look-alike
   questions ("Friso", "piano").
2. **Word check misses "week"** (BUILD): "happening this week!" got through in run 4.
2a. **Daily ceiling to a shared store** (BUILD). It is in server memory today.
3. **Merge decision** (OWNER). The branch also carries the list-card age-range change, which
   changes the live list.
4. **Value measurement** (BUILD): GA4 events for question asked / answer shown / fallback / card
   clicked, and does Ask lead to more detail views than browsing?
Results: `06-app-ask/eval/ask/RUN-LOG.md`; summary in `EVALS.md` Part 4.

### Two data oddities found while labelling · BUILD · found 2026-11-19 · **later**
- **Kaleidoscope Park lists "SaturYAY!" and "SaturYay: Christmas Edition" at the same time and place
  on Sat Nov 21** (only the Christmas Edition on Nov 28). Likely a duplicate or conflicting listing
  from the source; a parent sees both. The owner flagged it twice while labelling.
- **"Wind Chimes (Ages 16+)" shows "Ages 13–17" on its card.** The library age group, not the
  program's own 16+. The age chip shows the library's group, so a 13-year-old's parent could be
  misled. Check how the Plano connector maps "16+".

### "LIBRARY CLOSED" notices are shown to parents as events · BUILD · found 2026-11-18 · **later**
(Ask now excludes them at retrieval; the list view still shows them.)
Found while freezing the Ask eval catalog. 9 Frisco Library entries titled "LIBRARY CLOSED"
(Thanksgiving week and after, listed at 12:00 AM) are live in the list, badged "Free" and
"Ages 0–17". Likely cause: the Frisco Library connector imports closure notices as events.
Fix at ingest, before the write; check whether Plano has the same; removing rows already in
production needs the owner's OK. Owner deferred it on 2026-11-18. The Ask eval keeps one
question (N03, Thanksgiving) that lands on these rows on purpose.

### List view uses a summer-time "midnight" all year · BUILD · found 2026-11-18 · **later**
`src/app/api/events/route.ts` treats midnight Central as UTC-5. In winter Central is UTC-6, so
every day boundary the list uses (where "today" starts, and the From/To date filters) falls at
11 pm the night before instead of midnight. Small, but it's a date-correctness bug. Owner deferred it on 2026-11-18.

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

### The fix, in one sentence · BUILD · **do this one**

**One cheap check at the start: does the database have the fields I am about to write?**
It would have failed in one second and cost nothing.

Instead the pipeline did all the expensive thinking first and saved at the very end. The save
failed, so it threw the thinking away and paid for it again the next night, and the next. Four
sources made that 48 cents a night. At forty sources the same failure is five dollars a night,
quietly, until somebody notices.

Where it goes: before the classifier pass in `src/lib/ingest.ts`, assert that every column the
upsert will write exists in the schema. It fits the existing guard style — a check that is *able*
to fail — and it is the cheapest item on this page relative to what it prevents.

The alternative, **expand-contract** (code tolerates a missing column until the migration lands),
is more standard and the right answer for a team. It is heavier here, where migrations are hand-run
on purpose, and it does not catch the *other* direction — a column misspelled in the code.

### Related bug found 2026-11-18 · BUILD
`src/lib/ingest.ts:977` overwrites a freshly-parsed `price_decided_by` with the prior row's value
on a cache hit, **even when the prior value is NULL**. So the `source-cost-field` and
`source-declared` values set at parse time are clobbered by a blank. Fixing this one line lets
those rows populate on an ordinary nightly run at zero cost and with no cache clearing. It is the
reason a run touching 571 rows populated 3.

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
