/**
 * Harness runtime safety bounds. A turn has at most one planning/read round
 * followed by one synthesis/conversation round. Tool calls remain strictly
 * read-only and bounded even when a model returns a large native call list.
 */
export const HARNESS_TOOL_LOOP_LIMITS = Object.freeze({
  maxRounds: 2,
  maxCallsPerTurn: 4,
  maxCallsPerRound: 4,
  /** One foreground Chat turn cannot outlive this deadline, including reads and synthesis. */
  turnTimeoutMs: 120_000,
})
