import { NextRequest, NextResponse } from 'next/server'
import { runAllIngest } from '@/lib/ingest'

// Manual / local ingest trigger — runs all three sources in one request (auth: Bearer
// CRON_SECRET). The SCHEDULED path no longer runs here: a full ingest can't finish inside
// Vercel's function timeout, so it runs as a nightly GitHub Actions workflow (one job per
// source, calling runFriscoIngest / runPlanoIngest / runPlayFriscoIngest directly). This
// endpoint stays for ad-hoc local runs and quick manual refreshes. See INGEST-DESIGN.md.
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runAllIngest()
  return NextResponse.json(result)
}
