import { createHash } from 'node:crypto'

import type { MenubarPayload } from '../menubar-json.js'
import type { ProjectSummary } from '../types.js'
import { assignedProjectId, sourceProjectIdForSummary, type ProjectScopePayload } from '../project-scope.js'
import type { ProjectRegistry } from '../project-registry.js'
import type { DetailCoverageState, ProjectDetailCoverage } from '../project-coverage.js'
import { buildCompanionCapabilitiesV1, type CompanionCapabilitiesV1, type CapabilityFreshness } from './capability-contract.js'

export const MOBILE_FOUNDATION_KIND = 'metrora.companion.foundation' as const
export const MOBILE_FOUNDATION_VERSION = 1 as const

export type MobileActivitySessionV1 = {
  id: string
  projectId: string
  sourceProjectId: string
  sourceProjectName: string
  title: string
  sourceIds: string[]
  routeIds: string[]
  brandIds: string[]
  models: string[]
  costMicrosUsd: number
  calls: number
  turns: number
  startedAt: string
  endedAt: string
}

export type MobileModelUsageV1 = {
  name: string
  routeId?: string
  sourceIds: string[]
  brandId?: string
  calls: number
  costMicrosUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  canonicalIdentity?: string
  rawModels?: string[]
  semanticVariant?: string
}

export type MobileSpendV1 = {
  costMicrosUsd: number
  calls: number
  sessions: number
  trend: Array<{ date: string; costMicrosUsd: number }>
}

export type MobileFoundationPayload = {
  kind: typeof MOBILE_FOUNDATION_KIND
  version: typeof MOBILE_FOUNDATION_VERSION
  generatedAt: string
  periodLabel: string
  trendGranularity?: string
  capabilities: CompanionCapabilitiesV1
  projectScope: ProjectScopePayload
  activity: {
    available: true
    freshness: CapabilityFreshness
    sessions: MobileActivitySessionV1[]
  }
  analyze: {
    models: {
      available: boolean
      freshness: CapabilityFreshness
      coverage: DetailCoverageState
      tokenCoverage: DetailCoverageState
      historical: boolean
      accountingCoverage: { cost: number | null; calls: number | null; tokenCost: number | null; tokenCalls: number | null }
      rows: MobileModelUsageV1[]
    }
    spend: { available: true; freshness: CapabilityFreshness; data: MobileSpendV1 }
  }
  workspace: { available: false; reason: 'no-authority' }
}

function micros(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(value * 1_000_000))
}

function safeNonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function stableSessionId(projectId: string, sessionId: string, startedAt: string): string {
  return createHash('sha256').update(`metrora-mobile-session:${projectId}:${sessionId}:${startedAt}`).digest('hex').slice(0, 32)
}

function sessionProjectName(project: ProjectSummary, scope: ProjectScopePayload): string {
  const source = scope.sourceProjects.find(value => value.id === sourceProjectIdForSummary(project))
  return source?.name ?? project.project.slice(0, 120)
}

function ratioCoverage(value: number | undefined, hasData: boolean): DetailCoverageState {
  if (!hasData) return 'complete'
  if (value === undefined || !Number.isFinite(value)) return 'unavailable'
  if (value >= 0.999999) return 'complete'
  return value > 0 ? 'partial' : 'unavailable'
}

function detailCoverage(payload: MenubarPayload): ProjectDetailCoverage {
  const explicit = payload.current.projectDetailCoverage
  if (explicit) return explicit
  const accounting = payload.current.modelAccounting
  const hasData = payload.current.cost > 0 || payload.current.calls > 0 || payload.current.sessions > 0
  const models = accounting
    ? ratioCoverage(Math.min(accounting.coverage.cost, accounting.coverage.calls), hasData)
    : (hasData ? 'unavailable' : 'complete')
  const tokens = accounting && accounting.rows.length > 0
    ? ratioCoverage(Math.min(accounting.tokenCoverage.cost, accounting.tokenCoverage.calls), hasData)
    : (hasData ? 'unavailable' : 'complete')
  return { models, tokens, categories: hasData ? 'unavailable' : 'complete', historical: false }
}

export function buildMobileFoundationPayload(
  payload: MenubarPayload,
  projects: ProjectSummary[],
  registry: ProjectRegistry,
  trendGranularity?: string,
): MobileFoundationPayload {
  const generatedAt = payload.generated
  const scope = payload.projectScope ?? {
    selectedId: 'all',
    options: [{ id: 'all', name: 'All projects', icon: 'grid', color: 'cyan', sourceProjectCount: 0 }],
    sourceProjects: [],
    registry: { status: 'missing' as const, writable: true },
  }
  const selectedScopeId = scope.selectedId
  const sourceName = new Map(scope.sourceProjects.map(source => [source.id, source.name]))
  const activity: MobileActivitySessionV1[] = []
  for (const project of projects) {
    const sourceProjectId = sourceProjectIdForSummary(project)
    const projectId = assignedProjectId(registry, sourceProjectId) ?? 'unassigned'
    const projectName = sourceName.get(sourceProjectId) ?? project.project.slice(0, 120)
    for (const session of project.sessions) {
      const calls = session.turns.flatMap(turn => turn.assistantCalls)
      const sourceIds = [...new Set(calls.map(call => call.provider).filter(Boolean))].sort().slice(0, 8)
      const routeIds = [...new Set(calls.map(call => call.modelProvider).filter((value): value is string => Boolean(value)))].sort().slice(0, 8)
      const brandIds = [...new Set((payload.current.modelAccounting?.rows ?? [])
        .filter(row => Object.keys(session.modelBreakdown).includes(row.name) && row.brandId)
        .map(row => row.brandId!))].sort().slice(0, 8)
      const date = session.firstTimestamp?.slice(0, 10) || 'unknown date'
      activity.push({
        id: stableSessionId(projectId, session.sessionId, session.firstTimestamp),
        projectId,
        sourceProjectId,
        sourceProjectName: projectName,
        // Session titles can contain user content. The mobile default is
        // deliberately metadata-only; the full title remains desktop-owned.
        title: `Session · ${date}`,
        sourceIds,
        routeIds,
        brandIds,
        models: Object.keys(session.modelBreakdown).slice(0, 8),
        costMicrosUsd: micros(session.totalCostUSD),
        calls: safeNonNegative(session.apiCalls),
        turns: safeNonNegative(session.turns.length),
        startedAt: session.firstTimestamp,
        endedAt: session.lastTimestamp,
      })
      if (activity.length >= 128) break
    }
    if (activity.length >= 128) break
  }
  activity.sort((a, b) => (b.costMicrosUsd - a.costMicrosUsd) || b.startedAt.localeCompare(a.startedAt))

  const coverage = detailCoverage(payload)
  const accounting = payload.current.modelAccounting
  const rows: MobileModelUsageV1[] = (payload.current.modelAccounting?.rows ?? []).slice(0, 32).map(row => {
    return {
      name: row.name.slice(0, 160),
      ...(row.provider ? { routeId: row.provider } : {}),
      sourceIds: [...(row.sourceProviders ?? [])].slice(0, 8),
      ...(row.brandId ? { brandId: row.brandId } : {}),
      calls: safeNonNegative(row.calls),
      costMicrosUsd: micros(row.cost),
      inputTokens: safeNonNegative(row.inputTokens),
      outputTokens: safeNonNegative(row.outputTokens),
      cacheReadTokens: safeNonNegative(row.cacheReadTokens),
      cacheWriteTokens: safeNonNegative(row.cacheWriteTokens),
      ...(row.canonicalIdentity ? { canonicalIdentity: row.canonicalIdentity.slice(0, 160) } : {}),
      ...(row.rawModels && row.rawModels.length > 0 ? { rawModels: row.rawModels.slice(0, 8).map(value => value.slice(0, 160)) } : {}),
      ...(row.semanticVariant ? { semanticVariant: row.semanticVariant.slice(0, 80) } : {}),
    }
  })
  const daily = payload.history.periodDaily ?? payload.history.daily
  const spend: MobileSpendV1 = {
    costMicrosUsd: micros(payload.current.cost),
    calls: safeNonNegative(payload.current.calls),
    sessions: safeNonNegative(payload.current.sessions),
    trend: daily.slice(-128).map(point => ({ date: point.date, costMicrosUsd: micros(point.cost) })),
  }

  return {
    kind: MOBILE_FOUNDATION_KIND,
    version: MOBILE_FOUNDATION_VERSION,
    generatedAt,
    periodLabel: payload.current.label,
    ...(trendGranularity === 'day' || trendGranularity === 'week' || trendGranularity === 'month' ? { trendGranularity } : {}),
    capabilities: buildCompanionCapabilitiesV1(generatedAt),
    projectScope: scope,
    activity: { available: true, freshness: payload.freshness?.readMode === 'fresh' ? 'live' : 'cached', sessions: activity },
    analyze: {
      models: {
        available: coverage.models !== 'unavailable' || rows.length > 0,
        freshness: payload.freshness?.readMode === 'fresh' ? 'live' : 'cached',
        coverage: coverage.models,
        tokenCoverage: coverage.tokens,
        historical: coverage.historical,
        accountingCoverage: {
          cost: accounting?.coverage.cost ?? null,
          calls: accounting?.coverage.calls ?? null,
          tokenCost: accounting?.tokenCoverage.cost ?? null,
          tokenCalls: accounting?.tokenCoverage.calls ?? null,
        },
        rows,
      },
      spend: { available: true, freshness: payload.freshness?.readMode === 'fresh' ? 'live' : 'cached', data: spend },
    },
    workspace: { available: false, reason: 'no-authority' },
  }
}
