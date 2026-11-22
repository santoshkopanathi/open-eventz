import { takeAskSlot, DAILY_QUESTION_CEILING, type SlotRpc } from './ceiling'

// The shared daily ceiling must FAIL CLOSED: any doubt means no slot, so Ask shows
// "unavailable" and nothing is spent. The 009 lesson: a missing migration must cost nothing.
describe('takeAskSlot — shared daily ceiling (migration 010)', () => {
  const rpcReturning = (data: unknown, error: unknown = null): SlotRpc => async () => ({ data, error })

  test('progression: a confirmed slot lets the question through, with the approved cap', async () => {
    let seen: { p_day: string; p_cap: number } | null = null
    const rpc: SlotRpc = async (_fn, args) => { seen = args; return { data: true, error: null } }
    expect(await takeAskSlot(rpc, '2026-11-21')).toBe(true)
    expect(seen).toEqual({ p_day: '2026-11-21', p_cap: 100 })
    expect(DAILY_QUESTION_CEILING).toBe(100)
  })

  test('the database says the day is full → no slot', async () => {
    expect(await takeAskSlot(rpcReturning(false), '2026-11-21')).toBe(false)
  })

  test('regression: migration not run (function missing) → fail closed, no slot', async () => {
    expect(await takeAskSlot(rpcReturning(null, { code: 'PGRST202', message: 'function not found' }), '2026-11-21')).toBe(false)
  })

  test('network failure or a thrown error → fail closed, no slot', async () => {
    const throws: SlotRpc = async () => { throw new Error('fetch failed') }
    expect(await takeAskSlot(throws, '2026-11-21')).toBe(false)
  })

  test('anything other than an exact true is not a slot', async () => {
    for (const data of [null, undefined, 'true', 1, {}]) expect(await takeAskSlot(rpcReturning(data), '2026-11-21')).toBe(false)
  })
})
