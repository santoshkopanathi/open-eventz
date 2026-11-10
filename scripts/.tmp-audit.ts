import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const rows: { source: string; title: string; description: string | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('events').select('source,title,description').range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data as typeof rows))
    if (!data || data.length < 1000) break
  }
  console.log(`rows: ${rows.length}`)

  const INVIS = new RegExp('[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]')
  const tally: Record<string, Record<string, number>> = {}
  const bump = (src: string, k: string) => {
    tally[src] ??= {}
    tally[src][k] = (tally[src][k] ?? 0) + 1
  }
  const samples: string[] = []

  for (const r of rows) {
    const d = r.description ?? ''
    bump(r.source, 'total')
    if (d.includes('<!--')) { bump(r.source, 'html-comment'); if (samples.length < 3) samples.push(`[comment] ${r.source} :: ${r.title}`) }
    if (/<[a-zA-Z/!][^>]*>/.test(d)) { bump(r.source, 'markup-tag'); if (samples.length < 6) samples.push(`[tag] ${r.source} :: ${r.title} :: ${d.match(/<[a-zA-Z/!][^>]*>/g)?.slice(0, 4).join(' ')}`) }
    if (d.includes('<')) bump(r.source, 'bare-<')
    if (INVIS.test(d)) { bump(r.source, 'invisible-char'); if (samples.length < 9) samples.push(`[invis] ${r.source} :: ${r.title}`) }
  }

  for (const [src, t] of Object.entries(tally)) console.log(src, t)
  console.log('\nsamples:')
  for (const s of samples) console.log(' ', s)
}
main()
