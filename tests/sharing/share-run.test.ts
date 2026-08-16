import { describe, expect, it } from 'vitest'

import { buildCompanionFoundation, buildCompanionProjectCatalog, buildCompanionUsage, type CompanionUsageAggregator } from '../../src/sharing/share-run.js'
import { buildCompanionProjectCatalogProjection } from '../../src/sharing/project-catalog.js'
import { emptyCache, emptyDailyEntry } from '../../src/daily-cache.js'
import { sourceProjectIdForDurableProject } from '../../src/project-scope.js'
import type { MenubarPayload } from '../../src/menubar-json.js'

describe('companion usage aggregation', () => {
  it('skips the discarded granular timeline on the cold usage path', async () => {
    let observed: { label: string; options: Record<string, unknown> } | undefined
    const payload = {
      generated: '2026-08-14T00:00:00.000Z',
      current: { topProjects: ['private-project'], topSessions: [] },
      history: {},
    } as unknown as MenubarPayload

    const result = await buildCompanionUsage({ period: 'month' }, async (periodInfo, options) => {
      observed = { label: periodInfo.label, options }
      return payload
    })

    expect(observed?.label).toBeTruthy()
    expect(observed?.options).toMatchObject({
      provider: 'all',
      optimize: false,
      timeline: false,
    })
    expect(result.current.topProjects).toEqual([])
  })

  it('uses one canonical Lifetime scope and effective month trend for Usage and Foundation', async () => {
    const observed: Array<{ label: string; options: unknown }> = []
    const payload = {
      generated: '2026-08-15T10:30:00.000Z',
      current: { label: 'Lifetime', topModels: [], topProjects: [], topSessions: [] },
      history: { periodDaily: [] },
      projectScope: {
        selectedId: 'mp_fixture',
        options: [],
        sourceProjects: [],
        registry: { status: 'valid', writable: true },
      },
    } as unknown as MenubarPayload
    const aggregate: CompanionUsageAggregator = async (periodInfo, options) => {
      observed.push({ label: periodInfo.label, options })
      return payload
    }

    await buildCompanionUsage({ period: 'lifetime', projectScopeId: 'mp_fixture' }, aggregate)
    await buildCompanionFoundation({ period: 'lifetime', projectScopeId: 'mp_fixture' }, aggregate)

    expect(observed).toHaveLength(2)
    expect(observed[0]).toEqual(observed[1])
    expect(observed[0]).toMatchObject({
      options: {
        metroraProjectId: 'mp_fixture',
        trendGranularity: 'month',
        timeline: false,
      },
    })
  })

  it('builds the Project catalog from an unscoped lifetime authority', async () => {
    const result = await buildCompanionProjectCatalog(async () => ({
      kind: 'metrora.companion.projects',
      version: 1,
      generatedAt: '2026-08-15T10:30:00.000Z',
      freshness: 'live',
      available: true,
      projectScope: {
        selectedId: 'all',
        options: [
          { id: 'all', name: 'All projects', icon: 'grid', color: 'cyan', sourceProjectCount: 3 },
          { id: 'unassigned', name: 'Unassigned', icon: 'stack', color: 'violet', sourceProjectCount: 1 },
          { id: 'mp_fixture', name: 'Foundation QA Renamed', icon: 'spark', color: 'cyan', sourceProjectCount: 2 },
        ],
        sourceProjects: [
          { id: 'sp_one', name: 'one', contributors: [], assignedProjectId: 'mp_fixture' },
          { id: 'sp_two', name: 'two', contributors: [], assignedProjectId: 'mp_fixture' },
          { id: 'sp_three', name: 'three', contributors: [], assignedProjectId: null },
        ],
        registry: { status: 'valid', writable: true },
      },
    }))

    expect(result).toMatchObject({
      kind: 'metrora.companion.projects',
      version: 1,
      available: true,
      projectScope: {
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'mp_fixture', name: 'Foundation QA Renamed', sourceProjectCount: 2 }),
        ]),
      },
    })
  })

  it('keeps a deterministic Project catalog available when period data is unavailable', async () => {
    const assignedOne = sourceProjectIdForDurableProject('one', '/fixture/one')
    const assignedTwo = sourceProjectIdForDurableProject('two', '/fixture/two')
    const unassigned = sourceProjectIdForDurableProject('three', '/fixture/three')
    const registry = {
      kind: 'metrora.project-registry' as const,
      version: 1 as const,
      projects: [{
        id: 'mp_fixture',
        name: 'Foundation QA Renamed',
        icon: 'spark' as const,
        color: 'cyan' as const,
        sourceProjectMembership: [assignedOne, assignedTwo],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    }
    const cache = emptyCache()
    cache.days = [{
      ...emptyDailyEntry('2026-08-14'),
      projects: {
        one: { cost: 1, calls: 1, savingsUSD: 0, sessions: 1, path: '/fixture/one' },
        two: { cost: 1, calls: 1, savingsUSD: 0, sessions: 1, path: '/fixture/two' },
        three: { cost: 1, calls: 1, savingsUSD: 0, sessions: 1, path: '/fixture/three' },
      },
    }]

    const result = await buildCompanionProjectCatalogProjection({
      now: () => new Date('2026-08-15T10:30:00.000Z'),
      readRegistry: async () => ({ registry, status: 'valid' }),
      loadCache: async () => cache,
      parseTodaySessions: async () => {
        throw new Error('period projection intentionally unavailable')
      },
    }) as {
      generatedAt: string
      freshness: string
      available: boolean
      projectScope: { options: Array<{ id: string; name: string; sourceProjectCount: number }> }
    }

    expect(result).toMatchObject({
      generatedAt: '2026-08-15T10:30:00.000Z',
      freshness: 'cached',
      available: true,
    })
    expect(result.projectScope.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'all', sourceProjectCount: 3 }),
      expect.objectContaining({ id: 'unassigned', sourceProjectCount: 1 }),
      expect.objectContaining({ id: 'mp_fixture', name: 'Foundation QA Renamed', sourceProjectCount: 2 }),
    ]))
    expect(unassigned).not.toBe(assignedOne)
  })
})
