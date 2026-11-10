// Does what we PUBLISHED match what we would publish right now?
//
// WHY. Every control in this project watches the ingest: did a run happen, did it write
// plausible data, did a source change shape. Nothing watched the other end of the pipe. Between
// 2026-10-06 and 2026-11-10 the sitemap served a build-time snapshot — every event the nightly
// ingest added was invisible to Google until an unrelated deploy — and the city pages were
// three days stale. **Both were found by hand, twice, a fortnight apart.** The per-event SEO
// work was inert for a month and no instrument could have said so.
//
// This is the missing instrument. It is deliberately not a cache-header check: headers tell you
// how a page is configured, and the question is whether the page is CORRECT.
//
// ON RACES, which decide the shape of the result. The database is read FIRST and the live pages
// SECOND. An event written in between therefore appears on the page but not in our expected set
// — an `extra`, which is reported and tolerated. The reverse order would have produced
// `missing` for the same harmless event, and a check that cries wolf during an ingest is a
// check people learn to ignore. Only `missing` fails.

/** An id we expect to find published, with enough context to name it in an alert. */
export interface ExpectedEvent {
  id: string
  title: string
  city: 'frisco' | 'plano'
}

export interface SurfaceResult {
  surface: string
  pass: boolean
  missing: ExpectedEvent[]
  extraCount: number
  detail: string
}

/**
 * Compare one published surface against what the database says belongs on it.
 *
 * `publishedIds` is every event id the surface links to; `expected` is every indexable event
 * that surface should carry. Missing is a failure. Extra is noted, not failed — see the race
 * note above.
 */
export function checkSurface(
  surface: string,
  expected: ExpectedEvent[],
  publishedIds: Set<string>,
): SurfaceResult {
  const missing = expected.filter(e => !publishedIds.has(e.id))
  const expectedIds = new Set(expected.map(e => e.id))
  const extraCount = [...publishedIds].filter(id => !expectedIds.has(id)).length

  // An empty expected set is not evidence of health. If the database says there is nothing to
  // publish, the surface agreeing is correct but uninformative, and a surface that published
  // something anyway is worth a word.
  if (expected.length === 0) {
    return {
      surface,
      pass: true,
      missing: [],
      extraCount,
      detail: extraCount === 0
        ? 'nothing indexable to publish — check is vacuous, not green'
        : `nothing indexable to publish, but the surface lists ${extraCount}`,
    }
  }

  const detail = missing.length === 0
    ? `all ${expected.length} indexable event(s) published${extraCount ? ` (+${extraCount} extra, tolerated)` : ''}`
    : `${missing.length} of ${expected.length} indexable event(s) MISSING — e.g. "${missing[0].title}"`

  return { surface, pass: missing.length === 0, missing, extraCount, detail }
}

/** Every `/events/<id>` reference in a published document, deduplicated. */
export function extractPublishedEventIds(body: string): Set<string> {
  const found = new Set<string>()
  // Matches both the sitemap's absolute <loc> URLs and a page's relative hrefs. The id charset
  // is deliberately narrow — our ids are `<source>-<token>`, so a greedy match would swallow
  // trailing markup.
  for (const m of body.matchAll(/\/events\/([A-Za-z0-9-]+)/g)) found.add(m[1])

  // Drop any id that is a strict prefix of another id we found.
  //
  // Next streams its RSC payload as `self.__next_f.push([1,"…"])` chunks, and a chunk boundary
  // can fall in the middle of a URL — so the same event legitimately appears as both
  // `frisco-library-6a57b29bf4e5db3d00c1` and `…c1e6c8`. Left in, those fragments are counted
  // as events the surface published and we did not expect, which is noise in exactly the field
  // an operator reads to decide whether something is wrong.
  const ids = [...found]
  return new Set(ids.filter(id => !ids.some(other => other !== id && other.startsWith(id))))
}
