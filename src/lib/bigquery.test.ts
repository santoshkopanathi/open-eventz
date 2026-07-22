import { mapBqRow, type BqRow } from './bigquery'

describe('mapBqRow', () => {
  test('maps a full GA4 export row to an AnalyticsRow', () => {
    const r: BqRow = {
      visitor_id: 'u1',
      session_id: 'u1.1690000000',
      event_name: 'event_card_click',
      timestamp_ms: '1754000000000',
      channel: 'organic',
      event_id: 'play-frisco-123',
    }
    expect(mapBqRow(r)).toEqual({
      visitor_id: 'u1',
      session_id: 'u1.1690000000',
      event_name: 'event_card_click',
      timestamp: 1754000000000,
      channel: 'organic',
      event_id: 'play-frisco-123',
    })
  })

  test('null optional fields → undefined', () => {
    const r: BqRow = { visitor_id: 'u1', session_id: 'u1.1', event_name: 'session_start', timestamp_ms: 1, channel: null, event_id: null }
    expect(mapBqRow(r)).toMatchObject({ channel: undefined, event_id: undefined, timestamp: 1 })
  })

  test.each([
    ['no visitor', { visitor_id: null, session_id: 's', event_name: 'e', timestamp_ms: 1, channel: null, event_id: null }],
    ['no session', { visitor_id: 'u', session_id: null, event_name: 'e', timestamp_ms: 1, channel: null, event_id: null }],
    ['no event_name', { visitor_id: 'u', session_id: 's', event_name: null, timestamp_ms: 1, channel: null, event_id: null }],
  ] as [string, BqRow][])('drops rows missing identity (%s)', (_label, r) => {
    expect(mapBqRow(r)).toBeNull()
  })
})
