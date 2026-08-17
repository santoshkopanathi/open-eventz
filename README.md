# Open Eventz

Free kids events in Frisco & Plano, TX — aggregated nightly from four public sources, with the
one answer parents actually need up front: **can I drop my child off, or do I need to stay?**

Live at **[openeventz.com](https://openeventz.com)**.

Next.js 16 · Supabase · Vercel · nightly ingest on GitHub Actions · Claude (Sonnet) for
kid-relevance classification at ingest time.

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Needs a `.env.local` with Supabase credentials (see `INGEST-DESIGN.md`). The app reads live
Supabase data; the tests do not.

**Building while a dev server is running** — use a separate output directory, or the build wipes
`.next` underneath the running server and kills it:

```bash
NEXT_DIST_DIR=.next-check npm run build
```

## The checks

```bash
npm run typecheck    # tsc --noEmit
npm test             # Jest unit tests (pure logic, no infra)
TZ=UTC npx jest      # same suite in the other timezone — see below
npm run test:e2e     # Playwright smoke (UI flows, /api mocked)
npm run test:docs    # doc↔test parity
npm run validate     # data-quality gate against the REAL database
npm run ingest -- <source>   # frisco | plano | play-frisco | kaleidoscope | all
```

CI runs the unit suite **twice**, under `TZ=UTC` and `TZ=America/Chicago`. A suite that only runs
in one timezone cannot catch a timezone bug — which is exactly how production once served 5:00 AM
story times.

---

## Documentation

| Doc | What it answers |
|---|---|
| **[BUILD-LOG.md](./BUILD-LOG.md)** | The living record — what we built, *why*, what broke, and what it taught us. Newest entries at the end. Start here. |
| **[GUARDRAILS.md](./GUARDRAILS.md)** | What stops bad data reaching a user, and where each control sits. Includes the governance-framework coverage tables and the gaps we're accepting. |
| **[INGEST-DESIGN.md](./INGEST-DESIGN.md)** | The nightly pipeline: sources, scheduling, the pre-write guard, the data-quality gate, failure alerting, timezone handling. |
| **[SOURCE-ONBOARDING.md](./SOURCE-ONBOARDING.md)** | The repeatable playbook for adding a new event source, and the ten hard-won principles behind it. |
| **[TESTING.md](./TESTING.md)** | How to run every layer of checks. |
| **[TEST-SCENARIOS.md](./TEST-SCENARIOS.md)** | The coverage record — scenario by scenario, each `[A]` row naming its test file (enforced by CI). |
| **[SEO-DESIGN.md](./SEO-DESIGN.md)** | Per-event pages, Event JSON-LD, sitemap/robots, the custom-domain cutover. |

Three of those answer different questions and are easy to confuse: `TESTING.md` = *how do I run
the checks*, `TEST-SCENARIOS.md` = *what behaviour is covered*, `GUARDRAILS.md` = *what stops bad
data reaching a user*. Tests prove the code does what we intended; guardrails handle reality not
matching our intent.

---

## The one rule worth knowing

> **A wrong event time is worse than a missing event.**

A parent who arrives at the wrong hour is failed harder than one who never saw the event. So the
ingest is **fail-closed**: it validates *before* the write, drops events it can't vouch for, and
rejects an entire batch that looks systemically wrong — leaving the previously-stored correct rows
untouched rather than overwriting them with something suspect. Details in
[GUARDRAILS.md](./GUARDRAILS.md).
