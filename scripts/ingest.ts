/*
 * Standalone ingest runner — used by the nightly GitHub Actions workflow (one job per
 * source) and for local manual runs. No Next.js, no HTTP: it calls the runXIngest()
 * functions directly, so it isn't bound by any serverless request/function timeout.
 *
 *   npm run ingest -- frisco        # one source
 *   npm run ingest -- plano
 *   npm run ingest -- play-frisco
 *   npm run ingest -- all           # all three sequentially (default)
 *   npm run ingest -- check         # resolve modules + verify env, no network/writes
 *
 * Env: locally loaded from .env.local (below); in CI, supplied via job env from GitHub
 * secrets. Exits non-zero when a source ingests nothing (upserted === 0) or throws, so a
 * failed run shows red in Actions.
 */
import { config } from 'dotenv'

// Load .env.local for local runs. In CI there is no .env.local, so this is a no-op and the
// values come from the job environment (GitHub secrets). Must run BEFORE importing the
// ingest module, because src/lib/supabase.ts reads env at module load — hence the dynamic
// import below.
config({ path: '.env.local' })

const SOURCES = ['frisco', 'plano', 'play-frisco', 'kaleidoscope', 'all', 'check'] as const
type Src = (typeof SOURCES)[number]

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

async function main() {
  const arg = (process.argv[2] ?? 'all') as Src
  if (!SOURCES.includes(arg)) {
    console.error(`[ingest] unknown source "${arg}". Use one of: ${SOURCES.join(', ')}`)
    process.exit(2)
  }

  const missing = REQUIRED_ENV.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`[ingest] missing required env: ${missing.join(', ')}`)
    process.exit(2)
  }
  // Play Frisco and Kaleidoscope use the Anthropic key for LLM classification; the libraries don't.
  if ((arg === 'play-frisco' || arg === 'kaleidoscope' || arg === 'all') && !process.env.ANTHROPIC_API_KEY) {
    console.error(`[ingest] ANTHROPIC_API_KEY is required for ${arg} inference`)
    process.exit(2)
  }

  // Dynamic import AFTER dotenv so src/lib/supabase.ts sees env at module load.
  const ingest = await import('../src/lib/ingest')

  if (arg === 'check') {
    const ok = ['runFriscoIngest', 'runPlanoIngest', 'runPlayFriscoIngest', 'runKaleidoscopeIngest', 'runAllIngest']
      .every(fn => typeof (ingest as Record<string, unknown>)[fn] === 'function')
    console.log(`[ingest] check: modules resolved=${ok}, env present`)
    process.exit(ok ? 0 : 1)
  }

  const run =
    arg === 'frisco' ? ingest.runFriscoIngest :
    arg === 'plano' ? ingest.runPlanoIngest :
    arg === 'play-frisco' ? ingest.runPlayFriscoIngest :
    arg === 'kaleidoscope' ? ingest.runKaleidoscopeIngest :
    ingest.runAllIngest

  console.log(`[ingest] starting: ${arg}`)
  const result = await run()
  console.log(`[ingest] done: ${JSON.stringify(result)}`)

  const upserted = (result as { upserted: number }).upserted
  const errors = (result as { errors: string[] }).errors ?? []
  if (errors.length > 0) console.error(`[ingest] completed with ${errors.length} error(s)`)
  // Nothing written = the run failed to accomplish anything → red in Actions.
  process.exit(upserted === 0 ? 1 : 0)
}

main().catch(err => {
  console.error('[ingest] fatal:', err)
  process.exit(1)
})
