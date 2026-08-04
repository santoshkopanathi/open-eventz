import type { Event } from './types'

// The supervision "Can kids be dropped off?" badge shown on the event DETAIL view.
//
// This logic was previously inline in EventDetail and gated to Frisco Library only; the
// Plano and Play Frisco branches were silently lost in a pre-git refactor and shipped
// blank for weeks (see BUILD-LOG "Learning 5" / interview Challenge 16). It now lives here
// as pure, per-source, unit-tested logic so a source can never silently drop out again.
// getSupervisionBadge returns null for an unrecognised source (graceful — no badge on bad
// data). The guarantee that every REAL source renders a badge is enforced by the
// Record<EventSource, true> completeness test in supervision.test.ts, which fails CI if a
// new source is added without a case.

export interface SupervisionBadge {
  bg: string
  text: string
  label: string   // headline, e.g. "❌ Can kids be dropped off? No — adult must stay with child"
  sub?: string    // optional second line: the policy detail / source / caveat
}

// Frisco Public Library Service Policy §8.5 (2026): children aged 9 or younger must be
// accompanied by an adult → 10-and-older may attend unattended. Derived from the event's
// scraped age range, not a generic per-source label.
function friscoSupervision(ageMin: number | null, ageMax: number | null): SupervisionBadge {
  // Teens (13+) — no adult required
  if (ageMin !== null && ageMin >= 13) {
    return { bg: '#D1FAE5', text: '#065F46', label: '✅ Can kids be dropped off? Yes — teens 13+ may attend alone' }
  }
  // Toddlers / young kids only (age_max ≤ 9) — adult must stay
  if (ageMax !== null && ageMax <= 9) {
    return { bg: '#FEE2E2', text: '#991B1B', label: '❌ Can kids be dropped off? No — adult must stay with child' }
  }
  // Mixed 6–12 group — straddles the 10-year policy threshold
  if (ageMin !== null && ageMax !== null) {
    return { bg: '#DBEAFE', text: '#1E40AF', label: '🔵 Can kids be dropped off? Only if child is 10 or older (Frisco Library policy)' }
  }
  // Unknown age data — never guess a threshold
  return { bg: '#F3F4F6', text: '#374151', label: '⚠️ Can kids be dropped off? Check with Frisco Library' }
}

// Plano Libraries: no formal drop-off policy (confirmed by phone across several branches).
// Staff generally prefer a parent stay with younger children, or remain in the library.
// Rendered as gentle guidance — deliberately NOT a hard age cutoff, since none officially exists.
const PLANO_SUPERVISION: SupervisionBadge = {
  bg: '#DBEAFE',
  text: '#1E40AF',
  label: '🔵 Can kids be dropped off? Plan to stay',
  sub: 'No formal Plano Library policy — staff generally prefer a parent stay with younger kids, or remain in the library.',
}

// Play Frisco: supervision policy unverified (Tier 3) — always defer to the venue.
const PLAY_FRISCO_SUPERVISION: SupervisionBadge = {
  bg: '#F3F4F6',
  text: '#374151',
  label: '⚠️ Can kids be dropped off? Check with venue',
  sub: 'Check with venue before dropping off.',
}

/**
 * Supervision / drop-off badge for the event detail view, resolved per source.
 * Returns null for an unrecognised source (renders no badge — safe on bad data). Every KNOWN
 * EventSource must return a badge; that is enforced by the completeness test in
 * supervision.test.ts, not by the compiler.
 */
export function getSupervisionBadge(event: Event): SupervisionBadge | null {
  switch (event.source) {
    case 'frisco-library':
      return friscoSupervision(event.age_min ?? null, event.age_max ?? null)
    case 'plano-library':
      return PLANO_SUPERVISION
    case 'play-frisco':
      return PLAY_FRISCO_SUPERVISION
    default:
      return null
  }
}
