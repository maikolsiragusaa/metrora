import { describe, expect, it } from 'vitest'

import {
  hasOpenCodeDailyEvidence,
  hasOpenCodeParsedCalls,
} from '../src/opencode-daily-reconciliation.js'
import type { DailyCache } from '../src/daily-cache.js'
import type { ProjectSummary } from '../src/types.js'

describe('OpenCode daily reconciliation safety checks', () => {
  it('recognizes materialized OpenCode history as protected evidence', () => {
    const cache = {
      days: [
        { providers: { opencode: { calls: 4, cost: 0, savingsUSD: 0 } } },
      ],
    } as unknown as Pick<DailyCache, 'days'>

    expect(hasOpenCodeDailyEvidence(cache)).toBe(true)
    expect(hasOpenCodeDailyEvidence({ days: [{ providers: {} }] } as unknown as Pick<DailyCache, 'days'>)).toBe(false)
  })

  it('distinguishes a provider parse with calls from an empty result', () => {
    const empty = [{ sessions: [] }] as unknown as ProjectSummary[]
    const populated = [{
      sessions: [{ turns: [{ assistantCalls: [{}] }] }],
    }] as unknown as ProjectSummary[]

    expect(hasOpenCodeParsedCalls(empty)).toBe(false)
    expect(hasOpenCodeParsedCalls(populated)).toBe(true)
  })
})
