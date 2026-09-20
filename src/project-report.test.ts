import { describe, expect, it } from 'vitest'

import type { DailyEntry } from './daily-cache.js'
import { populateProjectRollups } from './project-report.js'
import type { PeriodData, ProjectSpendProjection } from './menubar-json.js'
import type { ProjectSummary } from './types.js'

function liveProject(): ProjectSummary {
  const session = {
    firstTimestamp: '2026-09-10T12:00:00.000Z',
    totalCostUSD: 9,
    totalSavingsUSD: 0,
    apiCalls: 4,
    totalInputTokens: 10,
    totalOutputTokens: 20,
    modelBreakdown: {},
  }
  return {
    project: '/Users/test/repo',
    projectPath: '/Users/test/repo',
    sessions: [session],
    totalCostUSD: 9,
    totalSavingsUSD: 0,
    totalApiCalls: 4,
    totalProxiedCostUSD: 0,
  } as unknown as ProjectSummary
}

function cacheDay(): DailyEntry {
  return {
    date: '2026-09-10',
    cost: 5,
    savingsUSD: 0,
    calls: 2,
    sessions: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers: {},
    projects: {
      '/Users/test/repo': { cost: 5, calls: 2, savingsUSD: 0, sessions: 1, path: '/Users/test/repo' },
    },
  }
}

describe('project spend projection', () => {
  it('keeps cached totals authoritative while exposing real project calls and daily history', () => {
    const data = {} as PeriodData
    populateProjectRollups(data, [liveProject()], [cacheDay()])

    const row = data.projects?.[0] as ProjectSpendProjection | undefined
    expect(row).toMatchObject({ name: 'repo', cost: 5, calls: 2, sessions: 1 })
    expect(row?.dailySpend).toEqual([{ date: '2026-09-10', cost: 5 }])
    expect(row?.sessionDetails?.[0]).toMatchObject({ cost: 9, calls: 4 })
  })

  it('uses live session history when no durable project cache is available', () => {
    const data = {} as PeriodData
    populateProjectRollups(data, [liveProject()], null)

    expect(data.projects?.[0]).toMatchObject({ name: 'repo', cost: 9, calls: 4, sessions: 1 })
    expect(data.projects?.[0]?.dailySpend).toEqual([{ date: '2026-09-10', cost: 9 }])
  })
})
