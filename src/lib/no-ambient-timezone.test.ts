import { readFileSync } from 'fs'
import { join } from 'path'

// Bans the exact construct that produced the "5:00 AM story time" incident.
//
// `new Date(dateStr)` resolves a string in the RUNTIME's timezone. That read as correct on a
// Central dev machine and stored every event 5–6 hours early on the UTC GitHub Actions runner.
// The bug wasn't a typo — it was an ambient dependency only one environment revealed, so fixing
// the three call sites doesn't stop a fourth being written.
//
// APPROACH: textually telling `new Date(<string>)` from `new Date(<number>)` is unreliable — the
// first version of this test used a regex that matched string literals and therefore missed all
// three real call sites (`new Date(dateStr)`, `new Date(pubDate.replace(…))`,
// `new Date(startMatch[1].trim())`). It would have passed while the bug was live. So instead:
// ANY `new Date(` with an argument in the ingest module must appear on the allowlist below,
// with a reason. Adding a new one is deliberate friction — that is the point.
//
// Source times must go through parseCentralWallTime / centralWallTimeToUtc (datetime.ts), which
// name the venue's timezone explicitly.
const INGEST_FILE = 'src/lib/ingest.ts'

// Exact code fragments allowed to construct a Date from an argument, and why each is safe.
const ALLOWED_ARG_FORMS: { fragment: string; why: string }[] = [
  {
    fragment: 'new Date(now.getFullYear(), now.getMonth() + i, 1)',
    why: 'numeric Y/M/D constructor building CivicPlus month params — no string parsing, and only the month label is used',
  },
]

function codeLines(src: string): { line: number; text: string }[] {
  return src.split('\n').map((text, i) => ({ line: i + 1, text })).filter(l => {
    const t = l.text.trim()
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
  })
}

describe('no ambient-timezone date parsing in ingest', () => {
  const src = readFileSync(join(process.cwd(), INGEST_FILE), 'utf8')

  test('every `new Date(<arg>)` in ingest is on the allowlist', () => {
    const offenders = codeLines(src)
      // `new Date(` followed by anything other than an immediate `)` = it takes an argument.
      .filter(l => /new Date\(\s*[^)\s]/.test(l.text))
      .filter(l => !ALLOWED_ARG_FORMS.some(a => l.text.includes(a.fragment)))
      .map(l => `${INGEST_FILE}:${l.line} → ${l.text.trim()}`)

    // If this fails: use parseCentralWallTime() for source times, or add the line to
    // ALLOWED_ARG_FORMS with a reason if it genuinely cannot be timezone-sensitive.
    expect(offenders).toEqual([])
  })

  test('the allowlist itself is still accurate (no stale entries)', () => {
    for (const a of ALLOWED_ARG_FORMS) {
      expect(src).toContain(a.fragment)
      expect(a.why.length).toBeGreaterThan(20)
    }
  })

  test('ingest parses source times via the explicit Central-time helpers', () => {
    expect(src).toMatch(/from '\.\/datetime'/)
    expect(src).toContain('parseCentralWallTime')
  })

  test('every write path goes through the pre-write guard', () => {
    // A new runner calling db.upsert directly would bypass every time check. The only permitted
    // upsert of `events` is the one inside guardedUpsert.
    const upserts = [...src.matchAll(/\.from\(['"]events['"]\)\s*\.upsert\(/g)]
    expect(upserts).toHaveLength(1)
    expect(src).toContain('screenBatch')
  })
})
