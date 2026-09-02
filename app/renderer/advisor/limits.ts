/** One authoritative set of bounds shared by Chat and delegated Agents. */
export const HARNESS_TOOL_LOOP_LIMITS = Object.freeze({
  maxSteps: 3,
  maxRounds: 2,
  maxCallsPerTurn: 4,
  maxCallsPerRound: 4,
  maxParallelToolCalls: 1,
  /** One foreground Chat turn cannot outlive this deadline, including reads and synthesis. */
  turnTimeoutMs: 120_000,
})
