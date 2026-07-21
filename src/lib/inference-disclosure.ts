import type { Event } from './types'
import { getAgeBadge } from './age-badge'
import { getPriceBadge } from './price'

// ===========================================================================
// Combined inference disclosure (v1.2, Definition A).
//
// The DETAIL view shows ONE disclosure line for an event, covering whichever
// attributes were inferred by the LLM. `age_inferred` and `price_inferred` are
// DERIVED here from the badge logic — no stored flags:
//   age_inferred   = the age badge is an inferred kind (family or specific)
//   price_inferred = the price badge is inferred (Definition A: any Play Frisco
//                    price badge — free OR paid — is an LLM read of the description)
//
// If both are inferred, the two clauses are merged into a single sentence
// (never two separate lines). If neither is inferred (e.g. a library event, or a
// Play Frisco event whose price resolved to unknown and whose age is confirmed),
// there is nothing to disclose → null.
// ===========================================================================

// Age clause: "Age suitability" (specific range) or "Family suitability" (family).
function ageClause(event: Event): string | null {
  const b = getAgeBadge(event)
  if (!b || !b.inferred) return null
  return b.kind === 'inferred-family' ? 'Family suitability' : 'Age suitability'
}

// Price clause: "'Free' admission status" or "'Paid' admission status". The labels are
// single-quoted to signal they are classification labels, not descriptions.
function priceClause(event: Event): string | null {
  const b = getPriceBadge(event)
  if (!b || !b.inferred) return null
  return b.kind === 'paid-inferred' ? "'Paid' admission status" : "'Free' admission status"
}

/**
 * The single combined disclosure string for the detail view, or null when nothing
 * on the event is inferred. Examples:
 *   age only              -> "Age suitability estimated from event description"
 *   family only           -> "Family suitability estimated from event description"
 *   price(free) only      -> "'Free' admission status estimated from event description"
 *   family + price(paid)  -> "Family suitability and 'Paid' admission status estimated from event description"
 */
export function inferenceDisclosure(event: Event): string | null {
  const age = ageClause(event)
  const price = priceClause(event)
  if (!age && !price) return null
  const subject = age && price ? `${age} and ${price}` : (age ?? price)
  return `${subject} estimated from event description`
}
