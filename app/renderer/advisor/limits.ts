/**
 * Harness runtime safety bounds. A turn has at most two planning/read rounds
 * followed by one bounded synthesis/conversation round. Tool calls remain
 * strictly read-only and bounded even when a model returns a large native
 * call list.
 */
export const HARNESS_TOOL_LOOP_LIMITS = Object.freeze({
  maxRounds: 2,
  maxCallsPerTurn: 4,
  maxCallsPerRound: 4,
})
