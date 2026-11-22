import type { Event } from './types'
import { LLM_CLASSIFIED_SOURCES } from './age-filter'

/**
 * The visible-catalog rules, in ONE place, shared by the list view (`/api/events`), Ask
 * (`/api/ask`) and the Ask eval snapshot. ASK spec: "Retrieval reuses the list view's gate.
 * Extract it into a shared function, not a copy." If Ask could see an event the list hides, an
 * answer could cite an adult or unclassified event a parent would never see browsing.
 *
 * Two forms of the same rule: a PostgREST filter string for the database queries, and a pure
 * predicate for code that already holds rows (the eval's frozen snapshot). A test pins them
 * to each other.
 */

// For LLM-classified sources, kid_relevant = NULL means "never successfully classified", not
// "not applicable" — so it must be hidden. Library rows carry no inference and pass on NULL.
export const KID_VISIBILITY_GATE =
  `kid_relevant.eq.true,and(kid_relevant.is.null,source.not.in.(${LLM_CLASSIFIED_SOURCES.join(',')}))`

// age_min >= 18 marks Frisco Library adult programs.
export const NOT_ADULTS_ONLY = 'age_min.is.null,age_min.lt.18'

/** Pure form of KID_VISIBILITY_GATE + NOT_ADULTS_ONLY. */
export function isCatalogVisible(e: Pick<Event, 'source' | 'kid_relevant' | 'age_min'>): boolean {
  const kidOk = e.kid_relevant === true || (e.kid_relevant == null && !LLM_CLASSIFIED_SOURCES.includes(e.source))
  const notAdult = e.age_min == null || e.age_min < 18
  return kidOk && notAdult
}

/** City a parent would recognise. Kaleidoscope Park and Play Frisco are both in Frisco. */
export function cityOf(e: Pick<Event, 'source'>): 'frisco' | 'plano' {
  return e.source === 'plano-library' ? 'plano' : 'frisco'
}
