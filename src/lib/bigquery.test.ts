import { mapBqRow, type BqRow } from './bigquery'

const base: BqRow = {
  visitor_id: 'u1', session_id: 'u1.1', event_name: 'session_start',
  timestamp_ms: 1, channel: null, event_id: null, method: null, filter_fields: null, city: null,
}

describe('mapBqRow', () => {
  test('maps a full GA4 export row to an AnalyticsRow', () => {
    const r: BqRow = {
      visitor_id: 'u1',
      session_id: 'u1.1690000000',
      event_name: 'calendar_add',
      timestamp_ms: '1754000000000',
      channel: 'organic',
      event_id: 'play-frisco-123',
      method: 'google',
      filter_fields: 'ages,sources',
      city: 'frisco',
    }
    expect(mapBqRow(r)).toEqual({
      visitor_id: 'u1',
      session_id: 'u1.1690000000',
      event_name: 'calendar_add',
      timestamp: 1754000000000,
      channel: 'organic',
      event_id: 'play-frisco-123',
      method: 'google',
      filter_fields: 'ages,sources',
      city: 'frisco',
    })
  })

  test('null optional fields → undefined', () => {
    expect(mapBqRow({ ...base, channel: null, event_id: null, method: null, filter_fields: null, city: null }))
      .toMatchObject({ channel: undefined, event_id: undefined, method: undefined, filter_fields: undefined, city: undefined, timestamp: 1 })
  })

  test.each([
    ['no visitor', { ...base, visitor_id: null }],
    ['no session', { ...base, session_id: null }],
    ['no event_name', { ...base, event_name: null }],
  ] as [string, BqRow][])('drops rows missing identity (%s)', (_label, r) => {
    expect(mapBqRow(r)).toBeNull()
  })
})
