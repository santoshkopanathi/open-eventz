// Frisco Library (BiblioCommons) — the one piece of card parsing that has broken in production,
// extracted so it can be tested without the network.
//
// 2026-10-21: BiblioCommons moved event links from `/events/<id>` to `/v2/events/<id>`. The
// listing still rendered 20 cards a page; every card failed to match; the run reported
// `fetched: 0, errors: []`. Nothing was written and nothing was purged — the guards held — but
// the log said "the library has no events", which is a different problem with a different fix.

export interface FriscoEventLink {
  /** Absolute URL of the event page, stored as `event_url`. */
  url: string
  /** The BiblioCommons event id — stable across the URL move, and the basis of our row id. */
  id: string
}

/**
 * The event link inside one listing card, accepting both URL shapes. Returns null when the
 * card carries no event link at all, which the caller must treat as a parse failure rather
 * than as an empty calendar.
 */
export function parseFriscoEventLink(card: string): FriscoEventLink | null {
  const m = card.match(/href="(https:\/\/friscolibrary\.bibliocommons\.com\/(?:v2\/)?events\/([a-zA-Z0-9]+))"/)
  return m ? { url: m[1], id: m[2] } : null
}
