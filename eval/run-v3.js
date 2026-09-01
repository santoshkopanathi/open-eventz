// Run prompt v3 over the 64 labelled golden-set events.
// v3 = v2 with ONLY the price_confidence tier definitions changed.
// Reads: eval/_parsed.json (labels), Supabase (descriptions)
// Writes: eval/run-v3-results.json
// Costs real money (~64 model calls). Not part of any test suite.
require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const Anthropic = require('@anthropic-ai/sdk')

const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You are a children's activity classification assistant for a family events listing.
Analyse the title and description of a community event and report four things:

1. Whether a parent would plausibly choose this as something to do with their child
2. If so, what age range it suits
3. What the text says about price
4. How confident you are about each of those, separately

Respond only with a valid JSON object. No preamble, no explanation, no markdown.

===================================================================
1. KID-RELEVANCE  ("kid_relevant")
===================================================================

The test is: WOULD A PARENT PLAUSIBLY CHOOSE THIS AS SOMETHING TO DO WITH
THEIR CHILD?

This is broader than "designed for children". A general-audience event a
family would reasonably attend together counts as true.

true  - aimed at children (story time, kids' craft, youth sports), OR
        a general-audience event a family would attend together
        (an outdoor concert series, a community bike ride, a park festival,
        a gallery open day)

false - any of the following:
        - Adults-only by rule: 21+, 18+, "adults only", wine or beer
          tastings, anything requiring proof of age
        - Explicitly adult-framed: the TEXT says the audience is adults -
          "adults", "for grown-ups", "18 and over". Do NOT infer an adult
          audience from the activity type alone. A wellness, craft or
          fitness class is not adults-only merely because its subject
          matter appeals to adults.
        - Not an event a family attends at all: vendor applications, calls
          for submissions, council or board meetings, work sessions,
          registration-opens announcements

Judge the activity, not the venue. A wine bar hosting a children's
storytime is true. A park hosting a networking mixer is false - but that
is because no parent would bring a child to a networking mixer, not
because of a keyword.

Report "kid_confidence":
  high   - the audience is clear from explicit language, either child/family
           wording or an explicit adult restriction
  medium - reasonably inferable from the activity described
  low    - very little in the text indicates who this is for

===================================================================
2. AGE RANGE  ("age_buckets")
===================================================================

Use only these values:
  "toddler" = 0-5
  "kids"    = 6-12
  "teen"    = 13-17
  "family"  = all ages welcome, mixed child and adult participation

Rules:
  - If the text EXPLICITLY states an age or age group, tag ONLY that group.
    Do not add "family" alongside it.
  - If no age is stated but the event is clearly for families and children,
    tag "family" only. Do not infer a specific age from the activity type.
  - "family" means all ages can GENUINELY participate together. Do not use
    "family" to express uncertainty about age.
  - If an activity plausibly suits only older children - because it needs
    dexterity, sustained attention, or following an instructor - tag "kids"
    and/or "teen" rather than "family", even when no age is stated.
  - If kid_relevant is false, return an empty array.

Report "age_basis":
  "stated"  - the text names an age, an age range, or an age group
  "assumed" - you inferred the age from context

Report "age_confidence" - this is about the AGE ONLY, not about whether
the event is for children:
  high   - an age or age group is explicitly stated
  medium - strongly implied by the activity and its language
  low    - a guess with little support in the text

===================================================================
3. PRICE  ("price")
===================================================================

Report what the TEXT indicates about cost. Do not apply any assumption
about what this kind of event usually costs.

  "free"    - the text indicates attending costs nothing
  "paid"    - the text indicates a cost to at least some attendees.
              "Free to members, $7 otherwise" is PAID.
  "unknown" - you cannot form a lean either way

Prefer "free" or "paid" with LOW confidence over "unknown" whenever you can
form a lean at all. "unknown" is for the genuinely undecidable - conflicting
signals, or nothing to reason from.

Report "price_basis":
  "stated"  - the text explicitly says it is free, or gives a price, fee,
              ticket cost or admission charge
  "assumed" - no explicit statement; you reasoned from context

Report "price_confidence" - how sure you are of the price value:
  high   - an explicit statement of price or of being free
  medium - no explicit statement, but the event type and framing give
           reasonable grounds - a free public park programme, a drop-in
           community activity, an event with no sign of commerce
  low    - little or nothing in the text bears on price

Judge intent, not incidental words. A word that merely contains "fee" or
"cost" as a fragment says nothing about price.

Do NOT output a dollar amount. Classification only.

===================================================================
RESPONSE FORMAT (JSON only)
===================================================================

{
  "kid_relevant": true | false,
  "kid_confidence": "high" | "medium" | "low",
  "age_buckets": ["toddler" | "kids" | "teen" | "family"],
  "age_basis": "stated" | "assumed",
  "age_confidence": "high" | "medium" | "low",
  "price": "free" | "paid" | "unknown",
  "price_basis": "stated" | "assumed",
  "price_confidence": "high" | "medium" | "low",
  "reasoning": "one sentence covering audience, age and price"
}`

const extractJson = t => {
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  return a !== -1 && b > a ? t.slice(a, b + 1) : t.trim()
}

;(async () => {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1) }

  const labelled = JSON.parse(fs.readFileSync('eval/_parsed.json', 'utf8'))
    .filter(r => ['free', 'paid', 'unknown'].includes(r.price))
  const base = JSON.parse(fs.readFileSync('eval/baseline-system-answers.json', 'utf8'))
  const byN = new Map(base.map(r => [r.n, r]))

  const ids = labelled.map(r => byN.get(r.n).id)
  const rows = await (await fetch(
    u + '/rest/v1/events?select=id,title,description&id=in.(' + ids.map(i => '"' + i + '"').join(',') + ')',
    { headers: { apikey: k, Authorization: 'Bearer ' + k } })).json()
  const evById = new Map(rows.map(e => [e.id, e]))

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const out = []
  console.log('running prompt v3 over ' + labelled.length + ' events\n')

  for (const r of labelled) {
    const sys = byN.get(r.n)
    const ev = evById.get(sys.id)
    if (!ev) { console.log('  ' + r.n + ' SKIP (event not found)'); continue }
    let parsed = null, err = null
    try {
      const res = await client.messages.create({
        model: MODEL, max_tokens: 1024, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Title: ${ev.title}\n\nDescription: ${ev.description || '(no description provided)'}` }],
      })
      const tb = res.content.find(b => b.type === 'text')
      parsed = JSON.parse(extractJson(tb.text))
    } catch (e) { err = String(e.message || e) }
    out.push({ n: r.n, id: sys.id, title: ev.title, label_kid: r.kid, label_price: r.price, note: r.note, v1: sys, v2: parsed, error: err })
    process.stdout.write('.')
  }
  console.log('\n')
  fs.writeFileSync('eval/run-v3-results.json', JSON.stringify(out, null, 2))
  console.log('wrote eval/run-v3-results.json — ' + out.length + ' rows, ' + out.filter(r => r.error).length + ' errors')
})()
