import { describe, expect, it } from 'vitest'

import type { DailyEntry } from '../src/daily-cache.js'
import {
  buildProjectScopePayload,
  filterDailyEntryByMetroraScope,
  filterProjectsByMetroraScope,
  sourceProjectIdForDurableProject,
  sourceProjectIdForSummary,
} from '../src/project-scope.js'
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

  it('surfaces live and historical-only Source Projects as distinct assignable identities', () => {
    const live = summary('monorepo', '/work/monorepo', 4)
    const projectId = 'mp_1234567890abcdef'
    const liveId = sourceProjectIdForSummary(live)
    const historicalPathId = sourceProjectIdForDurableProject('archive-key', '/archive/monorepo')
    const historicalLegacyId = sourceProjectIdForDurableProject('monorepo')
    const scoped = registry(projectId, liveId)
    scoped.projects[0]!.sourceProjectMembership.push(historicalPathId, historicalLegacyId)
    const historicalDays = [
      {
        date: '2026-08-13', cost: 3, savingsUSD: 0, calls: 2, sessions: 1,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        editTurns: 0, oneShotTurns: 0, models: {}, categories: {}, providers: {},
        projects: { 'archive-key': { path: '/archive/monorepo', cost: 2, savingsUSD: 0, calls: 1, sessions: 1 } },
      },
      {
        date: '2026-08-12', cost: 2, savingsUSD: 0, calls: 1, sessions: 1,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        editTurns: 0, oneShotTurns: 0, models: {}, categories: {}, providers: {},
        projects: { monorepo: { cost: 2, savingsUSD: 0, calls: 1, sessions: 1 } },
      },
    ] satisfies DailyEntry[]

    const scope = buildProjectScopePayload(scoped, 'valid', [live], projectId, historicalDays)
    const byId = new Map(scope.sourceProjects.map(source => [source.id, source]))

    expect(byId.get(liveId)).toMatchObject({ name: 'monorepo', historicalOnly: false, assignedProjectId: projectId })
    expect(byId.get(historicalPathId)).toMatchObject({ name: 'monorepo', historicalOnly: true, assignedProjectId: projectId })
    expect(byId.get(historicalLegacyId)).toMatchObject({ name: 'monorepo', historicalOnly: true, assignedProjectId: projectId })
    expect(new Set([liveId, historicalPathId, historicalLegacyId]).size).toBe(3)

    const pathDay = filterDailyEntryByMetroraScope(historicalDays[0]!, scoped, projectId)
    const legacyDay = filterDailyEntryByMetroraScope(historicalDays[1]!, scoped, projectId)
    expect(pathDay.cost).toBe(2)
    expect(legacyDay.cost).toBe(2)
    expect(pathDay.models).toEqual({})
    expect(legacyDay.models).toEqual({})
  })

  it('preserves today detail only when the caller proves the day is already Project-filtered', () => {
    const assigned = summary('metrora', '/work/metrora', 4)
    const projectId = 'mp_1234567890abcdef'
    const scoped = registry(projectId, sourceProjectIdForSummary(assigned))
    const day = {
      date: '2026-08-14', cost: 4, savingsUSD: 0, calls: 2, sessions: 1,
      inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0,
      editTurns: 0, oneShotTurns: 0,
      models: { 'gpt-test': { calls: 2, cost: 4, savingsUSD: 0, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      categories: { build: { turns: 2, cost: 4, savingsUSD: 0, editTurns: 1, oneShotTurns: 1 } },
      providers: {},
      projects: { metrora: { path: '/work/metrora', cost: 4, savingsUSD: 0, calls: 2, sessions: 1 } },
    } satisfies DailyEntry

    const historical = filterDailyEntryByMetroraScope(day, scoped, projectId)
    const live = filterDailyEntryByMetroraScope(day, scoped, projectId, { preserveDetailedBreakdown: true })
    expect(historical.inputTokens).toBe(0)
    expect(historical.models).toEqual({})
    expect(live.inputTokens).toBe(10)
    expect(live.models).toHaveProperty('gpt-test')
  })
})
