# Evals — what they are, what ours found, what it cost

*Date: 2026-08-23. Companion to `GUARDRAILS.md` (the runtime controls) and `PRICE-AGE-REDESIGN.md` (the change this eval gates).*

*Written to be read start to finish by someone with no background in evaluation. Every claim is backed by the 64 hand-labelled events in `eval/`.*

*Per-run results live in `eval/RUN-LOG.md` — this document is the method, that one is the record.*

---

# Part 1 — General

## What is an eval?

Four things, and nothing more:

1. **A fixed set of inputs** — real examples, frozen so they don't change between runs
2. **Known-correct answers** — decided by a human, before seeing what the system says
3. **A scoring rule** — how a disagreement gets counted
4. **A decision rule** — what result means ship, and what means stop

Miss any one and it isn't an eval. Inputs without answers is a test set nobody graded. Answers without a decision rule is a number nobody acts on.

## What is the intent?

**To turn "is this any good?" from an opinion into a measurement — and specifically, to know whether a change helped or hurt before a user finds out.**

The secondary intent matters as much: to learn what the system is bad at, in enough detail to do something about it.

## How is an eval different from a guardrail?

| | Guardrail | Eval |
|---|---|---|
| **When it runs** | every event, in production, unattended | when you're about to change something |
| **What it changes** | the **output** | your **decision** |
| **How it fails** | silently — it cannot tell you it is wrong | loudly — that is its whole job |
| **Question it answers** | "should this output reach a user?" | "how good is this, and did my change help?" |

They are not alternatives. **An eval is how you find out whether a guardrail works, and whether it is worth its cost.**

Concretely: the keyword downgrade rule is a guardrail. When the model answers "free" purely by assumption *and* the description contains a word like "workshop", the rule overrides it to `unknown` — meaning the event shows with **no Free/Paid badge at all**.

Running it in production tells you nothing about whether it is doing the right thing, because **"no badge" looks identical in both cases**: whether the event really was paid (the rule just prevented a wrong "Free") or really was free (the rule needlessly stripped a correct one). No error, no log line, no complaint separates them. The rule is **silent by construction**.

**Only an eval can settle it**, because the right answer was established independently first. Ours found the rule fires on **6 of 38** Play Frisco events: on 5 the labeller also could not determine an answer, so withholding was correct; on 1 (*Frisco Camp Out*) the labeller determined **paid**, so withholding was over-cautious — the badge should have read "Paid". The rule's *direction* is defensible throughout. Its defect is that it fires on **vocabulary**, so two events with identical evidence get different treatment depending on whether the word "workshop" appears.

---

# Part 2 — Current

## What is the current logic?

> **Terminology.** The product never displays a price. Every classification resolves to a
> three-state badge: **Free**, **Paid**, or **nothing**. Even a `Cost:` field reading `"$25"`
> is stored and shown as **Paid** — the amount is discarded, and the prompt forbids the model
> from returning one. Throughout this document, "withholding" means showing no badge, never
> hiding an amount.


| Step | Who decides | Deterministic? | Status |
|---|---|---|---|
| 1. Read the structured `Cost:` field | scraper | yes | **keep** |
| 2. If absent, model reads title + description | model | no | keep, but change what we ask for |
| 3. Downgrade "assumed free" if one of 12 words appears, or registration is required | code | yes | **remove** |
| 4. Display: `free`/`paid` → a **Free** or **Paid** badge; `unknown` → **no badge**; inferred → ✦ | code | yes | keep |

## What are the challenges with it?

### 1. The product policy is fused into the prompt

The prompt tells the model two things at once:

1. Read the text and report what it says about price
2. If it says nothing, answer "free" — *"this is a city Parks & Recreation calendar, such events are FREE in the overwhelming majority of cases"*

You get back **one answer that blends both.** You can see the blend in the model's own reasoning: *"no price is mentioned, so it defaults to free per community-event convention."* That single sentence contains a factual observation and a business decision.

**What "neither can be measured or changed independently" means, and why it matters:**

- **You cannot measure the model's reading ability.** When it answers "free", you cannot tell whether the text said free or the model applied the assumption. Reading and assuming are mixed into one output, so a score covers both and isolates neither.
- **You cannot change the policy without editing the prompt** and re-classifying every event. A business rule that ought to be a one-line switch is instead buried inside instructions to a model.

**Decision taken: remove "community events default to free" from the prompt.** The model reports what the text says. Code decides what to do when the text says nothing. That one change makes both halves measurable and makes the policy a switch instead of a rewrite.

### 2. Rules that outlived their purpose

The keyword downgrade was written when keywords were the *primary* classifier. Once the model took over, the rule stayed on as a second, cruder classifier arguing with the first — twelve words versus something that read the whole description.

**Decision taken: remove the keyword downgrade.**

### 3. One confidence score doing two jobs

The model returns one confidence number. The prompt defines it in terms of **age**: *"high = the age range was explicitly stated, or the event clearly uses family/child language."*

But the code uses that same number for two unrelated decisions:

1. Should we show an age badge?
2. Should this event appear on the site **at all**?

So an event that is obviously for children but vague about *which* ages gets a lowish score — and **disappears entirely**. You deleted an event because you were unsure about its age.

**The fix:** two scores — one for "is this for children", one for "how precise is the age". Same call, same cost.

### 4. No evidence

Everything above was **argument, not measurement.** That free-by-default is safe, that the keyword rules help, that the confidence gate protects parents — nobody had ever compared the system's output against a known-correct answer.

**Why that matters:** an unmeasured system can be wrong for months with nothing telling you. And when you change it, you cannot tell a good change from a bad one.

**The implication in practice:** we were one commit away from deleting four rules on a chain of reasoning that turned out to be wrong at the first link.

---

## What approach did we take?

### Sampling — two methods, each used where it fitted

| Source | Population | Method | Why |
|---|---|---|---|
| Play Frisco | 38 | **census** (all 38) | purged nightly, so 38 *is* the population. Sampling would have saved 8 minutes and bought a permanent "how did you pick?" argument. |
| Kaleidoscope | 106 | **random 30** | labelling 106 is not worth it. Ordered by a fixed hash rather than a random number generator, so the same 30 regenerate identically and the sample is reproducible. |

Two labels per event — `KID` (yes/no) and `PRICE` (free/paid/unknown) — plus `ALSO-OK` for genuinely borderline cases and a free-text `NOTE`. Labelled blind: the system's own answers were kept in a separate gitignored file so they could not anchor the labeller. The rules were written and frozen **before** labelling began.

64 of 68 were labelled.

### The scoring rule

**We did not use accuracy as the headline.** Accuracy would be one number: how often did the system agree? Here that is 45 of 64, or 70%.

Instead, every disagreement is classified by **direction**:

| System says | Label says | Called | Consequence |
|---|---|---|---|
| free | paid | **wrongly-free** | a parent arrives with no money — **trust event** |
| paid | free | wrongly-paid | a parent skips a free event — coverage loss |
| free/paid | unknown | **over-claim** | asserted with more confidence than the evidence supports |
| unknown | free/paid | under-claim | withheld something that could have been shown |
| same | same | agree | — |

**Why not accuracy.** The rows are not equally bad. One strands a family at a gate; another is a mild annoyance. Accuracy adds them together as if they were the same thing.

Worse, **a single number lets errors cancel.** Imagine a change where:

- 5 events that showed no badge now correctly show "Free" — *5 improvements*
- 5 events that were right now say "Free" when they are paid — *5 dangerous errors*

Accuracy does not move. 70% before, 70% after. **The number says "no change" while you have just introduced five ways to strand a family.** Direction counts make that impossible to miss.

| | What it tells you | What it hides |
|---|---|---|
| Accuracy: "70%" | roughly how often it agrees | *which* 30% — and whether any of it is dangerous |
| Direction counts | exactly which failure modes occur, and how often | nothing relevant to the decision |

**Is dropping accuracy good or bad?** Good *for this problem*. Accuracy is perfectly fine when every error costs the same. Here they do not, by a wide margin. Alternatives would be precision and recall per class, or a weighted score where dangerous errors count more. Direction counts are the simplest option that respects the asymmetry.

**The `ALSO-OK` line** exists because some events genuinely have two defensible answers. If we force one, the system gets marked wrong for choosing the other defensible one. Recording "unknown is right, but free would not be wrong" stops the score being polluted by cases where the labeller was not sure either.

### The decision rule

**Who set it:** proposed and written into `PRICE-AGE-REDESIGN.md`, then committed, **before labelling began**. Not formally signed off by the product owner — it was raised, not objected to, and then acted on. The property that matters is only that it was fixed before the results were known.

That order matters — writing the pass/fail rule *after* seeing results is how people accidentally pick whichever rule their change happens to pass.

**Is there a standard?** Not for the specific numbers — a decision rule encodes what a particular product can tolerate, which is always local. What *is* standard is the shape: **pick one blocking metric tied to your worst outcome, make everything else informational, and write it down first.** Wrongly-free was chosen because the product rule already named it: *a wrong value is worse than a missing one.*

**What we wrote before labelling:**

- Ship if **wrongly-free = 0** and the share of events with no badge drops from 16%
- Revert if wrongly-free moves off zero

**How the three actually performed:**

| Criterion | Outcome |
|---|---|
| Wrongly-free = 0 | **Worked.** Clean and decisive; the one that survives into the revised gate. |
| Suppression rate (share with no badge) drops from 16% | **Wrong criterion.** It assumed the system was too cautious; the data showed the opposite, so it would have rewarded the wrong behaviour. |
| Missed adults = 0 (system shows an event the human calls not-for-children) | **Untestable.** The sample contains no adult events, so it could never be evaluated. |

**One of three worked.** That is the honest yield, and it carries two lessons. Writing a decision rule in advance does not guarantee it is a *good* rule — it guarantees you can *tell* when it was not, which is exactly how the second one's false premise got caught. And **a criterion you cannot evaluate is worse than no criterion**, because it reads as passed coverage: "missed adults = 0" looks like a cleared check unless you notice the sample had nothing to catch.

**What it should be now:**

| Tier | Criterion | Why |
|---|---|---|
| **Blocking** | wrongly-free = 0 | Not a threshold to tune — see below |
| **Blocking** | over-claim count must not increase | This is where an undetected wrongly-free would hide |
| **Informational** | agreement rate, under-claim count | Reported, never gating |

**Why wrongly-free is "zero", not a threshold.** The entire safety story is: *when the model is unsure, something catches it before a parent sees it.* Everything follows from that — it is why an accuracy figure was never needed, why suppression was considered enough, why manual evaluation was defensible.

One wrongly-free proves that story false: the model was confident, it was wrong, and nothing caught it. That is not one bad data point among many — **it removes the reason you believed the rest was safe.** So you cannot say "I will act on the third one". After the first, you no longer know what the rate is, and you never did.

**Why counts rather than percentages.** With 64 events, **one event is 1.6%**. "A 4% error rate" means somewhere between 2 and 3 events; two borderline judgments going the other way makes it 6%. The number swings on coin-flips.

But *"did a wrongly-free ever occur?"* is a yes/no question, and zero is zero at any sample size.

> **Small samples can answer existence questions, not rate questions. So gate on existence.**

---

## How did it help resolve those problems?

### It corrected a wrong premise before it shipped

**In plain terms.** Before any labelling, I noticed that 6 of 38 Play Frisco events showed **no Free/Paid badge at all**. I assumed the keyword rules caused it, and that this was bad — real events losing a correct "Free" badge for no reason. So I set a goal: *make that number smaller*, and wrote it into the ship criteria.

*(Worth being clear about provenance: that goal was mine, not the product owner's. The ask was for **simplicity**. I added a coverage-recovery benefit on top and turned it into a success criterion.)*

**What the labels showed:**

| Direction | Count |
|---|---|
| System withholds where an answer was determinable (*under-claim*) | **2** |
| System asserts more than the evidence supports (*over-claim*) | **17** |

The system is not too cautious. **It leans the other way, by roughly eight to one.** Deleting the downgrade rules would have pushed harder in the direction the data says is already wrong — and the ship criterion I wrote would have *rewarded* that.

| | Before the eval | After |
|---|---|---|
| Believed problem | rules too conservative | system too confident |
| Planned change | delete 4 rules | still delete, but replace with something stricter |
| Ship criterion | share with no badge drops | over-claim count does not rise |
| Evidence | none | 64 labelled events |

### It corrected a second claim — this one about the labels themselves

An earlier draft said *"47 events had a price stated by the source."* Checking that showed it was false. What was actually measured was "the labeller could reach an answer".

| How each answer was reached | Count |
|---|---|
| A `Cost:` field on the page gave it | **1** |
| **Judged from the text** | **41** |
| Could not tell | **22** |

Zero of the 37 "free" labels came from a Cost field, and several say so outright: *"no explicit free or paid signal. But this is a community clean-up event and normally those would not be paid"* · *"leaning towards free"* (×5).

**This changes the conclusion materially.** The labeller was doing the same thing the model does — judging from context. The line was simply drawn in a different place.

| | Earlier claim | Corrected |
|---|---|---|
| The disagreement | system asserts without evidence; human has evidence | **both judge; they disagree on how much signal is enough** |
| The implied fix | stop asserting | **decide where the bar sits** |

**Consequence:** the choice is not between guessing and not guessing. It is a threshold. Which makes a confidence score the obviously right mechanism rather than a compromise.

### It quantified the product decision

Every event falls into one of two groups:

- **42 events** — an answer was reachable (mostly by judgment, occasionally from a Cost field)
- **22 events** — even after opening the page, nothing supported an answer

For the first group the eval settled that the system works: **zero wrongly-free, zero wrongly-paid.**

For the second group, no amount of model improvement helps. The model cannot extract what is not published. So the question was never "classify better" — it is **"what do we display when the source is silent?"**

| | A — say Free | B — say nothing | C — say Free above a confidence bar |
|---|---|---|---|
| Events showing a Free/Paid badge | 64/64 | 42/64 | between |
| Assertions beyond the evidence | 17 | 0 | the bar decides |
| Known-wrong today | 0 | 0 | 0 |

**Today is A**, except that on 6 of the 17 the keyword rule happens to pull back — depending on whether the description contains "workshop", "camp" or "class". Two events with identical evidence get different treatment based on unrelated vocabulary. **That arbitrariness is the real defect**, not the direction.

**Should over-claim be zero?** No. Zero over-claim is Option B — never assert unless the source states it outright. Given only **1 of 64** events had hard evidence, that means showing no badge on almost everything. Unusable. The honest target is to **decide where the bar sits and then stop it drifting**, which is what the "must not increase" criterion does.

### It found a real defect, and disproved one I had promoted

| | Notes mentioning it | Actually changed a price decision |
|---|---|---|
| Missing bullet lists | 7 | **0** |
| Uncaptured `Link` field | 6 | **2 decisively** |

The scraper extracts only `<p>` tags, discarding bullets and headings — verified live (416 characters stored against 651+ on the page, cut mid-sentence). But **that turned out not to matter for price**: three of the seven had a Cost field anyway, and the rest did not change an answer. It may still matter for kid-relevance, where dropped text like *"breathwork and affirmation ritual"* is decisive.

The `Link` field is real but smaller than claimed:

- **2 events** — the link label literally reads "Buy tickets" / "GET TICKETS". Decisive, and free to capture.
- **2 events** — "Register here". Ambiguous; by policy we show nothing anyway. Resolves nothing.
- **2 events** — the price was only findable by *following* the link to another page. **Decision taken: these resolve to `unknown`.** No second crawl.

So capturing the Link field resolves **2 of 22**. Worth doing, but not the priority I had made it.

### It reported honestly what it could not answer

The sample contains **no 21+ events**. The three `KID: no` labels are vendor applications, a reception, and a vendor market. So "zero missed adults" is true and meaningless — like testing a smoke alarm in a room with no smoke. **The adults-only word check cannot be deleted on this evidence.**

---

## What did it cost?

| | |
|---|---|
| Labelling time | ~90 minutes |
| Model spend | a few cents |
| Infrastructure built | none — one markdown worksheet, one JSON baseline, a throwaway script |
| Analysis time | the bulk of the cost, and the part that would need automating to repeat cheaply |

## What benefits have we realised?

| Benefit | Concrete |
|---|---|
| Prevented a mis-ship | 4 rules not deleted on a false premise |
| A safety claim with evidence | 0 wrongly-free, 0 wrongly-paid across every determinable event |
| A product decision quantified | 22 events, three priced options |
| A real defect found | uncaptured Link field — 2 events decisively resolvable |
| **A defect disproved** | the missing bullets, which had been wrongly promoted to first priority |
| **A framing corrected** | "system asserts without evidence" → "both judge, they disagree on the threshold" |
| A written justification | so the deletions read as evidence-based later, not careless |

The last three matter as much as the first four. **An eval that only confirms your hypotheses is not measuring anything.** This one contradicted its author three times.

---

## What are the challenges with the eval we built?

### 1. Too small for a percentage

With 64 events, **one event is 1.6 percentage points.** Quote "70% accurate" and two borderline calls going the other way makes it 67%. Nobody can act on that difference, and the figure implies a precision the sample cannot support.

> **Mitigation:** report counts by direction, never a percentage. *"Zero wrongly-free across every determinable event"* is fully supported by 64 items. *"70% accurate"* is not.

### 2. Point-in-time

Play Frisco is purged and rewritten nightly, so the census is complete for **one night**, not for the source. In three months it is a different 38 events, and an August set under-represents winter programming, which has a different price profile.

> **Mitigation — the drift check.** Freeze this set as the yardstick; its value comes from not moving. In ~3 months, label **15 fresh events** the same way and compare three things:
>
> | Check | Looking at | Action |
> |---|---|---|
> | Did the mix change? | share of free / paid / unknown labels vs the original | a large shift means the old set no longer represents reality → rebuild it, and note old scores are not comparable |
> | Is wrongly-free still zero? | the blocking metric | if not, stop and investigate immediately |
> | Any new *kind* of disagreement? | are the failures the same shape as before? | a new shape means something upstream changed |
>
> If only the mix has moved, rebuild. If wrongly-free moved, act now. If neither, keep the frozen set.

### 3. No adult events

> **Mitigation — a deliberate stratified sample.** Instead of drawing at random, go and find **10–15 events that are adults-only** — 21+, wine tastings, adult fitness — from anywhere in the sources. Label them. Run the model on them with the word-check disabled and see whether it catches them unaided. Fifteen minutes, and the only thing that can settle it. **The only way to test a detector is to give it things to detect.**

### 4. Built on truncated input

The worksheet showed the *stored* description, not the page. Both labeller and model worked from the same incomplete text — methodologically consistent, but it means the labels describe a system fed partial data.

> **Mitigation:** now known to be immaterial for price (0 decisions changed) and possibly real for kid-relevance. Re-check the age labels after the capture fix; leave the price labels alone.

### 5. One labeller

No way to separate a genuine ambiguity from one person's idiosyncrasy. The nine events labelled kid-appropriate that the system hides — *Artist-led Watercolor ×3, Calligraphy, Greeting Cards, Cycle the City, Call for Art, Reception "The Shape of Now", Kaleidoscope Live Concert Series* — could be a model failure or a definitional difference. With one labeller there is no way to tell.

> **Mitigation:** re-label 10 items cold in a few weeks, or have someone else label 10, and compare. The disagreement rate is the honest measure of how sharp the labels are.

*(Those nine also surface an unanswered product question: **is Open Eventz a directory of events **for** children, or of events a family **can attend**?** The model enforces the narrow reading because the prompt happens to say so, not because anyone decided.)*

### 6. Not automated

**Today:** after a change, a person opens a table of 64 rows and forms an opinion about whether it looks better. That needs a human, so it cannot run automatically.

> **Mitigation:** once the scoring emits five numbers — wrongly-free, wrongly-paid, over-claim, under-claim, agree — a computer can compare before against after and apply a written rule: *fail if wrongly-free > 0, or if over-claim increased.* No interpretation required. **That is what makes it possible to run in CI on every prompt or model change** — and it is the actual blocker today, not effort.

### 7. It counts instances, not events

A recurring series occupies one slot per date. *Parks For Pollinators* runs five times, so it
takes **5 of the 64 slots** and gets five votes on every score. The over-claim baseline reads
**12 instances**, which is only **8 distinct events**.

Per-instance measures what a parent experiences — a wrong badge appearing on five listings.
Per-distinct-event measures what the model actually judged — it made *one* decision that got
copied to five dates.

> **Mitigation:** for a ship gate about model quality, score **per distinct event**. Keep
> per-instance as a separate view when the question is user exposure. Decide which before the
> next run, not after.

### 8. One field of the worksheet failed completely

`ALSO-OK` existed for exactly the borderline case — *"unknown is right, but free wouldn't be
wrong."* **It was used zero times out of 68.** The labeller expressed that precise judgment
**eight times** — all of it in the free-text `NOTE` field instead.

The field wasn't a bad idea; the instruction was. **People write prose, not structured fields**,
especially mid-flow at sixty seconds an item.

> **Mitigation:** drop the separate field and ask for the lean inline — `PRICE: unknown (leaning
> free)`. Same information, nothing extra to remember, and machine-readable instead of something
> that has to be parsed out of sentences afterwards.

---

## What comes next: evaluating the *confidence score*, not just the answer

The redesign adds a **price confidence score** from the model. That changes what the eval has to
measure, and it is worth understanding before it lands.

**Today the eval asks one question:** is the answer right?
**With a confidence score it must ask two:** is the answer right, *and is the confidence honest?*

A model can be right and overconfident, or right and underconfident. **A confidence score that
does not track correctness is worse than no score at all**, because decisions would be gated on
a meaningless number. The technical name for "does the confidence track correctness" is
**calibration**.

### The awkward part

Checking calibration properly needs *errors* to exist — you compare how often high-confidence
answers are wrong against how often low-confidence ones are. This system made **zero** errors on
the determinable events. No errors, no variance, nothing to correlate.

### But one test is available immediately, and it is a good one

There are **22 events where a careful human, with the page open, could not determine an answer.**
Run the new prompt and look only at what confidence it reports on those:

| Result | What it means |
|---|---|
| mostly **low** | The score tracks evidence. It is honest. Proceed. |
| mostly **high** | It is measuring something else — most likely fluency. **Stop.** Do not gate on it. |

That test costs a few cents, it exists **only because the labelling was strict**, and it should
run **before** any rule is deleted on the strength of the new score.

### And then the product question becomes arithmetic

Once every event carries a confidence value, *"what do we show when the source is silent?"* stops
being a matter of taste. For each possible cutoff you count: how many badges shown, how many
withheld that a human could actually have determined, and how many wrongly-free remain. Read down
the table and pick the row you can live with.

**That is the payoff of the confidence score for the eval** — a question nobody could previously
answer becomes one you read off a table.

---

# Part 3 — The lessons

**1. The notes were worth more than the numbers.** The scores said the system was behaving. The labeller's free-text observations said *why*, and what to do — the truncated bullets, the uncaptured Link field, the consistent lean toward paid on anything called a workshop. None of that appears in a confusion matrix. Most eval tooling optimises for the metric and discards the commentary; at this scale that is backwards.

**2. The eval's job was to prevent a change, not validate one.** It was built expecting to hear *"your simplification is safe, go ahead."* It said *"your simplification is aimed at a problem you do not have."* That is the more valuable outcome, and it is the test of whether an eval is real: **if it can only ever agree with you, it is not measuring anything.**

**3. Separate the factual question from the product policy.** "Community events default to free" living inside the prompt made both the fact and the policy unmeasurable — one answer containing an observation and a business decision. **Ask the model what the text says. Decide in code what to do about it.**

**4. Sample where the decision lives.** Controls exist to catch **rare** things — that is why you build them. Random samples contain rare things **rarely**. So random sampling systematically fails to test exactly the controls you most want tested. The 21+ check guards against adult events; a random draw from a children's catalogue contains almost none. **Get over it by sampling the rare category on purpose, and scoring it separately.**

**5. Score by direction, gate on counts.** Score by direction so a trust-burning error can never be cancelled out by a harmless one inside a single average. Gate on counts because at 64 events a percentage is not stable enough to hang a decision on, while "did this ever happen" is.

**7. Strict labelling made the set more useful, not less.** The labeller refused to guess —
answering `unknown` on 22 of 64 events rather than calling them free on instinct. That felt like
a weaker answer sheet. It was the opposite. Loose labelling ("feels free, call it free") would
have agreed with the model nearly everywhere, produced a flattering score, and taught nothing —
and the boundary between *"the source says"* and *"we are guessing"* would have stayed invisible.
**By refusing to guess, the labelling produced a map of where answers exist**, which is what
turned an unresolvable argument into a decision with a number attached.

**6. An eval script is code, and can be wrong.** Two real errors in this analysis:

> **Example 1.** The baseline file did not include the `kid_relevant` field. So when labels were compared against the system's answers, the system's side was **empty for every row**. Empty never equals "yes" or "no", so it reported **zero disagreements** — a perfect score, produced by comparing against nothing.
>
> **Example 2.** A pattern meant to find the word "workshop" was mis-escaped and searched for an invisible control character instead. It matched nothing, so the conclusion was that the keyword rules never fire on any live event. **The opposite was true** — they fire on all six.

Both are the failure the freshness incident already taught: *a check you have never seen fail is not a check.* **Before trusting a scoring script, feed it a case where you already know the answer.** One line — *does this find "workshop" in "Artist-led Workshop"?* — would have caught both immediately.

---

# Appendix — decisions taken during this review

*The full design, with the reasoning behind each, is in `PRICE-AGE-REDESIGN.md`. This is the index.*

## Settled

| # | Decision |
|---|---|
| 1 | **Kid-relevance means "would a parent plausibly choose this as something to do with their child?"** — general-audience events a family would attend are **in** |
| 2 | Excluded: adults-only by rule · adult-focused by content · things that aren't events |
| 3 | **No age badge in the list view** — age drives filtering only; the badge is detail-view |
| 4 | **Visibility gated on kid-relevance confidence**, not age confidence |
| 5 | Age at **high/medium** → specific buckets. Age at **low, or absent** → family fallback |
| 6 | `Family` when the source says so, `Family ✦` when we worked it out |
| 7 | Price order: **`Cost:` field → Link field → model** |
| 8 | Link label "Buy tickets"/"Get tickets" → paid. "Register"/"Sign up" → show nothing |
| 9 | A price findable only by following a link to another page → `unknown`. No second crawl |
| 10 | **Add a real price confidence score and delete the 12-word rule** — not both |
| 11 | **Delete** the keyword placeholder and `price_text` — both dead code |
| 12 | **Remove "community events default to free"** from the prompt |
| 13 | **Keep the `21+` word check for now** — deleting it is untestable without an adult sample |
| 14 | **Strike the "no-badge rate should drop" ship criterion** — the source controls that number, not the system |

## Still open

| # | Question | Answered by |
|---|---|---|
| A | Where the withhold threshold sits | the threshold table, once the new prompt has run |
| B | Whether `Family ✦` should distinguish "judged family" from "fell back to family" | product judgment |
| C | The adult-event sample needed to settle the `21+` check | 15 minutes of deliberate labelling |
| D | Score per instance or per distinct event | decide **before** the next run, not after |
