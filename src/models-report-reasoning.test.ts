import { describe, expect, it } from 'vitest'

import { aggregateModels } from './models-report.js'
import type { ProjectSummary } from './types.js'

describe('model report reasoning totals', () => {
  it('adds Codex reasoning once while leaving sources without separate evidence unavailable', async () => {
    const projects = [{
      sessions: [{
        turns: [
          { category: 'general', assistantCalls: [{ provider: 'codex', model: 'gpt-5.6-luna', usage: { inputTokens: 10, outputTokens: 100, reasoningTokens: 40, cacheReadInputTokens: 20, cacheCreationInputTokens: 0, cachedInputTokens: 20 }, costUSD: 1 }] },
          { category: 'general', assistantCalls: [{ provider: 'zed', model: 'gpt-5.6-luna', usage: { inputTokens: 10, outputTokens: 100, reasoningTokens: 40, cacheReadInputTokens: 20, cacheCreationInputTokens: 0, cachedInputTokens: 20 }, costUSD: 1 }] },
        ],
      }],
    }] as unknown as ProjectSummary[]
    const rows = await aggregateModels(projects)
    const codex = rows.find(row => row.provider === 'codex')!
    const zed = rows.find(row => row.provider === 'zed')!

    expect(codex).toMatchObject({ outputTokens: 100, reasoningTokens: 40, reasoningSemantics: 'separate', totalTokens: 170 })
    expect(zed).toMatchObject({ outputTokens: 100, reasoningTokens: 0, reasoningSemantics: 'unavailable', totalTokens: 130 })
  })
})
