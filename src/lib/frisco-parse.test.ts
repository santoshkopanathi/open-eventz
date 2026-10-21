import { parseFriscoEventLink } from './frisco-parse'

// Both fragments are real markup, captured before and after the 2026-10-21 move.
const OLD_CARD = '<div class="cp-event-title"><h3 class="cp-heading"><a href="https://friscolibrary.bibliocommons.com/events/6a57b333f4e5db3d00c1e70f" class="cp-link" data-key="event-link">Family Story Time</a></h3></div>'
const NEW_CARD = '<div class="cp-event-title"><h3 class="cp-heading"><a href="https://friscolibrary.bibliocommons.com/v2/events/6a56da92f4e5db3d00c1d05f" class="cp-link" data-key="event-link">Read to Rover</a></h3></div>'
// The "View all dates" link sits in the same card and must never be mistaken for the event.
const SERIES_LINK = '<a class="cp-link all-dates" href="https://friscolibrary.bibliocommons.com/v2/events?series=6a56da924523092f00301514" data-key="all-dates">View all dates</a>'

describe('parseFriscoEventLink', () => {
  test('reads the pre-2026-10-21 link form', () => {
    expect(parseFriscoEventLink(OLD_CARD)).toEqual({
      url: 'https://friscolibrary.bibliocommons.com/events/6a57b333f4e5db3d00c1e70f',
      id: '6a57b333f4e5db3d00c1e70f',
    })
  })

  // REGRESSION: this form returned null for every card, so the ingest reported an empty
  // calendar instead of a broken parser.
  test('reads the /v2/ link form the site moved to', () => {
    expect(parseFriscoEventLink(NEW_CARD)).toEqual({
      url: 'https://friscolibrary.bibliocommons.com/v2/events/6a56da92f4e5db3d00c1d05f',
      id: '6a56da92f4e5db3d00c1d05f',
    })
  })

  test('the id is unchanged by the move — stored rows keep their identity', () => {
    const sameEventBothWays = [
      'href="https://friscolibrary.bibliocommons.com/events/abc123"',
      'href="https://friscolibrary.bibliocommons.com/v2/events/abc123"',
    ].map(c => parseFriscoEventLink(c)?.id)
    expect(sameEventBothWays).toEqual(['abc123', 'abc123'])
  })

  test('a series ("View all dates") link is not an event link', () => {
    expect(parseFriscoEventLink(SERIES_LINK)).toBeNull()
  })

  test('a card with no event link returns null, so the caller can call it a parse failure', () => {
    expect(parseFriscoEventLink('<div class="cp-events-search-item">no link here</div>')).toBeNull()
  })
})
