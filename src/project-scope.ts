import { createHash } from 'node:crypto'

import type { DailyEntry, ProjectDayStats, ProviderDaySlice } from './daily-cache.js'
import { cloneCategoryStats, setOwn } from './daily-cache-category-detail.js'
import { cloneModelStats } from './daily-cache-model-detail.js'
import { cloneProjectStats, hasProjectUsage, mergeProjectDetails } from './daily-cache-project-detail.js'
import { durableProjectDisplayName } from './durable-project-reconciliation.js'
import { normalizeProjectPathKey, projectNameFromPath } from './project-path-utils.js'
import type { ProjectRegistry, MetroraProject } from './project-registry.js'
import type { ProjectSummary, SessionSummary } from './types.js'

export const ALL_PROJECTS_SCOPE_ID = 'all' as const
export const UNASSIGNED_PROJECTS_SCOPE_ID = 'unassigned' as const
export type ProjectScopeId = typeof ALL_PROJECTS_SCOPE_ID | typeof UNASSIGNED_PROJECTS_SCOPE_ID | string

export type SourceProjectContributor = {
  sourceId: string
  routeIds: string[]
}

export type SourceProjectDescriptor = {
  id: string
  /** Display-safe basename/observed project label; never a full filesystem path. */
  name: string
  contributors: SourceProjectContributor[]
  assignedProjectId: string | null
  historicalOnly?: boolean
}

export type ProjectScopeOption = {
  id: ProjectScopeId
  name: string
  icon: string
  color: string
  sourceProjectCount: number
}

export type ProjectScopePayload = {
  selectedId: ProjectScopeId
  options: ProjectScopeOption[]
  sourceProjects: SourceProjectDescriptor[]
  registry: {
    status: 'missing' | 'valid' | 'migrated' | 'corrupt'
    writable: boolean
  }
}

function sourceIdentityText(projectPath: string, fallback: string): string {
  const normalized = normalizeProjectPathKey(projectPath)
  return normalized || `observed:${fallback.trim().toLowerCase()}`
}

/**
 * Source identity is based on the collector's observed canonical path. It is
 * intentionally independent of the Metrora Project name/icon/color. A
 * collector/provider fallback is only used when no path was observed.
 */
export function sourceProjectId(projectPath: string, fallback = ''): string {
  const digest = createHash('sha256').update(`metrora-source-project:${sourceIdentityText(projectPath, fallback)}`).digest('hex')
  return `sp_${digest}`
}

export function sourceProjectIdForSummary(project: Pick<ProjectSummary, 'projectPath' | 'project'>): string {
  return sourceProjectId(project.projectPath, project.project)
}

/** Stable Source Project IDs are the only values accepted by Activity source filters. */
export function isSourceProjectId(value: string): boolean {
  return /^sp_[a-f0-9]{64}$/.test(value)
}

/** Durable keys without a path never silently equal a live name-only identity. */
export function sourceProjectIdForDurableProject(projectKey: string, projectPath?: string): string {
  return projectPath?.trim()
    ? sourceProjectId(projectPath, projectKey)
    : sourceProjectId('', `historical:${projectKey}`)
}

export function sourceProjectIdForSession(project: Pick<ProjectSummary, 'projectPath' | 'project'>, _session: SessionSummary): string {
  // The merged ProjectSummary path is the canonical cross-provider authority.
  // Session workingDirectory remains provenance, never a membership key.
  return sourceProjectIdForSummary(project)
}

function sourceName(path: string, fallback: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return projectNameFromPath(normalized, fallback).slice(0, 120) || 'Source Project'
}

function contributorForSession(session: SessionSummary): SourceProjectContributor {
  const calls = session.turns.flatMap(turn => turn.assistantCalls)
  const sourceIds = [...new Set(calls.map(call => call.provider).filter(Boolean))].sort()
  const routeIds = [...new Set(calls.map(call => call.modelProvider).filter((value): value is string => Boolean(value)))].sort()
  return { sourceId: sourceIds[0] ?? 'unknown', routeIds }
}

function membershipMap(registry: ProjectRegistry): Map<string, string> {
  const map = new Map<string, string>()
  for (const project of registry.projects) {
    for (const sourceId of project.sourceProjectMembership) map.set(sourceId, project.id)
  }
  return map
}

export function assignedProjectId(registry: ProjectRegistry, sourceId: string): string | null {
  return membershipMap(registry).get(sourceId) ?? null
}

export function sourceProjectsFromSummaries(projects: ProjectSummary[], registry: ProjectRegistry): SourceProjectDescriptor[] {
  const byId = new Map<string, SourceProjectDescriptor>()
  for (const project of projects) {
    const id = sourceProjectIdForSummary(project)
    const existing = byId.get(id)
    const contributors = project.sessions.map(contributorForSession)
    if (!existing) {
      byId.set(id, {
        id,
        name: sourceName(project.projectPath, project.project),
        contributors: [],
        assignedProjectId: assignedProjectId(registry, id),
        historicalOnly: false,
      })
    }
    const target = byId.get(id)!
    for (const contributor of contributors) {
      const current = target.contributors.find(value => value.sourceId === contributor.sourceId)
      if (current) current.routeIds = [...new Set([...current.routeIds, ...contributor.routeIds])].sort()
      else target.contributors.push({ sourceId: contributor.sourceId, routeIds: [...contributor.routeIds] })
    }
    target.contributors.sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function sourceProjectsFromDurableDays(days: DailyEntry[], registry: ProjectRegistry): SourceProjectDescriptor[] {
  const byId = new Map<string, SourceProjectDescriptor>()
  for (const day of days) {
    for (const [projectKey, stats] of Object.entries(day.projects ?? {})) {
      const id = sourceProjectIdForDurableProject(projectKey, stats.path)
      if (byId.has(id)) continue
      byId.set(id, {
        id,
        name: sourceName(stats.path ?? '', stats.path ? projectKey : durableProjectDisplayName(projectKey)),
        contributors: [],
        assignedProjectId: assignedProjectId(registry, id),
        historicalOnly: true,
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function mergeSourceProjects(
  live: SourceProjectDescriptor[],
  historical: SourceProjectDescriptor[],
): SourceProjectDescriptor[] {
  const byId = new Map<string, SourceProjectDescriptor>()
  for (const source of [...historical, ...live]) {
    const existing = byId.get(source.id)
    if (!existing) {
      byId.set(source.id, { ...source, contributors: source.contributors.map(value => ({ ...value, routeIds: [...value.routeIds] })) })
      continue
    }
    existing.historicalOnly = Boolean(existing.historicalOnly && source.historicalOnly)
    for (const contributor of source.contributors) {
      const current = existing.contributors.find(value => value.sourceId === contributor.sourceId)
      if (current) current.routeIds = [...new Set([...current.routeIds, ...contributor.routeIds])].sort()
      else existing.contributors.push({ sourceId: contributor.sourceId, routeIds: [...contributor.routeIds] })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function projectScopeOptions(registry: ProjectRegistry, sourceProjects: SourceProjectDescriptor[]): ProjectScopeOption[] {
  const sourcesByProject = new Map<string, number>()
  for (const source of sourceProjects) {
    if (source.assignedProjectId) sourcesByProject.set(source.assignedProjectId, (sourcesByProject.get(source.assignedProjectId) ?? 0) + 1)
  }
  const projects = registry.projects.map(project => ({
    id: project.id,
    name: project.name,
    icon: project.icon,
    color: project.color,
    sourceProjectCount: sourcesByProject.get(project.id) ?? project.sourceProjectMembership.length,
  }))
  const assigned = new Set(registry.projects.flatMap(project => project.sourceProjectMembership))
  return [
    { id: ALL_PROJECTS_SCOPE_ID, name: 'All projects', icon: 'grid', color: 'cyan', sourceProjectCount: sourceProjects.length },
    { id: UNASSIGNED_PROJECTS_SCOPE_ID, name: 'Unassigned', icon: 'stack', color: 'violet', sourceProjectCount: sourceProjects.filter(source => !assigned.has(source.id)).length },
    ...projects,
  ]
}

export function buildProjectScopePayload(
  registry: ProjectRegistry,
  registryStatus: ProjectScopePayload['registry']['status'],
  projects: ProjectSummary[],
  selectedId?: string | null,
  historicalDays: DailyEntry[] = [],
): ProjectScopePayload {
  const sourceProjects = mergeSourceProjects(
    sourceProjectsFromSummaries(projects, registry),
    sourceProjectsFromDurableDays(historicalDays, registry),
  )
  const options = projectScopeOptions(registry, sourceProjects)
  const requested = selectedId && options.some(option => option.id === selectedId) ? selectedId : ALL_PROJECTS_SCOPE_ID
  return {
    selectedId: requested,
    options,
    sourceProjects,
    registry: { status: registryStatus, writable: registryStatus !== 'corrupt' },
  }
}

function includeSource(scopeId: ProjectScopeId | null | undefined, assignedId: string | null): boolean {
  if (!scopeId || scopeId === ALL_PROJECTS_SCOPE_ID) return true
  if (scopeId === UNASSIGNED_PROJECTS_SCOPE_ID) return assignedId === null
  return assignedId === scopeId
}

export function projectBelongsToScope(registry: ProjectRegistry, project: ProjectSummary, scopeId?: ProjectScopeId | null): boolean {
  return includeSource(scopeId, assignedProjectId(registry, sourceProjectIdForSummary(project)))
}

/** Filter parsed summaries without rebuilding any accounting fields. */
export function filterProjectsByMetroraScope(
  projects: ProjectSummary[],
  registry: ProjectRegistry,
  scopeId?: ProjectScopeId | null,
): ProjectSummary[] {
  if (!scopeId || scopeId === ALL_PROJECTS_SCOPE_ID) return projects
  return projects.filter(project => projectBelongsToScope(registry, project, scopeId))
}

function cloneStats(stats: ProjectDayStats): ProjectDayStats {
  return cloneProjectStats(stats)
}

function cloneModelRows(rows: DailyEntry['models'] | undefined): DailyEntry['models'] {
  const result: DailyEntry['models'] = {}
  for (const [name, stats] of Object.entries(rows ?? {})) setOwn(result, name, cloneModelStats(stats))
  return result
}

function cloneCategoryRows(rows: DailyEntry['categories'] | undefined): DailyEntry['categories'] {
  const result: DailyEntry['categories'] = {}
  for (const [name, stats] of Object.entries(rows ?? {})) setOwn(result, name, cloneCategoryStats(stats))
  return result
}

function addProjectTokenStats(target: ProjectDayStats, source: ProjectDayStats): void {
  if (source.inputTokens !== undefined) target.inputTokens = (target.inputTokens ?? 0) + source.inputTokens
  if (source.outputTokens !== undefined) target.outputTokens = (target.outputTokens ?? 0) + source.outputTokens
  if (source.reasoningTokens !== undefined) target.reasoningTokens = (target.reasoningTokens ?? 0) + source.reasoningTokens
  if (source.additiveReasoningTokens !== undefined) target.additiveReasoningTokens = (target.additiveReasoningTokens ?? 0) + source.additiveReasoningTokens
  if (source.cacheReadTokens !== undefined) target.cacheReadTokens = (target.cacheReadTokens ?? 0) + source.cacheReadTokens
  if (source.cacheWriteTokens !== undefined) target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + source.cacheWriteTokens
}

function scopedProjectStats(
  stats: Record<string, ProjectDayStats> | undefined,
  registry: ProjectRegistry,
  scopeId: ProjectScopeId,
): Record<string, ProjectDayStats> {
  const result: Record<string, ProjectDayStats> = {}
  for (const [name, value] of Object.entries(stats ?? {})) {
    const id = sourceProjectIdForDurableProject(name, value.path)
    if (includeSource(scopeId, assignedProjectId(registry, id))) setOwn(result, name, cloneStats(value))
  }
  return result
}

function sumStats(stats: Record<string, ProjectDayStats>): ProjectDayStats {
  const total: ProjectDayStats = { cost: 0, savingsUSD: 0, calls: 0, sessions: 0 }
  for (const value of Object.values(stats)) {
    const targetHadUsage = hasProjectUsage(total)
    total.cost += value.cost
    total.savingsUSD += value.savingsUSD
    total.calls += value.calls
    total.sessions += value.sessions
    addProjectTokenStats(total, value)
    mergeProjectDetails(total, value, targetHadUsage)
  }
  return total
}

function scopedProviderSlice(
  slice: ProviderDaySlice,
  registry: ProjectRegistry,
  scopeId: ProjectScopeId,
  preserveDetailedBreakdown = false,
): ProviderDaySlice {
  const projects = scopedProjectStats(slice.projects, registry, scopeId)
  const totals = sumStats(projects)
  const { modelDetail, categoryDetail, ...scalarTotals } = totals
  return {
    ...slice,
    ...scalarTotals,
    projects,
    ...(preserveDetailedBreakdown ? {
      inputTokens: slice.inputTokens,
      outputTokens: slice.outputTokens,
      reasoningTokens: slice.reasoningTokens,
      additiveReasoningTokens: slice.additiveReasoningTokens,
      cacheReadTokens: slice.cacheReadTokens,
      cacheWriteTokens: slice.cacheWriteTokens,
      editTurns: slice.editTurns,
      oneShotTurns: slice.oneShotTurns,
      models: cloneModelRows(slice.models),
      categories: cloneCategoryRows(slice.categories),
    } : {
      // Historical project detail is sourced only from the selected Source
      // Project rows. A missing block remains an unavailable empty projection.
      inputTokens: totals.inputTokens ?? 0,
      outputTokens: totals.outputTokens ?? 0,
      reasoningTokens: totals.reasoningTokens,
      additiveReasoningTokens: totals.additiveReasoningTokens,
      cacheReadTokens: totals.cacheReadTokens ?? 0,
      cacheWriteTokens: totals.cacheWriteTokens ?? 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: cloneModelRows(modelDetail?.rows),
      categories: cloneCategoryRows(categoryDetail?.rows),
    }),
  }
}

/** Project-scoped durable days derive detail only from selected Source Project rows. */
export function filterDailyEntryByMetroraScope(
  day: DailyEntry,
  registry: ProjectRegistry,
  scopeId?: ProjectScopeId | null,
  options: { preserveDetailedBreakdown?: boolean } = {},
): DailyEntry {
  if (!scopeId || scopeId === ALL_PROJECTS_SCOPE_ID) return day
  const projects = scopedProjectStats(day.projects, registry, scopeId)
  const totals = sumStats(projects)
  const { modelDetail, categoryDetail, ...scalarTotals } = totals
  const providers: Record<string, ProviderDaySlice> = {}
  for (const [provider, slice] of Object.entries(day.providers)) {
    const scoped = scopedProviderSlice(slice, registry, scopeId, options.preserveDetailedBreakdown === true)
    if (scoped.calls > 0 || (scoped.sessions ?? 0) > 0 || scoped.cost !== 0 || Object.keys(scoped.projects ?? {}).length > 0) setOwn(providers, provider, scoped)
  }
  return {
    ...day,
    ...scalarTotals,
    projects,
    providers,
    ...(options.preserveDetailedBreakdown ? {
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      reasoningTokens: day.reasoningTokens,
      additiveReasoningTokens: day.additiveReasoningTokens,
      cacheReadTokens: day.cacheReadTokens,
      cacheWriteTokens: day.cacheWriteTokens,
      editTurns: day.editTurns,
      oneShotTurns: day.oneShotTurns,
      models: cloneModelRows(day.models),
      categories: cloneCategoryRows(day.categories),
    } : {
      inputTokens: totals.inputTokens ?? 0,
      outputTokens: totals.outputTokens ?? 0,
      reasoningTokens: totals.reasoningTokens,
      additiveReasoningTokens: totals.additiveReasoningTokens,
      cacheReadTokens: totals.cacheReadTokens ?? 0,
      cacheWriteTokens: totals.cacheWriteTokens ?? 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: cloneModelRows(modelDetail?.rows),
      categories: cloneCategoryRows(categoryDetail?.rows),
    }),
  }
}

export function projectForScope(registry: ProjectRegistry, scopeId: ProjectScopeId | null | undefined): MetroraProject | null {
  if (!scopeId || scopeId === ALL_PROJECTS_SCOPE_ID || scopeId === UNASSIGNED_PROJECTS_SCOPE_ID) return null
  return registry.projects.find(project => project.id === scopeId) ?? null
}
