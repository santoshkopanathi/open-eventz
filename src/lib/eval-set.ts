/*
 * GOLDEN SET — the frozen inputs and the human ground truth.
 *
 * Why a module and not just two JSON files: the one property that makes an eval worth
 * running is that the INPUTS NEVER CHANGE. On 2026-11-11 we learned what the absence of
 * that property costs — 56 of 64 labelled events had been purged from the database and
 * their description text existed nowhere else, so the labels survived and the questions
 * they were answers to did not. The set was 87% dead and still printed a score.
 *
 * So: `freeze()` is append-only and refuses to rewrite an event it has already captured,
 * and everything downstream reads the frozen copy. The database is a source of CANDIDATES
 * for the set, never the set itself.
 */
export type PriceLabel = 'free' | 'paid' | 'unknown'
export type KidLabel = 'yes' | 'no' | 'unknown'

/** An input, captured once. `description` is the whole point — it is what cannot be recovered. */
export interface FrozenEvent {
  id: string
  source: string
  title: string
  description: string
  start_datetime: string | null
  /**
   * Frozen because the PRODUCTION price rule reads it: resolvePriceClass downgrades an
   * inferred free to unknown when registration is required. An eval that omitted it would
   * test the model but not the pipeline, and the pipeline is what a parent sees.
   */
  registration_required: boolean
  captured_at: string
}

/** A human judgment, made by reading the frozen text above. */
export interface Label {
  id: string
  /** Is this event for children at all? Drives whether it is shown. */
  kid: KidLabel | null
  /**
   * `unknown` is NOT a missing label. It means: a careful human read the same text the
   * model reads and could not determine the price. That third value is what separates
   * "the model was wrong" from "the model asserted something the source never contained".
   */
  price: PriceLabel | null
  note?: string
  /** Where this judgment came from, so a re-label can be told from an original. */
  labelled_at?: string
  /**
   * Every change to this label, in order.
   *
   * A golden set whose answers change without trace is not ground truth — it is an opinion
   * with a timestamp. The eval exists to argue with the model, so when the HUMAN side of the
   * argument moves, the move has to be inspectable: what it was, what it became, and the
   * reason given at the time.
   *
   * It also guards the failure this project worries about most. The cheapest way to turn a
   * red gate green is to edit the answer key, and that edit is indistinguishable from a
   * genuine correction unless the reason is recorded next to it.
   */
  revisions?: LabelRevision[]
}

export interface LabelRevision {
  date: string
  field: 'kid' | 'price'
  from: string | null
  to: string | null
  /** Why, in the labeller's own terms. An empty reason is not acceptable. */
  why: string
}

export interface GoldenSet {
  events: FrozenEvent[]
  labels: Label[]
}

/**
 * Merge a fresh capture into the frozen set.
 *
 * **What the freeze protects is LABELS, not bytes.** A labelled id is immutable: refreshing it
 * would silently redefine the question a human already answered, which is the same failure as
 * not freezing at all, only harder to notice. So an id in `labelledIds` is never rewritten.
 *
 * An id that is frozen but NOT yet labelled has nothing to protect, and holding a stale copy of
 * it is actively harmful. We learned that within a day: the first snapshot froze 17 rows whose
 * description the source had truncated at 200 characters, and the connector fix landed hours
 * later. Labelling those would have meant hand-labelling a known-bad input on purpose, and
 * every run afterwards would have scored the model against a defect already repaired.
 *
 * So an unlabelled id is refreshed when the incoming text differs. The rule reads: **the set is
 * append-only with respect to answered questions, and current with respect to unanswered ones.**
 */
export function freeze(
  existing: FrozenEvent[],
  incoming: FrozenEvent[],
  labelledIds: ReadonlySet<string> = new Set(),
): {
  merged: FrozenEvent[]
  added: FrozenEvent[]
  refreshed: FrozenEvent[]
  kept: number
} {
  const byId = new Map(existing.map(e => [e.id, e]))
  const added: FrozenEvent[] = []
  const refreshed: FrozenEvent[] = []
  for (const e of incoming) {
    const prior = byId.get(e.id)
    if (!prior) {
      byId.set(e.id, e)
      added.push(e)
      continue
    }
    // Labelled: immutable, full stop.
    if (labelledIds.has(e.id)) continue
    // Unlabelled and the text moved: take the newer copy, but keep the ORIGINAL capture
    // timestamp, so the set still records when this input first entered it.
    if (prior.title !== e.title || prior.description !== e.description) {
      byId.set(e.id, { ...e, captured_at: prior.captured_at })
      refreshed.push(e)
    }
  }
  return {
    merged: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    added,
    refreshed,
    kept: existing.length,
  }
}

/** Events that are frozen AND labelled — the only ones a score may be computed from. */
export function scorable(set: GoldenSet): { event: FrozenEvent; label: Label }[] {
  const byId = new Map(set.labels.map(l => [l.id, l]))
  const out: { event: FrozenEvent; label: Label }[] = []
  for (const event of set.events) {
    const label = byId.get(event.id)
    if (label && (label.price !== null || label.kid !== null)) out.push({ event, label })
  }
  return out
}

/**
 * Coverage, reported on every run. A set that quietly shrinks is the failure this module
 * exists to prevent, so the shrinkage has to be printed next to the score, not inferred
 * from it. `orphanLabels` are judgments whose input text we no longer hold — they are kept
 * in the file as evidence, and they can never be scored again.
 */
export function coverage(set: GoldenSet): {
  frozen: number
  labelled: number
  scorable: number
  unlabelled: number
  orphanLabels: number
} {
  const frozenIds = new Set(set.events.map(e => e.id))
  const labelled = set.labels.filter(l => l.price !== null || l.kid !== null)
  const s = scorable(set).length
  return {
    frozen: set.events.length,
    labelled: labelled.length,
    scorable: s,
    unlabelled: set.events.length - s,
    orphanLabels: labelled.filter(l => !frozenIds.has(l.id)).length,
  }
}
