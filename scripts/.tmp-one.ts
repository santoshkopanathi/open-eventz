import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await db.from('events').select('*').ilike('title', '%ESL Chat%')
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const d = String(r.description ?? '')
    const codes = [...d].map((c, i) => ({ c, i, cp: c.codePointAt(0)! })).filter(x => x.cp >= 0x200b && x.cp <= 0xfeff && x.cp !== 0x2019)
    console.log({
      id: r.id, title: r.title, kid_relevant: r.kid_relevant, kid_confidence: r.kid_confidence,
      age_min: r.age_min, start: r.start_datetime, date_inferred: r.date_inferred,
    })
    for (const x of codes.slice(0, 5)) {
      console.log(`  invisible U+${x.cp.toString(16).toUpperCase()} at ${x.i} — context: ${JSON.stringify(d.slice(Math.max(0, x.i - 35), x.i + 35))}`)
    }
  }
}
main()
