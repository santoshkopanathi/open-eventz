import Anthropic from '@anthropic-ai/sdk'
import type { PlayFriscoInference, AgeBucket, AgeConfidence, PriceClass, PriceConfidence } from './types'

// Model rationale (see BUILD-LOG Decision 4): Sonnet over Haiku. Cost difference is
// operationally irrelevant (~$0.03 on the first run); the confidence tier is load-bearing
// UI logic, so accuracy wins.
const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You are a children's activity classification assistant. Your job is to analyze the title and description of a community event and determine:
1. Whether the event is genuinely relevant for children (vs. general public or adult-focused)
2. If child-relevant, what age range it is most suitable for
3. Whether the event is free, paid, or of unknown price

You must respond only with a valid JSON object. No preamble, no explanation, no markdown.

Age range buckets to use:
- "toddler" = ages 0-5
- "kids" = ages 6-12
- "teen" = ages 13-17
- "family" = all ages welcome, mixed child/adult participation
- "adult" = not suitable for children as primary audience

Classification rule (important):
- If the description EXPLICITLY states an age group or age range, tag ONLY that specific age group. Do not add "family" alongside it.
- If the description does NOT explicitly state an age group but is clearly relevant for families and children, tag as "family" only. Do not infer specific age groups from activity type alone.
- "Family" covers all ages — do not break it down further unless an age is explicitly mentioned.

Confidence levels:
- "high" = age range explicitly stated OR the event clearly uses family/child/youth language
- "medium" = reasonably inferable from context but no explicit family or age signal
- "low" = best guess only, very little signal in the text

Price classification. This is a city Parks & Recreation calendar — such community
events are FREE in the overwhelming majority of cases, so the absence of a paid
signal is itself a meaningful signal. Choose exactly one "price" value:
- "paid" = an explicit paid signal: a stated price, a fee, "buy tickets", "register for $X", "tickets required", "purchased ticket", or any clear indication of a cost to attend.
- "unknown" = ambiguous language that makes free unreliable even without a stated price. Examples: "tickets at the gate", "members only", "reservation required", "donations welcome". Not clearly free, not clearly paid.
- "free" = no paid signal and no ambiguous signal. This is the DEFAULT for community events where no price is mentioned.

Also report "price_confidence":
- "confirmed" = the text contains an explicit price statement — an explicit paid signal, OR an explicit free statement ("free admission", "no cost", "free to attend").
- "inferred" = you chose "free" only because no price was mentioned (the default), with no explicit free statement.

Price rules (critical):
- Keep two cases distinct: if there is NO mention of price at all, return "free" (the community-event default). If there ARE weak or conflicting price hints you cannot resolve — genuinely torn between paid and free with no clear signal either way — return "unknown". Do not guess between paid and free; "unknown" is the honest answer that avoids both a wrong "free" and a wrong "paid".
- Judge intent, not incidental words. "whether you're feeling competitive" says nothing about price.
- Do NOT output a dollar amount — classification only.

Response format (JSON only):
{
  "kid_relevant": true | false,
  "age_buckets": ["toddler" | "kids" | "teen" | "family"],
  "confidence": "high" | "medium" | "low",
  "price": "free" | "paid" | "unknown",
  "price_confidence": "confirmed" | "inferred",
  "reasoning": "one sentence explanation covering both age and price"
}

If kid_relevant is false, age_buckets should be an empty array.
If confidence is "low", treat kid_relevant as uncertain.`

const VALID_BUCKETS: AgeBucket[] = ['toddler', 'kids', 'teen', 'family']
const VALID_CONFIDENCE: AgeConfidence[] = ['high', 'medium', 'low']
const VALID_PRICE: PriceClass[] = ['free', 'paid', 'unknown']
const VALID_PRICE_CONFIDENCE: PriceConfidence[] = ['confirmed', 'inferred']

// Lazily construct the client so importing this module never throws when the key is unset
// (e.g. during a build). The key is only required when inference is actually invoked.
let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

function extractJson(text: string): string {
  // The prompt asks for raw JSON, but strip a ```json fence defensively just in case.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

/**
 * Infers child age-relevance AND price class for a Play Frisco event from its
 * title and description, in a single Claude call (v1.2). No DB access. Called at
 * ingest/cache time, never per page load.
 *
 * Returns null on any failure (parse error, API error, invalid age shape). The caller
 * should treat null as "no inference" — store the event without age data and fall back
 * to the keyword price parser (spec Section 4, Response handling table).
 *
 * Price is defensive: a missing/invalid price value degrades to "unknown" rather than
 * failing the whole inference, so age accuracy never depends on price parsing.
 */
export async function inferPlayFriscoEvent(input: { title: string; description: string }): Promise<PlayFriscoInference | null> {
  const title = (input.title ?? '').trim()
  const description = (input.description ?? '').trim()
  if (!title && !description) return null

  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Title: ${title}\n\nDescription: ${description || '(no description provided)'}`,
        },
      ],
    })

    const textBlock = res.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return null

    const parsed = JSON.parse(extractJson(textBlock.text)) as Record<string, unknown>

    if (typeof parsed.kid_relevant !== 'boolean') return null

    const confidence = parsed.confidence
    if (typeof confidence !== 'string' || !VALID_CONFIDENCE.includes(confidence as AgeConfidence)) return null

    const rawBuckets = Array.isArray(parsed.age_buckets) ? parsed.age_buckets : []
    const age_buckets = rawBuckets.filter(
      (b): b is AgeBucket => typeof b === 'string' && VALID_BUCKETS.includes(b as AgeBucket)
    )

    // Price is additive and defensive: an invalid/missing value degrades safely
    // so a price glitch never discards a good age inference. An unreadable price
    // becomes "unknown" (no badge) rather than a risky default-free.
    const price: PriceClass =
      typeof parsed.price === 'string' && VALID_PRICE.includes(parsed.price as PriceClass)
        ? (parsed.price as PriceClass)
        : 'unknown'
    const price_confidence: PriceConfidence =
      typeof parsed.price_confidence === 'string' && VALID_PRICE_CONFIDENCE.includes(parsed.price_confidence as PriceConfidence)
        ? (parsed.price_confidence as PriceConfidence)
        // A confirmed paid/free without a stated confidence is treated as confirmed;
        // a bare "free" without confidence is treated as inferred (the cautious read).
        : price === 'free' ? 'inferred' : 'confirmed'

    return {
      kid_relevant: parsed.kid_relevant,
      // Enforce the invariant: not kid-relevant => no buckets
      age_buckets: parsed.kid_relevant ? age_buckets : [],
      confidence: confidence as AgeConfidence,
      price,
      price_confidence,
      price_reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    }
  } catch (err) {
    console.error(`[age-inference] failed for "${title.slice(0, 60)}":`, (err as Error).message)
    return null
  }
}
