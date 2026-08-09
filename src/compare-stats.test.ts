import { describe, expect, it } from 'vitest'

import { aggregateModelStats, aggregatePresentationModelStats, computeCategoryComparison, selfCorrectionsForPresentation } from './compare-stats.js'
import type { ProjectSummary } from './types.js'

function projects(): ProjectSummary[] {
  return [{
    sessions: [{
      turns: [
        { category: 'coding', hasEdits: true, retries: 0, assistantCalls: [{ model: 'GPT-5.6 Luna', provider: 'codex', costUSD: 2, usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cachedInputTokens: 0 }, timestamp: '2026-08-08T10:00:00Z', tools: [], speed: 'standard', hasAgentSpawn: false, hasPlanMode: false }] },
        { category: 'coding', hasEdits: false, retries: 0, assistantCalls: [{ model: 'gpt-5.6-luna', provider: 'zed', costUSD: 3, usage: { inputTokens: 10, outputTokens: 30, reasoningTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cachedInputTokens: 0 }, timestamp: '2026-08-08T11:00:00Z', tools: [], speed: 'standard', hasAgentSpawn: false, hasPlanMode: false }] },
      ],
    }],
  }] as unknown as ProjectSummary[]
}

describe('Compare presentation identity', () => {
  it('compares one family row when the same model arrives under different raw labels', () => {
    const rows = aggregatePresentationModelStats(projects())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ model: 'GPT-5.6 Luna', calls: 2, cost: 5 })
  })

  it('keeps raw operational model ids distinct from the presentation projection', () => {
    const rows = aggregateModelStats(projects())
    expect(rows.map(row => row.model)).toEqual(['gpt-5.6-luna', 'GPT-5.6 Luna'])
    expect(rows.map(row => row.calls)).toEqual([1, 1])
  })

  it('matches category evidence against a presentation identity', () => {
    const result = computeCategoryComparison(projects(), 'GPT-5.6 Luna', 'Other model')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ category: 'coding', turnsA: 2, turnsB: 0 })
  })

  it('sums self-correction evidence across raw labels in one family', () => {
    const identity = aggregatePresentationModelStats(projects())[0]!.presentationIdentity
    expect(selfCorrectionsForPresentation(new Map([
      ['GPT-5.6 Luna', 2],
      ['gpt-5.6-luna', 3],
      ['other-model', 9],
    ]), identity)).toBe(5)
  })
})
