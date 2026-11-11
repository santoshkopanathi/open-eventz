import { existsSync, readFileSync } from 'node:fs'

// The CI gate for the classifier. These assertions exist because every one of them was
// something I got wrong or nearly shipped while writing the workflow.
const WF = '.github/workflows/classifier-eval.yml'
const yml = readFileSync(WF, 'utf8')

describe('classifier-eval workflow — the path filter must be able to fire', () => {
  it('every literal path in the filter actually exists', () => {
    // Caught for real: the filter listed src/lib/kid-visibility-gate.ts, which has never
    // existed — only its test does. A filter entry pointing at nothing is dead config: it
    // never matches, so the gate silently stops covering what someone believed it covered.
    const paths = [...yml.matchAll(/^ {6}- '([^']+)'$/gm)].map(m => m[1])
    const literals = paths.filter(p => !p.includes('*'))
    expect(literals.length).toBeGreaterThan(3)
    expect(literals.filter(p => !existsSync(p))).toEqual([])
  })

  it('watches the prompt and model file, which is the whole point', () => {
    expect(yml).toContain("'src/lib/age-inference.ts'")
  })

  it('watches the deterministic rules the eval actually exercises', () => {
    // resolvePriceClass and visibleText both run inside eval-run.ts, so a change to either
    // is measurable by this suite. A rule the eval does not execute must NOT be listed.
    expect(yml).toContain("'src/lib/price.ts'")
    expect(yml).toContain("'src/lib/source-text.ts'")
  })

  it('does NOT watch the API visibility gate, which this eval cannot observe', () => {
    // eval-run.ts computes `shown` itself and never reads the route, so a run triggered by a
    // change there could not detect it. Listing it would be a check that cannot fire.
    // Checked against the quoted filter ENTRIES, not the file text: the workflow names
    // this route in a comment explaining why it is excluded, and a blanket substring check
    // would fail on the explanation itself.
    const entries = [...yml.matchAll(/^ {6}- .([^.]+).$/gm)].map(m => m[1])
    expect(entries).not.toContain('src/app/api/events/route.ts')
  })

  it('watches the golden set and the scoring rules, since they define what "pass" means', () => {
    expect(yml).toContain("'eval/golden/**'")
    expect(yml).toContain("'src/lib/eval-score.ts'")
  })
})

describe('classifier-eval workflow — triggers and secrets', () => {
  it('runs on change, weekly, and on demand', () => {
    expect(yml).toMatch(/^ {2}push:$/m)
    expect(yml).toMatch(/cron: '[^']+ \* \* 1'/) // Monday
    expect(yml).toMatch(/^ {2}workflow_dispatch:$/m)
  })

  it('is NOT scheduled nightly', () => {
    // Not a cost decision — $0.32 a run cached. A non-deterministic suite run unattended
    // every night produces a false red most weeks, and the first false red teaches everyone
    // to stop reading the colour.
    expect(yml).not.toMatch(/cron: '[^']+ \* \* \*'/)
  })

  it('opts into the Production environment in every job that needs the key', () => {
    // The Anthropic key is an environment-scoped secret; repo-level secrets.* cannot see it,
    // so a job without this line gets an empty key and fails on the first call.
    const jobs = yml.split(/^ {2}[a-z-]+:$/m).slice(1)
    const needKey = jobs.filter(j => j.includes('ANTHROPIC_API_KEY'))
    expect(needKey.length).toBe(2)
    for (const j of needKey) expect(j).toContain('environment: Production')
  })

  it('keeps red-team and the golden set as separate jobs', () => {
    // So neither failure can hide the other's result. Same reasoning as heartbeat.yml.
    expect(yml).toMatch(/^ {2}red-team:$/m)
    expect(yml).toMatch(/^ {2}golden-set:$/m)
  })

  it('serialises runs so a push and the weekly run cannot bill twice at once', () => {
    expect(yml).toContain('group: classifier-eval')
  })
})

describe('classifier-eval workflow — the confirmation pass', () => {
  it('retries failing rows before failing the build, and scores again afterwards', () => {
    expect(yml).toContain('--retry-failures')
    // The second score is what decides. A retry that did not re-score would just hide the
    // failure it was meant to confirm.
    const step = yml.slice(yml.indexOf('--retry-failures'))
    expect(step).toContain('npm run eval:score')
  })

  it('keeps the raw run even when the gate fails', () => {
    expect(yml).toContain('if: always()')
    expect(yml).toContain('eval/golden/run-latest.json')
  })
})

describe('the production classifier caches its system prompt', () => {
  it('sends the system prompt as a cached block', () => {
    // 1,334 tokens, identical on every call — 92% of each request. Verified 2026-11-11:
    // cache_read_input_tokens = 1327 on every call after the first. Cuts a 123-event run
    // from $0.76 to $0.32, and does the same for the nightly ingest.
    const src = readFileSync('src/lib/age-inference.ts', 'utf8')
    expect(src).toMatch(/cache_control: \{ type: 'ephemeral' \}/)
  })
})
