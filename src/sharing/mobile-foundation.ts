import { createHash } from 'node:crypto'

import type { MenubarPayload } from '../menubar-json.js'
import type { ProjectSummary } from '../types.js'
import { assignedProjectId, sourceProjectIdForSummary, type ProjectScopePayload } from '../project-scope.js'
import type { ProjectRegistry } from '../project-registry.js'
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
  capabilities: CompanionCapabilitiesV1
  projectScope: ProjectScopePayload
  activity: {
    available: true
    freshness: CapabilityFreshness
    sessions: MobileActivitySessionV1[]
  }
  analyze: {
    models: { available: true; freshness: CapabilityFreshness; rows: MobileModelUsageV1[] }
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

function modelMetadata(payload: MenubarPayload): Map<string, { routeId?: string; sourceIds: string[]; brandId?: string }> {
  const byName = new Map<string, { routeId?: string; sourceIds: string[]; brandId?: string }>()
  for (const row of payload.current.modelAccounting?.rows ?? []) {
    byName.set(row.name, {
      ...(row.provider ? { routeId: row.provider } : {}),
      sourceIds: [...(row.sourceProviders ?? [])].slice(0, 8),
      ...(row.brandId ? { brandId: row.brandId } : {}),
    })
  }
  for (const row of payload.current.topModels) {
    if (!byName.has(row.name)) {
      byName.set(row.name, {
        ...(row.providerId ? { routeId: row.providerId } : {}),
        sourceIds: [],
        ...(row.brandId ? { brandId: row.brandId } : {}),
      })
    }
  }
  return byName
}

export function buildMobileFoundationPayload(
  payload: MenubarPayload,
  projects: ProjectSummary[],
  registry: ProjectRegistry,
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

  const metadata = modelMetadata(payload)
  const rows: MobileModelUsageV1[] = (payload.current.modelAccounting?.rows ?? []).slice(0, 32).map(row => {
    const facts = metadata.get(row.name)
    return {
      name: row.name.slice(0, 160),
      ...(facts?.routeId ? { routeId: facts.routeId } : {}),
      sourceIds: [...(facts?.sourceIds ?? [])].slice(0, 8),
      ...(row.brandId ? { brandId: row.brandId } : {}),
      calls: safeNonNegative(row.calls),
      costMicrosUsd: micros(row.cost),
      inputTokens: safeNonNegative(row.inputTokens),
      outputTokens: safeNonNegative(row.outputTokens),
      cacheReadTokens: safeNonNegative(row.cacheReadTokens),
      cacheWriteTokens: safeNonNegative(row.cacheWriteTokens),
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
    capabilities: buildCompanionCapabilitiesV1(generatedAt),
    projectScope: scope,
    activity: { available: true, freshness: payload.freshness?.readMode === 'fresh' ? 'live' : 'cached', sessions: activity },
    analyze: {
      models: { available: true, freshness: payload.freshness?.readMode === 'fresh' ? 'live' : 'cached', rows },
      spend: { available: true, freshness: payload.freshness?.readMode === 'fresh' ? 'live' : 'cached', data: spend },
    },
    workspace: { available: false, reason: 'no-authority' },
  }
}
