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
      modelAccounting: {
        rows: [
          {
            name: 'claude-opus-4-6',
            cost: 3,
            savingsUSD: 0,
            calls: 1,
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            tokenDetail: true,
            provider: 'anthropic-api',
            sourceProviders: ['claude-cli'],
            brandId: 'anthropic',
          },
          {
            name: 'claude-opus-4-6',
            cost: 1,
            savingsUSD: 0,
            calls: 1,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            tokenDetail: false,
            sourceProviders: ['codex'],
            brandId: 'anthropic',
          },
        ],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 0.75, calls: 0.5 },
      },
      projectDetailCoverage: { models: 'complete', tokens: 'partial', categories: 'complete', historical: false },
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

function bulkProject(name: string, path: string, count: number, start: string): ProjectSummary {
  const startMs = Date.parse(start)
  return {
    project: name,
    projectPath: path,
    totalCostUSD: count,
    totalSavingsUSD: 0,
    totalApiCalls: count,
    totalProxiedCostUSD: 0,
    sessions: Array.from({ length: count }, (_, index) => {
      const timestamp = new Date(startMs + index * 60_000).toISOString()
      return {
        sessionId: `${name}-session-${index}`,
        project: name,
        firstTimestamp: timestamp,
        lastTimestamp: new Date(Date.parse(timestamp) + 30_000).toISOString(),
        totalCostUSD: 1,
        totalSavingsUSD: 0,
        apiCalls: 1,
        turns: [],
        modelBreakdown: {},
      }
    }),
  } as unknown as ProjectSummary
}

describe('Mobile Foundation V1 projection', () => {
  it('stays content-minimal and carries Project scope/provenance identities', () => {
    const result = buildMobileFoundationPayload(payload(), [project()], registry('sp_source'))

    expect(result.kind).toBe('metrora.companion.foundation')
    expect(result.projectScope.selectedId).toBe('mp_metrora')
    expect(result.activity.sessions[0]?.title).toMatch(/^Session · /)
    expect(result.activity.sessions[0]?.sourceProjectName).toBe('metrora')
    expect(result.activity.coverage).toBe('complete')
    expect(result.activity.freshness).toBe('unknown')
    expect(result.activity.sessions[0]).not.toHaveProperty('prompt')
    expect(result.workspace).toEqual({ available: false, reason: 'no-authority' })
  })

  it('keeps same-name accounting rows separate when route or source provenance differs', () => {
    const result = buildMobileFoundationPayload(payload(), [project()], registry('sp_source'))
    const rows = result.analyze.models.rows.filter(row => row.name === 'claude-opus-4-6')

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ brandId: 'anthropic', routeId: 'anthropic-api', sourceIds: ['claude-cli'] })
    expect(rows[1]).toMatchObject({ brandId: 'anthropic', sourceIds: ['codex'] })
    expect(rows[1]).not.toHaveProperty('routeId')
    expect(rows.map(row => row.costMicrosUsd)).toEqual([3_000_000, 1_000_000])
  })

  it('propagates partial historical detail without turning missing rows into zero coverage', () => {
    const result = buildMobileFoundationPayload(payload(), [project()], registry('sp_source'))

    expect(result.analyze.models.coverage).toBe('complete')
    expect(result.analyze.models.tokenCoverage).toBe('partial')
    expect(result.analyze.models.historical).toBe(false)
    expect(result.analyze.models.accountingCoverage).toEqual({ cost: 1, calls: 1, tokenCost: 0.75, tokenCalls: 0.5 })
  })

  it('selects a globally newest-first bounded Activity projection across Projects', () => {
    const older = bulkProject('older', '/work/older', 80, '2026-08-01T00:00:00.000Z')
    const newer = bulkProject('newer', '/work/newer', 80, '2026-08-03T00:00:00.000Z')
    const scopedPayload = payload()
    scopedPayload.current.sessions = 160

    const result = buildMobileFoundationPayload(scopedPayload, [older, newer], registry('sp_source'))

    expect(result.activity.sessions).toHaveLength(128)
    expect(result.activity.coverage).toBe('partial')
    expect(result.activity.sessions.slice(0, 80).every(session => session.sourceProjectName === 'newer')).toBe(true)
    expect(result.activity.sessions.slice(80).every(session => session.sourceProjectName === 'older')).toBe(true)
    expect(result.activity.sessions).toEqual([...result.activity.sessions].sort((a, b) => {
      const byTime = Date.parse(b.startedAt) - Date.parse(a.startedAt)
      return byTime || b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id)
    }))
  })
})
