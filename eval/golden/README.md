# The golden set — committed on purpose

Three files, and the reason each is in git rather than on somebody's laptop.

| File | What it is |
|---|---|
| `events.json` | **Frozen inputs.** The exact title + description the classifier is judged on. Append-only. |
| `labels.json` | **Human ground truth.** What a careful reader concluded from that text. |
| `run-latest.json` | The most recent run's raw output, for diffing. |

## Why these are committed

An eval only one person can run is not a control, it is a habit. CI clones the repo; a
git-ignored answer key is an answer key CI cannot see.

The content is public civic event text from Frisco city sources plus our own judgments.
Nothing personal, nothing private.

## Why `events.json` is append-only

The first version of this eval read its inputs live from the database. On **2026-11-11** we
counted what was left of a 64-event set: **8**. Kaleidoscope's connector had been rebuilt, its
id scheme changed from `kaleidoscope-park-10000030` to `kaleidoscope-park-chalk-the-park-2026-11-07`,
and every unmatched row was purged. Play Frisco events had aged off the city feed. The
descriptions had never been copied anywhere.

**The labels survived. The questions they were answers to did not.**

The eval never complained. It skipped what it could not find and printed a score for the
remainder, which is the most expensive way a test can fail: it kept reporting.

So an id captured here is never re-fetched or refreshed. If the source changes its text, that
is a **new** event for eval purposes, not an update to an old one — otherwise a label quietly
becomes the answer to a question that was edited after the fact.

## `price: "unknown"` is a real label, not a missing one

It means a human read the same text the model reads and **could not determine the price**.
That third value is what separates *the model was wrong* from *the model asserted something
the source never contained* — see `EVALS.md` for how over-claim and under-claim are counted.
