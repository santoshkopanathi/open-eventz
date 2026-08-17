import { readFileSync } from 'fs'
import { join } from 'path'

// Verifies the FAILURE ALERT itself — the `notify` job's delivery logic in
// .github/workflows/ingest.yml.
//
// WHY THIS IS A COMMITTED TEST. Three fire drills on 2026-08-17 produced three DIFFERENT
// failures on GitHub's Issues API, and each fix was verified with a throwaway harness. A
// throwaway harness is worthless the moment it is thrown away: the alert only executes when
// something is already broken, so a regression in it would stay invisible until the night it
// mattered. Each scenario below is a failure that actually happened in production.
//
// The script is extracted from the workflow rather than duplicated, so this cannot silently
// drift from what really runs.

const WORKFLOW = '.github/workflows/ingest.yml'
const TITLE = '🧪 FIRE DRILL — ingest alert test (safe to close)'

/** Pull the `script: |` block out of the notify step and dedent it. */
function extractNotifyScript(): string {
  const yaml = readFileSync(join(process.cwd(), WORKFLOW), 'utf8')
  const lines = yaml.split('\n')
  const start = lines.findIndex(l => /^\s*script:\s*\|\s*$/.test(l))
  if (start === -1) throw new Error(`no "script: |" block found in ${WORKFLOW}`)
  const keyIndent = lines[start].search(/\S/)
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= keyIndent) break
    body.push(line)
  }
  const indent = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)))
  return body.map(l => l.slice(indent)).join('\n')
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const SERVICE_UNAVAILABLE = () => httpError(503, 'No server is currently available to service your request.')

interface Faults {
  labelExists?: boolean
  failCreateLabel?: boolean
  failList?: boolean
  failComment?: boolean
  failCreateLabelled?: boolean
  failCreateAll?: boolean
  existingIssue?: boolean
}

interface Outcome {
  commentedOn: number | null
  createdIssue: number | null
  createdWithLabels: string[] | null
  jobFailed: string | null
  errors: string[]
}

async function runNotify(faults: Faults): Promise<Outcome> {
  const out: Outcome = { commentedOn: null, createdIssue: null, createdWithLabels: null, jobFailed: null, errors: [] }
  const core = {
    notice: () => {},
    warning: () => {},
    error: (m: string) => out.errors.push(m),
    setFailed: (m: string) => { out.jobFailed = m },
  }
  const github = {
    rest: {
      issues: {
        getLabel: async () => { if (faults.labelExists) return {}; throw httpError(404, 'Not Found') },
        createLabel: async () => { if (faults.failCreateLabel) throw SERVICE_UNAVAILABLE(); return {} },
        listForRepo: async () => {
          if (faults.failList) throw SERVICE_UNAVAILABLE()
          return { data: faults.existingIssue ? [{ number: 7, title: TITLE, labels: [] }] : [] }
        },
        createComment: async () => {
          if (faults.failComment) throw SERVICE_UNAVAILABLE()
          out.commentedOn = 7
          return {}
        },
        create: async ({ labels }: { labels?: string[] }) => {
          if (faults.failCreateAll) throw SERVICE_UNAVAILABLE()
          if (faults.failCreateLabelled && labels) throw httpError(422, 'Validation Failed')
          out.createdIssue = 42
          out.createdWithLabels = labels ?? null
          return { data: { number: 42 } }
        },
      },
    },
  }
  const context = { repo: { owner: 'o', repo: 'r' }, serverUrl: 'https://github.com', runId: 1, runNumber: 2 }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
    new (...args: string[]) => (...a: unknown[]) => Promise<unknown>
  const fn = new AsyncFunction('github', 'context', 'core', 'process', 'require', extractNotifyScript())
  await fn(github, context, core, { env: { IS_DRILL: 'true' } }, () => {})
  return out
}

const delivered = (o: Outcome) => o.commentedOn !== null || o.createdIssue !== null

describe('failure alert — delivery survives a flaky Issues API', () => {
  // The script backs off 3s then 6s between retries. Real waits would add ~60s to every commit,
  // and a slow hook is a skipped hook. Collapse the delay to zero — the retry LOGIC (how many
  // attempts, which statuses retry, the fall-forward order) is unchanged and is what we assert.
  const realSetTimeout = global.setTimeout
  beforeAll(() => {
    global.setTimeout = ((fn: (...a: unknown[]) => void) => realSetTimeout(fn, 0)) as unknown as typeof global.setTimeout
  })
  afterAll(() => { global.setTimeout = realSetTimeout })

  test('clean first run → opens a labelled issue', async () => {
    const o = await runNotify({})
    expect(o.createdIssue).toBe(42)
    expect(o.jobFailed).toBeNull()
  })

  test('DRILL 1 — createLabel 503s → issue still delivered, unlabelled', async () => {
    // The real bug: createLabel was unhandled and killed the job before it created the issue.
    const o = await runNotify({ failCreateLabel: true })
    expect(delivered(o)).toBe(true)
    expect(o.createdWithLabels).toBeNull()
    expect(o.jobFailed).toBeNull()
  })

  test('DRILL 2 — issue creation rejects the label → falls back to unlabelled', async () => {
    const o = await runNotify({ labelExists: true, failCreateLabelled: true })
    expect(delivered(o)).toBe(true)
    expect(o.createdWithLabels).toBeNull()
    expect(o.jobFailed).toBeNull()
  })

  test('DRILL 3 — createComment 503s → falls FORWARD to a new issue', async () => {
    // The real bug: delivery gave up here and issue #1 kept 0 comments.
    const o = await runNotify({ labelExists: true, existingIssue: true, failComment: true })
    expect(o.commentedOn).toBeNull()
    expect(o.createdIssue).toBe(42)
    expect(o.jobFailed).toBeNull()
  })

  test('comment fails AND labelled create is rejected → still delivered', async () => {
    const o = await runNotify({ labelExists: true, existingIssue: true, failComment: true, failCreateLabelled: true })
    expect(delivered(o)).toBe(true)
    expect(o.jobFailed).toBeNull()
  })

  test('an existing open issue is reused — no duplicate', async () => {
    const o = await runNotify({ labelExists: true, existingIssue: true })
    expect(o.commentedOn).toBe(7)
    expect(o.createdIssue).toBeNull()
  })

  test('dedup finds the existing issue even though it carries NO label', async () => {
    // Issue #1 in production is unlabelled; label-based lookup would miss it and duplicate.
    const o = await runNotify({ labelExists: true, existingIssue: true })
    expect(o.commentedOn).toBe(7)
  })

  test('listing issues fails → opens a new one rather than staying silent', async () => {
    const o = await runNotify({ labelExists: true, failList: true })
    expect(o.createdIssue).toBe(42)
    expect(o.jobFailed).toBeNull()
  })

  test('total outage → nothing delivered, job fails LOUDLY naming the failed calls', async () => {
    const o = await runNotify({ failCreateLabel: true, failComment: true, failCreateAll: true, existingIssue: true })
    expect(delivered(o)).toBe(false)
    expect(o.jobFailed).toBeTruthy()
    expect(o.errors.join(' ')).toMatch(/ALERT DELIVERY FAILED/)
    // The run is already red, so GitHub's own workflow-failure email still reaches us.
  })
})
