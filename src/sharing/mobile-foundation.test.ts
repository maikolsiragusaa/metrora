import { describe, expect, it } from 'vitest'

import { buildMobileFoundationPayload } from './mobile-foundation.js'
import type { MenubarPayload } from '../menubar-json.js'
import type { ProjectRegistry } from '../project-registry.js'
import type { ProjectSummary } from '../types.js'

function registry(sourceId: string): ProjectRegistry {
  return {
    kind: 'metrora.project-registry',
    version: 1,
    projects: [{
      id: 'mp_metrora',
      name: 'Metrora',
      icon: 'spark',
      color: 'cyan',
      sourceProjectMembership: [sourceId],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  }
}

function payload(): MenubarPayload {
  return {
    generated: '2026-08-14T10:00:00.000Z',
    current: {
      label: 'This month',
      cost: 4,
      savingsUSD: 0,
      calls: 2,
      sessions: 1,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      categories: [],
      models: [],
      topModels: [],
    },
    history: { daily: [{ date: '2026-08-14', cost: 4, savingsUSD: 0, calls: 2, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, topModels: [] }] },
    projectScope: {
      selectedId: 'mp_metrora',
      options: [{ id: 'mp_metrora', name: 'Metrora', icon: 'spark', color: 'cyan', sourceProjectCount: 1 }],
      sourceProjects: [{ id: 'sp_source', name: 'metrora', contributors: [{ sourceId: 'codex', routeIds: ['openai'] }], assignedProjectId: 'mp_metrora' }],
      registry: { status: 'valid', writable: true },
    },
  } as unknown as MenubarPayload
}

function project(): ProjectSummary {
  return {
    project: 'metrora',
    projectPath: '/work/metrora',
    totalCostUSD: 4,
    totalSavingsUSD: 0,
    totalApiCalls: 2,
    totalProxiedCostUSD: 0,
    sessions: [{
      sessionId: 'session-1',
      project: 'metrora',
      firstTimestamp: '2026-08-14T09:00:00.000Z',
      lastTimestamp: '2026-08-14T09:01:00.000Z',
      totalCostUSD: 4,
      totalSavingsUSD: 0,
      apiCalls: 2,
      turns: [],
      modelBreakdown: {},
    }],
  } as unknown as ProjectSummary
}

describe('Mobile Foundation V1 projection', () => {
  it('stays content-minimal and carries Project scope/provenance identities', () => {
    const result = buildMobileFoundationPayload(payload(), [project()], registry('sp_source'))

    expect(result.kind).toBe('metrora.companion.foundation')
    expect(result.projectScope.selectedId).toBe('mp_metrora')
    expect(result.activity.sessions[0]?.title).toMatch(/^Session · /)
    expect(result.activity.sessions[0]?.sourceProjectName).toBe('metrora')
    expect(result.activity.sessions[0]).not.toHaveProperty('prompt')
    expect(result.workspace).toEqual({ available: false, reason: 'no-authority' })
  })
})
