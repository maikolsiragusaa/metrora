import { describe, expect, it } from 'vitest'

import { enrichModelsWithObservedPerformance } from './model-performance.js'
import type { ProjectSummary } from './types.js'

function projectsWithTiming(): ProjectSummary[] {
  return [{
    sessions: [{
      modelBreakdown: {
        'gpt-5.4': {
          calls: 1,
          costUSD: 0,
          estimatedCostUSD: 0,
          tokens: {
            inputTokens: 0,
            outputTokens: 10_000,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
          activeDurationMs: 2_500,
          activeGeneratedTokens: 10_000,
        },
        'claude-opus-4-8': {
          calls: 1,
          costUSD: 0,
          estimatedCostUSD: 0,
          tokens: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
      },
    }],
  }] as unknown as ProjectSummary[]
}

describe('observed model performance enrichment', () => {
  it('adds timing only where surviving source evidence is positive', () => {
    const rows = enrichModelsWithObservedPerformance([
      { name: 'gpt-5.4', cost: 10 },
      { name: 'claude-opus-4-8', cost: 5 },
    ], projectsWithTiming())

    expect(rows[0]).toMatchObject({
      name: 'gpt-5.4',
      cost: 10,
      activeDurationMs: 2_500,
      activeGeneratedTokens: 10_000,
    })
    expect(rows[1]).toEqual({ name: 'claude-opus-4-8', cost: 5 })
  })

  it('leaves durable rows untouched when there is no timing evidence', () => {
    const rows = [{ name: 'gpt-5.4', cost: 10 }]
    expect(enrichModelsWithObservedPerformance(rows, [])).toBe(rows)
  })
})
