# Ask Open Eventz — Grounded Q&A spec, v2 (MVP + later)

*2026-11-17. Replaces `02-product/Ask Open Eventz Grounded Q&A Spec.docx` (v1, 2026-11-06) as the
build spec. v1 stays as the record of the original design.*

*Updated 2026-11-18 after the UX prototype review: age range on the list card, city rule, screen
copy, the Ask box in scope behind a flag, and a cost estimate.*

## What changed from v1, and why

| v1 said | v2 says | Why |
|---|---|---|
| "Max cost" filter; check "every price … matches its record" | **There are no prices.** Only three price classes: `free`, `paid`, `unknown`. The only price filter is **free only**. | The catalog has never shown a dollar amount. `price_class` is the source of truth; `is_free` is derived from it. A model must never state an amount, and "cheap" or "under $10" can't be answered. |
| Cards and answers state "drop-off" | Drop-off is **not a stored field**. It's a per-source badge (`getSupervisionBadge`), and for three of the four sources it says "check with venue". | The answer never mentions drop-off. The list card stays as it is, with no drop-off badge. The parent sees the existing badge on the event's detail view. |
| "Indoor or outdoor" filter | Not in the MVP. | There's no indoor/outdoor field, so it can only be handled as fuzzy intent (see Later). |
| DeepEval suite, pytest, LLM-judge metrics as ship gates | A **TypeScript eval in `eval/ask/`** with **deterministic** scoring, in the same style as the classifier eval. An LLM judge is a later option, not a gate. | The stack is TypeScript, and DeepEval would add a Python toolchain plus a judge that needs calibrating first. Every MVP gate can be checked by code, which is stronger than a judge's score. |
| pgvector + embeddings in the MVP | Later. MVP retrieval = **hard filters in code, then the model picks from a short list**. | Anthropic has no embeddings model, so vectors need a second provider, a key and an ingest change. With a few hundred live events, a filtered list fits in one prompt. |
| "The site has no users yet" | Deleted. | The site has had real visitors since 2026-08-19. |
| ~60 eval questions | 20 for the MVP, 60 later. | The ship gate still comes before the build; the set is just smaller. |

## Problem

A parent thinks *"something free for my 4-year-old this Saturday in Plano"* and today has to turn it
into four filter settings. Ask lets them type the sentence and get **real catalog events**, with a
short answer that adds nothing the catalog doesn't hold.

**Honest status of the bet:** no production evidence says search is the bottleneck, and conversions
have been flat since August (BACKLOG #9). It ships behind a flag, and its value as a product is
measured, not assumed.

## The core design decision — the cards tell, the text frames

The answer text **states no facts**: no date, time, age, price class, place or drop-off rule. It's
one or two sentences that name events by title and say why they fit the question. Every fact the
parent decides on comes from the stored record. Ask reuses the **list view's event card** (date, time, place, price
badge, registration, age), including the ✦ "estimated" markers. The card's age chip changes for
the list view too: it shows the same age label the detail view shows ("Ages 0–5", "Ages 6–12 ✦"),
not only "Family". This reverses the v1.1 decision that ranges were detail-only (see
`02-product/open-eventz-v1.1-city-nav-age-inference-spec.md` §2). The drop-off badge stays on the
event's **detail view** only, one tap from the card.

Why: a fact the model never writes can't be wrong. The fact check then shrinks to two things code
can verify exactly: *every cited event was retrieved*, and *the text contains no fact-shaped tokens*.

## MVP flow (5 steps, 1 check)

1. **Parse.** Claude turns the question into JSON filters, given today's date in America/Chicago:
   - `date_from`, `date_to` (ISO dates)
   - `city`: `frisco` | `plano` | `both` | null. Null means the parent named no city, and the
     city tab they are on is used (see *City rule* below).
   - `free_only`: boolean
   - `age`: a single age or a range, or null
   - `intent`: free text, such as "trains" or "rainy day"
   - `out_of_scope`: boolean

   Anything it can't parse stays null and is never guessed. A price word other than "free" ("cheap",
   "under $10") sets `free_only = false` and adds the price note (wording under *Screen copy*).
2. **Validate the parse in code.** Dates can't be in the past and can't be more than 6 months out,
   `date_from ≤ date_to`, and ages fall between 0 and 17. If validation fails, fall back to
   asking without dates and say so. Never silently widen a constraint.
3. **Retrieve.** Load the **same visible catalog the list view serves**: the same kid-visibility
   gate, adults-only exclusion, ongoing multi-day events and age-bucket matching. Then apply the
   hard filters in code. City comes from `source`/`location_address`. `free_only` means
   `price_class = 'free'` only; `unknown` and `paid` never count as free. Keep the first 25 by
   start time. When the question covers both cities, keep up to 25 **per city**, so one busy city
   can't crowd the other out of the list the model sees.
4. **Select and frame.** Claude gets those ≤25 records (id, title, a description cut to about 300
   characters and passed through `visibleText()`, and a date label) and returns JSON:
   `{ answer, cited_ids[] }`, with at most 5 IDs. The prompt forbids stating any fact.
5. **Check, then show.**
   - Every `cited_ids` entry must be in the retrieved set.
   - The answer must contain none of the following: digits, `$`, `free`/`paid`/`cost`/`ticket`,
     weekday or month names, `today`/`tomorrow`/`weekend`/`morning`/`evening`, `drop`, `age`, and
     age words (`toddler`, `baby`, `preschool`, `teen`, `adult`). Age words matter as much as
     numbers: "perfect for toddlers" is an age claim with no digit in it.
   - **If either check fails, show the cards alone** (fail closed). If nothing was retrieved, show
     one line: *"Nothing matched. See all [Saturday] events in [Plano]"*, linking the matching
     filter view.
   - Always show the parsed filters above the result: *"Showing: Sat Nov 21 · Plano · free · age
     4"*. A confidently wrong parse is the one failure that produces no error, and showing it is
     the mitigation.
   - The disclosure line goes under every answer: *"Answers come only from events listed on Open
     Eventz. Check details with the venue."*
   - The word check applies to the **model's answer only**. Fixed screen copy (the price note,
     the redirect, the disclosure) is written by us and may say "free" or "paid".

### City rule (decided 2026-11-18)

- **No city named:** search the city tab the parent is on. On the Frisco tab, Frisco results
  only; on the Plano tab, Plano results only.
- **One city named:** search that city, even if the parent is on the other tab. The "Showing"
  line names it, so a parent on the Frisco tab sees "Plano" and knows why.
- **Both cities asked for:** search both. Cards for the city tab the parent is on come first, then
  the other city, each group in start-time order. The "Showing" line says "Frisco + Plano".
- Where the parse can't tell, it leaves `city` null and the tab decides. It never guesses "both".

### Screen copy (approved 2026-11-18)

| State | What the parent sees |
|---|---|
| Empty | The "Ask about events" box above the list. The example lives inside the box as greyed placeholder text ("e.g. something for my 4-year-old this Saturday"). **No list of example questions underneath.** |
| Answer passed | "Showing" line, the one-to-two-sentence answer, up to 5 cards, the disclosure line. |
| Check failed | "Showing" line, the cards, the disclosure line. No answer sentence and no error message. |
| Nothing matched | "Showing" line, then: *Nothing matched. See all [Saturday] events in [Plano]*, with the link opening that filter view. |
| Off-topic | One line, nothing else: *'Ask' only answers questions about events listed on Open Eventz. Try something like "things to do in Plano this Saturday".* |
| Price note | Shown above the answer when the question uses a price word other than "free": *Open Eventz only knows whether an event is 'free' or 'paid'. Please look at the details view.* |

### Feature flag (decided 2026-11-18)

The Ask box is **behind a flag, off by default**. With the flag off, the list view looks and
behaves exactly as it does today and `/api/ask` refuses requests. It is turned on locally for the
demo, and in production only after the eval gates pass and the owner says so.

**Model:** the same `claude-sonnet-4-6` the classifier uses, so the MVP has no new model to judge.
Moving the parse step to Haiku is a later cost decision, made with this eval.

**Known limit of the word check:** it blocks fact *words*, not wrong *meaning*. "Great for little
ones" slips through. It's an accepted gap for the MVP, since the card beside it shows the real age
range. The eval's tricky age questions are there to show how
often it happens.

## Guardrails (MVP)

| Risk | Guardrail | Fails to |
|---|---|---|
| Invented event | Cited IDs ⊆ retrieved IDs | Cards only |
| Invented or wrong fact | The text may hold no fact-shaped tokens; facts render from the record | Cards only |
| "Free" claimed for paid/unknown | `free_only` = `price_class = 'free'` only; the text can't say "free"; inferred-free cards keep "Free ✦" | — |
| Adult event for a kids' query | Retrieval reuses the list view's gate. **Extract it into a shared function, not a copy.** | Excluded |
| Wrong parse (dates, age) | Validation in code + parsed filters shown to the parent | Visible to the parent |
| Prompt injection in event text | Descriptions passed as data through `visibleText()`, JSON-only output, both checks above | Cards only |
| Personal data in questions | MVP logs nothing. Later: question text only, no IP or user ID, 30-day retention | — |
| Runaway cost | Max 2 model calls per question, an output-token cap, a daily ceiling of **100 questions (200 calls), about $2 a day**, approved by the owner 2026-11-18 (same idea as `llm-budget.ts`) | Filter view |
| Unmeasured release | Behind a flag, off in production until the gates below pass | — |

## MVP eval — written before the build

`eval/ask/`, with the catalog **frozen** to a snapshot (`catalog-snapshot.json`) so results don't
drift with the nightly ingest. Retrieval is a pure function over an event list, so the eval runs
it against the snapshot and production runs it against the live catalog. It's the same code.

**20 questions**, labelled blind with the expected filters and the event IDs a careful person would
cite:
- 10 answerable
- 5 with no match (refusal cases)
- 3 tricky on price or age, e.g. "free" where the event is `unknown`, or "toddler" against a family
  event
- 2 off-topic

Each question also records **which city tab it was asked from**. At least two of the 10
answerable questions test the city rule: one names the other city, one asks for both.

| Gate | Threshold | Blocking? |
|---|---|---|
| Cited ID not retrieved | 0 | Yes |
| Answer text containing a fact token | 0 (should be caught by the check; counted before the fallback) | Yes |
| `free_only` question returns a non-`free` event | 0 | Yes |
| No-match question returns events or a drafted answer | 0 | Yes |
| Off-topic question gets anything but the redirect | 0 | Yes |
| City rule broken (wrong city searched, or a both-cities answer that doesn't put the current tab's city first) | 0 | Yes |
| Parse accuracy (filters match the labels) | Record the first run; set the bar after | No |
| Recall of labelled IDs | Record the first run; set the bar after | No |

Per run, also record the model calls, tokens in and out, and cost per question.

**Cost estimate, before measuring (2026-11-18).** Two calls per question on `claude-sonnet-4-6`
($3 per million input tokens, $15 per million output): the parse call is about 800 tokens in and
150 out, and the select call about 3,500 in (25 short event records plus instructions) and 200
out. That is roughly **$0.02 per question**, **$0.40 per 20-question eval run**, and **$2 a day**
at a ceiling of 100 questions. The first eval run replaces these guesses with measured numbers.

The first run is measured and written to `eval/ask/RUN-LOG.md` **before anything is tuned**,
including what failed and why.

## MVP backlog (about 3 hours)

1. **Eval first (45 min).** Snapshot the catalog, write and label the 20 questions, commit the gates.
2. **Shared catalog loader (30 min).** Move the events-route gate and filtering into one function
   that both the route and Ask call. Existing tests must still pass.
3. **Parse + validate (30 min),** with unit tests for date and age validation.
4. **Retrieve + select + check (45 min),** with unit tests for both checks and the fallbacks.
5. **Run the eval and log it (30 min).** `npm run eval:ask`, results in `RUN-LOG.md`.

6. **Ask box behind a flag (in scope as of 2026-11-18).** An `/api/ask` route plus the box above
   the list, using the screen copy and city rule above. Flag off by default.

Before any of this: **0. List card shows the age range** (done on branch `ask-open-eventz`,
2026-11-18), so the card beside an answer carries the real age.

**Done when:** `npm run eval:ask` runs on the frozen snapshot, prints the gates, a deliberately
broken prompt (one told to state dates) is caught by the check and fails the eval, and with the
flag off the list view is unchanged.

## Later (in order)

1. **UI in production behind a flag,** with GA4 events (question asked, answer shown, fallback
   shown, card clicked) and the North Star read: does Ask lead to intent actions at a different
   rate than browsing?
2. **CI gate:** run `eval:ask` on changes to the Ask prompt, model ID, retrieval or check code, the
   same way `classifier-eval.yml` works.
3. **Vector search for intent** ("trains", "rainy day", "indoor"): pgvector in Supabase, embeddings
   written by the ingest and deleted on cancellation. Vectors rank only **within** the hard-filtered
   set; dates and price class are never left to similarity. Trigger: the filtered list stops
   fitting in one prompt, or recall on intent questions misses the bar.
4. **Fact-bearing answers,** where the text may state a date or price class, each verified
   field-by-field against its record. Only if parents show they need it.
5. **Eval to 60 questions,** plus an optional LLM judge for answer relevance and refusal tone,
   hand-checked on 10 verdicts per run before it's trusted.
6. **Model card and decision-log entry** per release; add the Ask controls to the GUARDRAILS
   catalogue.

## Out of scope

Chat memory, accounts, booking or calendar writes, questions outside the catalog (weather,
directions, parenting advice), and dollar amounts of any kind.

## Resume and interview

Until the MVP is merged **and** the first eval run is logged, the honest claim is *"specced, eval
set written first, in build."* After that: *"built the grounded Q&A core: hard filters, model
selects only from retrieved records, a fail-closed citation and fact-token check, and a 20-question
eval written before the build."* Don't claim pgvector, DeepEval or "launched" until each one is true.
