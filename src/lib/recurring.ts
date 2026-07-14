// Title normalization for recurring-series detection (case/whitespace-insensitive)
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

// The minimal shape markRecurring needs — the ingest event objects satisfy this.
export interface RecurringMarkable {
  source: string
  title: string
  is_recurring: boolean
  recurrence_label: string | null
}

/**
 * Marks recurring events in place: any event whose title appears on 2+ dates within the same
 * source is treated as a recurring series (spec §7). Source-scoped so a same-titled event in a
 * different city is not merged. Complements source-specific signals (e.g. Frisco "View all dates")
 * already set at scrape time — never clears an existing is_recurring=true.
 */
export function markRecurring<T extends RecurringMarkable>(events: T[]): T[] {
  const counts = new Map<string, number>()
  for (const e of events) {
    const key = `${e.source}|${normalizeTitle(e.title)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const e of events) {
    const key = `${e.source}|${normalizeTitle(e.title)}`
    if ((counts.get(key) ?? 0) >= 2) {
      e.is_recurring = true
      if (!e.recurrence_label) e.recurrence_label = 'Recurring'
    }
  }
  return events
}
