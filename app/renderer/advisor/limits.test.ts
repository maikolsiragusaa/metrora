import { describe, expect, it } from 'vitest'

import { HARNESS_TOOL_LOOP_LIMITS } from './limits'
import { HARNESS_MAX_TOOL_REQUESTS } from './planner'

describe('Harness tool loop limits', () => {
  it('keeps model/tool orchestration bounded', () => {
    expect(HARNESS_TOOL_LOOP_LIMITS).toEqual({ maxSteps: 3, maxRounds: 2, maxCallsPerTurn: 4, maxCallsPerRound: 4, maxParallelToolCalls: 1, turnTimeoutMs: 120_000 })
    expect(HARNESS_MAX_TOOL_REQUESTS).toBe(4)
  })
})
