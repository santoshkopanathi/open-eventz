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
}

export interface GoldenSet {
  events: FrozenEvent[]
  labels: Label[]
}

/**
 * Append-only merge. An id already present keeps its ORIGINAL capture; the incoming copy
 * is dropped. Refreshing a frozen input would silently redefine the question a label was
 * the answer to, which is the same failure as not freezing at all, only harder to notice.
 */
export function freeze(existing: FrozenEvent[], incoming: FrozenEvent[]): {
  merged: FrozenEvent[]
  added: FrozenEvent[]
  kept: number
} {
  const byId = new Map(existing.map(e => [e.id, e]))
  const added: FrozenEvent[] = []
  for (const e of incoming) {
    if (byId.has(e.id)) continue
    byId.set(e.id, e)
    added.push(e)
  }
  return {
    merged: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    added,
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
