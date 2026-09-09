import { describe, expect, it } from 'vitest'

import { aggregateSessions, renderJson } from './sessions-report.js'
import type { ProjectSummary } from './types.js'

function projectWithCollidingIds(): ProjectSummary[] {
  const base = {
    project: 'metrora',
    firstTimestamp: '2026-08-08T10:00:00.000Z',
    lastTimestamp: '2026-08-08T10:05:00.000Z',
    totalCostUSD: 1,
    totalSavingsUSD: 0,
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalReasoningTokens: 3,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    apiCalls: 1,
    reasoningMix: undefined,
    modelBreakdown: {},
    toolBreakdown: {},
    mcpBreakdown: {},
    bashBreakdown: {},
    categoryBreakdown: {},
    skillBreakdown: {},
    subagentBreakdown: {},
    turns: [],
  }
  return [{
    project: 'metrora',
    projectPath: 'C:/DEV/metrora',
    sessions: [
      { ...base, sessionId: '2974903f-daf3-4545-collision', workingDirectory: 'C:/DEV/metrora', turns: [{ assistantCalls: [{ provider: 'cursor', model: 'gpt-5.4' }] }] },
      { ...base, sessionId: '2974903f-daf3-4545-collision', workingDirectory: 'C:/DEV/metrora-agent', turns: [{ assistantCalls: [{ provider: 'cursor-agent', model: 'gpt-5.4' }] }] },
    ],
  }] as unknown as ProjectSummary[]
}

describe('session projection identity', () => {
  it('keeps raw UUID collisions distinct by provider and project authority', () => {
    const rows = aggregateSessions(projectWithCollidingIds())
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.sessionId)).size).toBe(1)
    expect(new Set(rows.map(row => row.provider)).size).toBe(2)
    expect(new Set(rows.map(row => row.sessionKey)).size).toBe(2)
    expect(rows.map(row => row.sessionKey)).toEqual([
      'cursor\u00002974903f-daf3-4545-collision\u0000metrora\u0000C:/DEV/metrora',
      'cursor-agent\u00002974903f-daf3-4545-collision\u0000metrora\u0000C:/DEV/metrora-agent',
    ])
  })

  it('exposes only separately evidenced reasoning for mixed-source sessions', () => {
    const rows = aggregateSessions([{
      project: 'mixed',
      projectPath: 'C:/mixed',
      sessions: [{
        sessionId: 'mixed-session',
        project: 'mixed',
        firstTimestamp: '2026-08-08T10:00:00.000Z',
        lastTimestamp: '2026-08-08T10:05:00.000Z',
        totalCostUSD: 1,
        totalSavingsUSD: 0,
        totalInputTokens: 20,
        totalOutputTokens: 40,
        totalReasoningTokens: 106,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        apiCalls: 2,
        modelBreakdown: {},
        toolBreakdown: {},
        mcpBreakdown: {},
        bashBreakdown: {},
        categoryBreakdown: {},
        skillBreakdown: {},
        subagentBreakdown: {},
        turns: [{ assistantCalls: [
          { provider: 'codex', model: 'gpt-5.4', usage: { reasoningTokens: 7 } },
          { provider: 'zed', model: 'gpt-5.4', usage: { reasoningTokens: 99 } },
        ] }],
      }],
    }] as unknown as ProjectSummary[])

    expect(rows[0]).toMatchObject({ reasoningSemantics: 'mixed', reasoningTokens: 7, additiveReasoningTokens: 7 })
  })

  it('carries exact session-level pull request links into the bounded row projection', () => {
    const links = ['https://github.com/acme/repo/pull/42']
    const rows = aggregateSessions([{
      project: 'linked',
      projectPath: 'C:/linked',
      sessions: [{
        sessionId: 'linked-session',
        project: 'linked',
        firstTimestamp: '2026-08-08T10:00:00.000Z',
        lastTimestamp: '2026-08-08T10:05:00.000Z',
        totalCostUSD: 1,
        totalSavingsUSD: 0,
        totalInputTokens: 20,
        totalOutputTokens: 40,
        totalReasoningTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        apiCalls: 1,
        prLinks: links,
        modelBreakdown: {},
        toolBreakdown: {},
        mcpBreakdown: {},
        bashBreakdown: {},
        categoryBreakdown: {},
        skillBreakdown: {},
        subagentBreakdown: {},
        turns: [{ assistantCalls: [{ provider: 'codex', model: 'gpt-5.4' }] }],
      }],
    }] as unknown as ProjectSummary[])

    expect(rows[0]?.prLinks).toEqual(links)
  })

  it('projects exact canonical call token activity and preserves aggregate reconciliation', () => {
    const rows = aggregateSessions([{
      project: 'activity',
      projectPath: 'C:/activity',
      sessions: [{
        sessionId: 'activity-session',
        project: 'activity',
        firstTimestamp: '2026-08-08T10:00:00.000Z',
        lastTimestamp: '2026-08-08T10:05:00.000Z',
        totalCostUSD: 1,
        totalSavingsUSD: 0,
        totalInputTokens: 30,
        totalOutputTokens: 50,
        totalReasoningTokens: 8,
        totalCacheReadTokens: 70,
        totalCacheWriteTokens: 5,
        apiCalls: 2,
        modelBreakdown: {},
        toolBreakdown: {},
        mcpBreakdown: {},
        bashBreakdown: {},
        categoryBreakdown: {},
        skillBreakdown: {},
        subagentBreakdown: {},
        turns: [
          {
            timestamp: '2026-08-08T10:00:00.000Z',
            assistantCalls: [{
              provider: 'codex',
              model: 'gpt-5.6',
              timestamp: '2026-08-08T10:00:01.000Z',
              reasoningSemantics: 'separate',
              usage: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 2, reasoningTokens: 3 },
            }],
          },
          {
            timestamp: '2026-08-08T10:05:00.000Z',
            assistantCalls: [{
              provider: 'codex',
              model: 'gpt-5.6',
              timestamp: '2026-08-08T10:04:59.000Z',
              reasoningSemantics: 'separate',
              usage: { inputTokens: 20, outputTokens: 30, cacheReadInputTokens: 40, cacheCreationInputTokens: 3, reasoningTokens: 5 },
            }],
          },
        ],
      }],
    }] as unknown as ProjectSummary[])

    expect(rows[0]?.tokenActivity).toEqual([
      { timestamp: '2026-08-08T10:00:01.000Z', calls: 1, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 2, additiveReasoningTokens: 3, totalTokens: 65 },
      { timestamp: '2026-08-08T10:04:59.000Z', calls: 1, inputTokens: 20, outputTokens: 30, cacheReadTokens: 40, cacheWriteTokens: 3, additiveReasoningTokens: 5, totalTokens: 98 },
    ])
    expect(rows[0]?.tokenActivity?.reduce((sum, point) => sum + point.totalTokens, 0)).toBe(163)
    expect(JSON.parse(renderJson(rows))[0]).not.toHaveProperty('tokenActivity')
    expect(JSON.parse(renderJson(rows, { includeTokenActivity: true }))[0]?.tokenActivity).toEqual(rows[0]?.tokenActivity)
  })
})
