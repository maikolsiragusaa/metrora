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

  it('does not copy Codex timing onto an untimed Zed delivery of the same model', () => {
    const projects = [{
      sessions: [{
        turns: [
          { assistantCalls: [{ model: 'GPT-5.6 Luna', modelProvider: 'openai', provider: 'codex', activeDurationMs: 1_000, activeGeneratedTokens: 1_000, usage: { outputTokens: 1_000, reasoningTokens: 0 } }] },
          { assistantCalls: [{ model: 'GPT-5.6 Luna', modelProvider: 'zed.dev', provider: 'zed', usage: { outputTokens: 5, reasoningTokens: 0 } }] },
        ],
        modelBreakdown: {},
      }],
    }] as unknown as ProjectSummary[]
    const rows = enrichModelsWithObservedPerformance([
      { name: 'GPT-5.6 Luna', modelProvider: 'openai' },
      { name: 'GPT-5.6 Luna', modelProvider: 'zed.dev' },
    ], projects)

    expect(rows[0]).toMatchObject({ activeDurationMs: 1_000, activeGeneratedTokens: 1_000 })
    expect(rows[1]).toEqual({ name: 'GPT-5.6 Luna', modelProvider: 'zed.dev' })
  })

  it('does not let one model consume another model\'s same-route timing identity', () => {
    const projects = [{
      sessions: [{
        turns: [
          { assistantCalls: [{ model: 'gpt-5.4', modelProvider: 'openai', provider: 'codex', activeDurationMs: 1_000, activeGeneratedTokens: 1_000, usage: { outputTokens: 1_000, reasoningTokens: 0 } }] },
          { assistantCalls: [{ model: 'gpt-5.5', modelProvider: 'openai', provider: 'codex', activeDurationMs: 2_000, activeGeneratedTokens: 2_000, usage: { outputTokens: 2_000, reasoningTokens: 0 } }] },
        ],
        modelBreakdown: {},
      }],
    }] as unknown as ProjectSummary[]
    const rows = enrichModelsWithObservedPerformance([
      { name: 'gpt-5.4', modelProvider: 'openai' },
      { name: 'gpt-5.5', modelProvider: 'openai' },
    ], projects)

    expect(rows[0]).toMatchObject({ activeDurationMs: 1_000, activeGeneratedTokens: 1_000 })
    expect(rows[1]).toMatchObject({ activeDurationMs: 2_000, activeGeneratedTokens: 2_000 })
  })
})
