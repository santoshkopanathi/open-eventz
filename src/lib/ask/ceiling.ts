/**
 * The Ask daily question ceiling (spec "Runaway cost": 100 questions a day, about $2).
 *
 * Shared across server instances through the `ask_take_slot` database function
 * (migration 010). FAILS CLOSED: if the function can't be reached or errors for any reason,
 * the slot is refused and Ask shows "unavailable". A forgotten migration therefore costs
 * nothing, which is the lesson of the 009 incident.
 */
export const DAILY_QUESTION_CEILING = 100

export type SlotRpc = (fn: 'ask_take_slot', args: { p_day: string; p_cap: number }) =>
  PromiseLike<{ data: unknown; error: unknown }>

/** True only when the database confirms a slot was taken for `day`. */
export async function takeAskSlot(rpc: SlotRpc, day: string, cap = DAILY_QUESTION_CEILING): Promise<boolean> {
  try {
    const { data, error } = await rpc('ask_take_slot', { p_day: day, p_cap: cap })
    return !error && data === true
  } catch {
    return false
  }
}
