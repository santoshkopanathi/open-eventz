export interface AgeData {
  age_min: number | null
  age_max: number | null
  age_label: string | null
}

/**
 * Parses the "Suitable for:" block from a Frisco Library (BiblioCommons) event page.
 * Returns age_min/age_max/age_label derived from the audience tags present in the block.
 * Returns all-null if the block is absent (caller should treat as all-ages or unknown).
 */
export function parseFriscoSuitableFor(html: string): AgeData {
  const suitableIdx = html.indexOf('Suitable for')
  if (suitableIdx === -1) return { age_min: null, age_max: null, age_label: null }

  const block = html.slice(suitableIdx, suitableIdx + 600).toLowerCase()

  const hasAdult    = block.includes('adult') || block.includes('senior')
  const hasChild05  = block.includes('children (0')
  const hasChild612 = block.includes('children (6')
  const hasTween    = block.includes('tween')
  const hasTeen     = block.includes('teen')
  const hasYoungKid = hasChild05 || hasChild612 || hasTween

  if (hasAdult && hasYoungKid) {
    return { age_min: 0, age_max: 17, age_label: null }
  }
  if (hasAdult && hasTeen) {
    return { age_min: 13, age_max: 17, age_label: null }
  }
  if (hasAdult) {
    return { age_min: 18, age_max: 99, age_label: null }
  }

  const mins: number[] = []
  const maxs: number[] = []
  if (hasChild05)  { mins.push(0);  maxs.push(5)  }
  if (hasChild612) { mins.push(6);  maxs.push(12) }
  if (hasTween)    { mins.push(10); maxs.push(13) }
  if (hasTeen)     { mins.push(13); maxs.push(17) }

  if (mins.length === 0) return { age_min: null, age_max: null, age_label: null }

  const age_min = Math.min(...mins)
  const age_max = Math.max(...maxs)
  let age_label: string | null = null
  if (mins.length === 1) {
    if (hasChild05)  age_label = 'Children (0–5)'
    if (hasChild612) age_label = 'Children (6–12)'
    if (hasTween)    age_label = 'Tweens (10–13)'
    if (hasTeen)     age_label = 'Teens'
  }

  return { age_min, age_max, age_label }
}

export const COMMUNICO_AUDIENCE: Record<string, { age_min: number; age_max: number; label: string }> = {
  'Babies':              { age_min: 0,  age_max: 1,  label: 'Babies' },
  'Toddlers':            { age_min: 1,  age_max: 3,  label: 'Toddlers' },
  'Preschoolers':        { age_min: 3,  age_max: 5,  label: 'Preschoolers' },
  'Kids':                { age_min: 6,  age_max: 12, label: 'Kids (6–12)' },
  'Teens':               { age_min: 13, age_max: 17, label: 'Teens' },
  'Families+(All+Ages)': { age_min: 0,  age_max: 17, label: 'All Ages' },
  'Adults':              { age_min: 18, age_max: 99, label: 'Adults' },
  'Older+Adults':        { age_min: 18, age_max: 99, label: 'Older Adults' },
}

/**
 * Parses the AGE GROUP block from a Plano Library (Communico) event page.
 * Extracts all /events?a=VALUE audience links and maps them to age ranges.
 * Returns all-null if the block is absent or no known audience values are found.
 */
export function parseCommunicoAgeGroup(html: string): AgeData {
  const ageGroupIdx = html.indexOf('AGE GROUP')
  if (ageGroupIdx === -1) return { age_min: null, age_max: null, age_label: null }

  const block = html.slice(ageGroupIdx, ageGroupIdx + 600)
  const audienceMatches = [...block.matchAll(/href="\/events\?a=([^"]+)"/g)]
  if (audienceMatches.length === 0) return { age_min: null, age_max: null, age_label: null }

  // Communico URL-encodes parentheses in the audience value (e.g. "Families+%28All+Ages%29").
  // Decode so it matches the literal-parenthesis keys in COMMUNICO_AUDIENCE. decodeURIComponent
  // leaves "+" as-is (it's not a space here) and is a no-op for the unparenthesized values.
  const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  const audiences = audienceMatches.map(m => decode(m[1]))
  const mapped = audiences.map(a => COMMUNICO_AUDIENCE[a]).filter(Boolean)
  if (mapped.length === 0) return { age_min: null, age_max: null, age_label: null }

  // Compute the kid-facing range from child audiences only. Adults / Older Adults (18–99) are
  // not filterable kid groups; folding their range into the union would spuriously stretch a
  // "Kids + Adults" event across the 13–17 gap and make it match the Teens filter. When only
  // adult audiences are present, fall back to their range (the API's adult gate excludes it anyway).
  const kidAudiences = mapped.filter(a => a.age_min < 18)
  const rangeSet = kidAudiences.length > 0 ? kidAudiences : mapped
  const age_min = Math.min(...rangeSet.map(a => a.age_min))
  const age_max = Math.max(...rangeSet.map(a => a.age_max))
  const age_label = mapped.length === 1 ? mapped[0].label : null

  return { age_min, age_max, age_label }
}

/**
 * True when a Plano (Communico) event page explicitly carries the "Families (All Ages)"
 * audience tag. This is a distinct signal from a 0–17 numeric range (a Babies-through-Teens
 * event also spans 0–17 but is not family), and it's what drives the confirmed "Family" badge.
 */
export function communicoIsFamily(html: string): boolean {
  const idx = html.indexOf('AGE GROUP')
  if (idx === -1) return false
  const block = html.slice(idx, idx + 600)
  const audiences = [...block.matchAll(/href="\/events\?a=([^"]+)"/g)].map(m => {
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  })
  return audiences.includes('Families+(All+Ages)')
}
