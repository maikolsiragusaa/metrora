import { describe, expect, it } from 'vitest'

import type { DailyEntry } from '../src/daily-cache.js'
import { filterDailyEntryByMetroraScope, filterProjectsByMetroraScope, sourceProjectIdForSummary } from '../src/project-scope.js'
import type { ProjectRegistry } from '../src/project-registry.js'
import type { ProjectSummary } from '../src/types.js'

function summary(name: string, path: string, cost: number): ProjectSummary {
  return {
    project: name,
    projectPath: path,
    sessions: [],
    totalCostUSD: cost,
    totalSavingsUSD: 0,
    totalApiCalls: cost > 0 ? 1 : 0,
    totalProxiedCostUSD: 0,
  }
}

function registry(projectId: string, sourceId: string): ProjectRegistry {
  return {
    kind: 'metrora.project-registry',
    version: 1,
    projects: [{
      id: projectId,
      name: 'Metrora',
      icon: 'grid',
      color: 'cyan',
      sourceProjectMembership: [sourceId],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  }
}

describe('Metrora Project scope', () => {
  it('keeps All projects, Unassigned and user Project scope distinct', () => {
    const assigned = summary('metrora', '/work/metrora', 4)
    const unassigned = summary('other', '/work/other', 2)
    const projectId = 'mp_1234567890abcdef'
    const scoped = registry(projectId, sourceProjectIdForSummary(assigned))

    expect(filterProjectsByMetroraScope([assigned, unassigned], scoped, 'all')).toHaveLength(2)
    expect(filterProjectsByMetroraScope([assigned, unassigned], scoped, 'unassigned').map(value => value.project)).toEqual(['other'])
    expect(filterProjectsByMetroraScope([assigned, unassigned], scoped, projectId).map(value => value.project)).toEqual(['metrora'])
  })

  it('projects historical totals through cached Source Project stats without copying model detail', () => {
    const assigned = summary('metrora', '/work/metrora', 4)
    const unassigned = summary('other', '/work/other', 2)
    const projectId = 'mp_1234567890abcdef'
    const scoped = registry(projectId, sourceProjectIdForSummary(assigned))
    const day = {
      date: '2026-08-14',
      cost: 6,
      savingsUSD: 0,
      calls: 3,
      sessions: 2,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: { 'gpt-test': { calls: 3, cost: 6, savingsUSD: 0, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      categories: {},
      projects: {
        metrora: { path: '/work/metrora', cost: 4, savingsUSD: 0, calls: 2, sessions: 1 },
        other: { path: '/work/other', cost: 2, savingsUSD: 0, calls: 1, sessions: 1 },
      },
      providers: {},
    } satisfies DailyEntry

    const selected = filterDailyEntryByMetroraScope(day, scoped, projectId)
    const leftover = filterDailyEntryByMetroraScope(day, scoped, 'unassigned')
    expect(selected.cost).toBe(4)
    expect(leftover.cost).toBe(2)
    expect(selected.models).toEqual({})
  })
})
