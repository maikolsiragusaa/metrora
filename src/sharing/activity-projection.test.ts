import { describe, expect, it } from 'vitest'

import { buildActivityPullRequestsPage, buildActivitySessionsPage } from './activity-projection.js'
import type { MenubarPayload } from '../menubar-json.js'
import { sourceProjectIdForSummary } from '../project-scope.js'
import type { ProjectRegistry } from '../project-registry.js'
import type { ProjectSummary } from '../types.js'

function registry(sourceId: string): ProjectRegistry {
  return {
    kind: 'metrora.project-registry',
    version: 1,
    projects: [{
      id: 'mp_demo',
      name: 'Demo',
      icon: 'spark',
      color: 'cyan',
      sourceProjectMembership: [sourceId],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  }
}

function payload(sessions: number): MenubarPayload {
  return {
    generated: '2026-08-15T10:00:00.000Z',
    current: { label: 'This month', cost: 4, calls: 4, sessions, topModels: [], topProjects: [], topSessions: [] },
    history: {},
  } as unknown as MenubarPayload
}

function projects(): ProjectSummary[] {
  return [{
    project: 'metrora',
    projectPath: 'C:/Users/fixture/Projects/metrora',
    totalCostUSD: 4,
    totalSavingsUSD: 0,
    totalApiCalls: 4,
    totalProxiedCostUSD: 0,
    sessions: [
      session('old', '2026-08-14T09:00:00.000Z'),
      session('new', '2026-08-15T09:00:00.000Z'),
    ],
  } as unknown as ProjectSummary]
}

function projectAt(projectPath: string, sessionId: string, startedAt: string): ProjectSummary {
  return {
    project: 'metrora',
    projectPath,
    totalCostUSD: 2,
    totalSavingsUSD: 0,
    totalApiCalls: 2,
    totalProxiedCostUSD: 0,
    sessions: [session(sessionId, startedAt)],
  } as unknown as ProjectSummary
}

function session(id: string, startedAt: string): unknown {
  return {
    sessionId: id,
    project: 'metrora',
    firstTimestamp: startedAt,
    lastTimestamp: startedAt.replace('09:00:00', '09:10:00'),
    totalCostUSD: 2,
    totalSavingsUSD: 0,
    totalEstimatedCostUSD: 0,
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalReasoningTokens: 0,
    totalCacheReadTokens: 5,
    totalCacheWriteTokens: 0,
    apiCalls: 2,
    turns: [{ assistantCalls: [{ provider: 'claude', modelProvider: 'anthropic-api' }] }],
    modelBreakdown: { 'claude-opus-4-6': { calls: 2, costUSD: 2, tokens: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 5, cacheCreationInputTokens: 0 } } },
  }
}

const query = {
  period: 'month',
  projectScopeId: 'mp_demo',
  effectiveFrom: '2026-08-01',
  effectiveTo: '2026-08-15',
  order: 'newest' as const,
  limit: 1,
}

describe('bounded Activity projections', () => {
  it('pages canonical newest-first rows without client-side sorting or duplicate rows', () => {
    const sourceId = sourceProjectIdForSummary(projects()[0]!)
    const input = { query, projects: projects(), registry: registry(sourceId), payload: payload(3) }
    const first = buildActivitySessionsPage(input)
    expect(first.sessions).toHaveLength(1)
    expect(first.sessions[0]?.title).toMatch(/^Session · /)
    expect(first.sessions[0]?.sourceProjectName).toBe('metrora')
    expect(first.sessions[0]).not.toHaveProperty('prompt')
    expect(first.nextCursor).toBeTruthy()
    expect(first.coverage).toBe('partial')

    const second = buildActivitySessionsPage(input, first.nextCursor)
    expect(second.sessions).toHaveLength(1)
    expect(second.sessions[0]?.id).not.toBe(first.sessions[0]?.id)
  })

  it('keeps provider filtering in the Desktop projection', () => {
    const sourceId = sourceProjectIdForSummary(projects()[0]!)
    const filtered = buildActivitySessionsPage({
      query: { ...query, provider: 'does-not-exist' },
      projects: projects(),
      registry: registry(sourceId),
      payload: payload(3),
    })
    expect(filtered.sessions).toEqual([])
    expect(filtered.totalCount).toBeNull()
  })

  it('keeps provider and Source Project filters independent and composable', () => {
    const firstProject = projectAt('C:/Users/fixture/Projects/one/metrora', 'first', '2026-08-14T09:00:00.000Z')
    const secondProject = projectAt('D:/Users/fixture/Projects/two/metrora', 'second', '2026-08-15T09:00:00.000Z')
    const firstSourceId = sourceProjectIdForSummary(firstProject)
    const secondSourceId = sourceProjectIdForSummary(secondProject)
    const inputQuery = { ...query, projectScopeId: 'all', limit: 10 }
    const input = {
      projects: [firstProject, secondProject],
      registry: registry(firstSourceId),
      payload: payload(2),
    }

    expect(firstSourceId).not.toBe(secondSourceId)

    const providerPage = buildActivitySessionsPage({ ...input, query: { ...inputQuery, provider: 'claude' } })
    expect(providerPage.sessions).toHaveLength(2)
    expect(providerPage.sessions.map(row => row.sourceProjectId).sort()).toEqual([firstSourceId, secondSourceId].sort())
    expect(providerPage.sessions.every(row => row.sourceIds.includes('claude'))).toBe(true)

    const sourcePage = buildActivitySessionsPage({ ...input, query: { ...inputQuery, source: firstSourceId } })
    expect(sourcePage.sessions).toHaveLength(1)
    expect(sourcePage.sessions[0]).toMatchObject({ sourceProjectId: firstSourceId, sourceProjectName: 'metrora' })

    const composedPage = buildActivitySessionsPage({
      ...input,
      query: {
        ...inputQuery,
        projectScopeId: 'mp_demo',
        source: firstSourceId,
        provider: 'claude',
        route: 'anthropic-api',
        model: 'claude-opus-4-6',
      },
    })
    expect(composedPage.sessions).toHaveLength(1)
    expect(composedPage.sessions[0]?.sourceProjectId).toBe(firstSourceId)

    const wrongSourceForScope = buildActivitySessionsPage({
      ...input,
      query: { ...inputQuery, projectScopeId: 'mp_demo', source: secondSourceId },
    })
    expect(wrongSourceForScope.sessions).toEqual([])

    const firstPrUrl = 'https://github.com/acme/one/pull/1'
    const secondPrUrl = 'https://github.com/acme/two/pull/2'
    for (const [project, url] of [[firstProject, firstPrUrl], [secondProject, secondPrUrl]] as const) {
      const candidate = project.sessions[0]!
      candidate.prLinks = [url]
      candidate.turns = [{
        timestamp: candidate.firstTimestamp,
        prRefs: [url],
        category: 'coding',
        assistantCalls: [{
          provider: 'claude',
          model: 'claude-opus-4-6',
          modelProvider: 'anthropic-api',
          costUSD: 2,
        }],
      }] as typeof candidate.turns
    }
    const scopedPullRequests = buildActivityPullRequestsPage({
      ...input,
      query: {
        ...inputQuery,
        projectScopeId: 'mp_demo',
        source: firstSourceId,
        provider: 'claude',
        route: 'anthropic-api',
        model: 'claude-opus-4-6',
      },
    })
    expect(scopedPullRequests.pullRequests).toHaveLength(1)
    expect(scopedPullRequests.pullRequests[0]?.reference).toBe('acme/one#1')
    expect(scopedPullRequests.attributedCostMicrosUsd).toBe(2_000_000)

    const providerLabelAsSource = buildActivitySessionsPage({
      ...input,
      query: { ...inputQuery, source: 'claude' },
    })
    expect(providerLabelAsSource.sessions).toEqual([])
  })

  it('does not infer provider identity from a model-only session', () => {
    const sourceId = sourceProjectIdForSummary(projects()[0]!)
    const modelOnly = projects()
    modelOnly[0]!.sessions.forEach(session => {
      session.turns = [{
        userMessage: '',
        timestamp: session.firstTimestamp,
        sessionId: session.sessionId,
        assistantCalls: [],
      }] as unknown as typeof session.turns
    })
    const filtered = buildActivitySessionsPage({
      query: { ...query, provider: 'claude' },
      projects: modelOnly,
      registry: registry(sourceId),
      payload: payload(2),
    })
    expect(filtered.sessions).toEqual([])
  })

  it('does not serialize an unavailable priced value as zero', () => {
    const sourceId = sourceProjectIdForSummary(projects()[0]!)
    const noPricing = projects()
    noPricing[0]!.sessions[1]!.totalCostUSD = 0
    noPricing[0]!.sessions[1]!.totalEstimatedCostUSD = 0
    const page = buildActivitySessionsPage({
      query,
      projects: noPricing,
      registry: registry(sourceId),
      payload: payload(2),
    })
    expect(page.sessions[0]?.pricingCoverage).toBe('unavailable')
    expect(page.sessions[0]?.costMicrosUsd).toBeNull()
  })

  it('omits one malformed surviving session and downgrades coverage instead of breaking the page', () => {
    const sourceId = sourceProjectIdForSummary(projects()[0]!)
    const imperfect = projects()
    imperfect[0]!.sessions[0]!.firstTimestamp = ''
    imperfect[0]!.sessions[0]!.lastTimestamp = ''

    const page = buildActivitySessionsPage({
      query: { ...query, limit: 10 },
      projects: imperfect,
      registry: registry(sourceId),
      payload: payload(2),
    })

    expect(page.sessions).toHaveLength(1)
    expect(page.sessions[0]?.startedAt).toBe('2026-08-15T09:00:00.000Z')
    expect(page.availableCount).toBe(1)
    expect(page.totalCount).toBe(2)
    expect(page.coverage).toBe('partial')
  })

  it('keeps canonical Pull Request attribution split and paged', () => {
    const sourceId = sourceProjectIdForSummary(projects()[0]!)
    const withPullRequest = projects()
    const candidate = withPullRequest[0]!.sessions[0]!
    candidate.prLinks = ['https://github.com/acme/repo/pull/42']
    candidate.apiCalls = 1
    candidate.totalCostUSD = 2
    candidate.turns = [{
      timestamp: '2026-08-14T09:00:00.000Z',
      prRefs: ['https://github.com/acme/repo/pull/42'],
      category: 'coding',
      assistantCalls: [{
        provider: 'claude',
        model: 'claude-opus-4-6',
        modelProvider: 'anthropic-api',
        costUSD: 2,
      }],
    }] as typeof candidate.turns
    const page = buildActivityPullRequestsPage({
      query: { ...query, limit: 1 },
      projects: withPullRequest,
      registry: registry(sourceId),
      payload: payload(2),
    })
    expect(page.availableCount).toBe(1)
    expect(page.pullRequests).toHaveLength(1)
    expect(page.pullRequests[0]).toMatchObject({ reference: 'acme/repo#42', costMicrosUsd: 2_000_000 })
    expect(page.attributedCostMicrosUsd).toBe(2_000_000)
    expect(page.unattributedCostMicrosUsd).toBe(0)
    expect(page.pullRequests[0]?.categories?.[0]?.name).toBeTruthy()
  })

  it('does not let an incomplete Pull Request span make the PR page unparseable', () => {
    const sourceId = sourceProjectIdForSummary(projects()[0]!)
    const imperfect = projects()
    const candidate = imperfect[0]!.sessions[0]!
    candidate.prLinks = ['https://github.com/acme/repo/pull/42']
    candidate.firstTimestamp = ''
    candidate.lastTimestamp = ''
    candidate.turns = [{
      timestamp: '',
      prRefs: ['https://github.com/acme/repo/pull/42'],
      category: 'coding',
      assistantCalls: [{ provider: 'claude', model: 'claude-opus-4-6', modelProvider: 'anthropic-api', costUSD: 2 }],
    }] as typeof candidate.turns

    const page = buildActivityPullRequestsPage({
      query: { ...query, limit: 10 },
      projects: imperfect,
      registry: registry(sourceId),
      payload: payload(2),
    })

    expect(page.pullRequests).toEqual([])
    expect(page.coverage).toBe('partial')
    expect(page.attributedCostMicrosUsd).toBe(2_000_000)
  })
})
