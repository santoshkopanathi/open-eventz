import { BigQuery } from '@google-cloud/bigquery'
import type { AnalyticsRow } from './measurement'

// Reads the GA4 BigQuery export and maps it to the AnalyticsRow[] shape the measurement
// framework consumes. Server-only (uses a service-account key from env). Never import this
// from client code.

const DATASET = 'analytics_546304403'

// Lazily build the client from GCP_SA_KEY_B64 (base64 of the service-account JSON). Returns
// null when the key is absent, so callers degrade gracefully instead of throwing at import.
let client: BigQuery | null = null
function getClient(): BigQuery | null {
  if (client) return client
  const b64 = process.env.GCP_SA_KEY_B64
  if (!b64) return null
  const creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
    project_id: string
    client_email: string
    private_key: string
  }
  client = new BigQuery({
    projectId: creds.project_id,
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
  })
  return client
}

// One row shape returned by the query below (pre-mapping).
export interface BqRow {
  visitor_id: string | null
  session_id: string | null
  event_name: string | null
  timestamp_ms: number | string | null
  channel: string | null
  event_id: string | null
}

/** Pure: coerce a BigQuery row to an AnalyticsRow, or null if it's missing identity fields. */
export function mapBqRow(r: BqRow): AnalyticsRow | null {
  if (!r.visitor_id || !r.session_id || !r.event_name) return null
  return {
    visitor_id: r.visitor_id,
    session_id: r.session_id,
    event_name: r.event_name,
    timestamp: Number(r.timestamp_ms ?? 0),
    channel: r.channel ?? undefined,
    event_id: r.event_id ?? undefined,
  }
}

export type FetchStatus = 'ok' | 'no-key' | 'no-data' | 'error'
export interface AnalyticsFetch {
  rows: AnalyticsRow[]
  status: FetchStatus
  message?: string
}

/**
 * Fetch the last 90 days of GA4 events from the BigQuery export, mapped to AnalyticsRow[].
 * Degrades gracefully: no key → 'no-key'; export tables not created yet → 'no-data'.
 */
export async function fetchAnalyticsRows(): Promise<AnalyticsFetch> {
  const bq = getClient()
  if (!bq) return { rows: [], status: 'no-key' }

  const projectId = await bq.getProjectId()
  const query = `
    SELECT
      user_pseudo_id AS visitor_id,
      CONCAT(user_pseudo_id, '.',
        CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS session_id,
      event_name,
      CAST(event_timestamp / 1000 AS INT64) AS timestamp_ms,
      IFNULL(traffic_source.medium, '(none)') AS channel,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'event_id') AS event_id
    FROM \`${projectId}.${DATASET}.events_*\`
    WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY))
  `
  try {
    const [rows] = await bq.query({ query })
    const mapped = (rows as BqRow[]).map(mapBqRow).filter((r): r is AnalyticsRow => r !== null)
    return { rows: mapped, status: mapped.length ? 'ok' : 'no-data' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // A missing wildcard table means the Daily export hasn't produced any tables yet (~24h).
    if (/not found|does not match any table|was not found/i.test(msg)) {
      return { rows: [], status: 'no-data', message: 'No GA4 export tables yet — the Daily export can take ~24h after linking.' }
    }
    return { rows: [], status: 'error', message: msg }
  }
}
