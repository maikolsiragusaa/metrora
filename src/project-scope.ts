import { createHash } from 'node:crypto'

import type { DailyEntry, ProjectDayStats, ProviderDaySlice } from './daily-cache.js'
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
): ProjectScopePayload {
  const sourceProjects = sourceProjectsFromSummaries(projects, registry)
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
  return { ...stats }
}

function scopedProjectStats(
  stats: Record<string, ProjectDayStats> | undefined,
  registry: ProjectRegistry,
  scopeId: ProjectScopeId,
): Record<string, ProjectDayStats> {
  const result: Record<string, ProjectDayStats> = {}
  for (const [name, value] of Object.entries(stats ?? {})) {
    const id = sourceProjectId(value.path ?? name, name)
    if (includeSource(scopeId, assignedProjectId(registry, id))) result[name] = cloneStats(value)
  }
  return result
}

function sumStats(stats: Record<string, ProjectDayStats>): { cost: number; savingsUSD: number; calls: number; sessions: number } {
  return Object.values(stats).reduce(
    (total, value) => ({
      cost: total.cost + value.cost,
      savingsUSD: total.savingsUSD + value.savingsUSD,
      calls: total.calls + value.calls,
      sessions: total.sessions + value.sessions,
    }),
    { cost: 0, savingsUSD: 0, calls: 0, sessions: 0 },
  )
}

function scopedProviderSlice(slice: ProviderDaySlice, registry: ProjectRegistry, scopeId: ProjectScopeId): ProviderDaySlice {
  const projects = scopedProjectStats(slice.projects, registry, scopeId)
  const totals = sumStats(projects)
  return {
    ...slice,
    ...totals,
    projects,
    // Daily caches do not retain model/category detail per Source Project. An
    // empty detail is explicit unavailable data; it avoids assigning a whole
    // day to every selected Project.
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: undefined,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
  }
}

/** Project-scoped durable days reuse cached project totals without inventing model detail. */
export function filterDailyEntryByMetroraScope(
  day: DailyEntry,
  registry: ProjectRegistry,
  scopeId?: ProjectScopeId | null,
): DailyEntry {
  if (!scopeId || scopeId === ALL_PROJECTS_SCOPE_ID) return day
  const projects = scopedProjectStats(day.projects, registry, scopeId)
  const totals = sumStats(projects)
  const providers: Record<string, ProviderDaySlice> = {}
  for (const [provider, slice] of Object.entries(day.providers)) {
    const scoped = scopedProviderSlice(slice, registry, scopeId)
    if (scoped.calls > 0 || (scoped.sessions ?? 0) > 0 || scoped.cost !== 0 || Object.keys(scoped.projects ?? {}).length > 0) providers[provider] = scoped
  }
  return {
    ...day,
    ...totals,
    projects,
    providers,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: undefined,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
  }
}

export function projectForScope(registry: ProjectRegistry, scopeId: ProjectScopeId | null | undefined): MetroraProject | null {
  if (!scopeId || scopeId === ALL_PROJECTS_SCOPE_ID || scopeId === UNASSIGNED_PROJECTS_SCOPE_ID) return null
  return registry.projects.find(project => project.id === scopeId) ?? null
}
