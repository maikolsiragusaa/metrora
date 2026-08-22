import type { DailyEntry, ProjectDayStats, ProviderDaySlice } from './daily-cache.js'
import { cloneCategoryStats } from './daily-cache-category-detail.js'
import { cloneModelStats } from './daily-cache-model-detail.js'
import { cloneProjectStats as cloneDurableProjectStats, cloneProjectStatsMap, hasProjectUsage, mergeProjectDetails } from './daily-cache-project-detail.js'

export const UNATTRIBUTED_PROJECT_KEY = '\u0000metrora:unattributed'
export const UNATTRIBUTED_PROJECT_LABEL = 'Unattributed'

export type DurableProjectFilter = {
  include?: string[]
  exclude?: string[]
}

export type DurableProjectScopeOptions = {
  /**
   * True only for a day already produced from a project-filtered live parse.
   * Historical project rollups use durable Source Project detail when present;
   * this flag is reserved for a day already produced from a project-filtered
   * live parse, whose day-level maps are already authoritative.
   */
  preserveDetailedBreakdown?: boolean
}

const FLOAT_EPSILON = 1e-9

function ownRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function patterns(values: string[] | undefined): string[] {
  return (values ?? []).map(value => value.toLowerCase())
}

export function hasDurableProjectFilter(filter: DurableProjectFilter): boolean {
  return (filter.include?.length ?? 0) > 0 || (filter.exclude?.length ?? 0) > 0
}

export function matchesDurableProjectFilter(
  project: string,
  projectPath: string | undefined,
  filter: DurableProjectFilter,
): boolean {
  const name = project.toLowerCase()
  const path = (projectPath ?? '').toLowerCase()
  const include = patterns(filter.include)
  const exclude = patterns(filter.exclude)

  if (include.length > 0 && !include.some(pattern => name.includes(pattern) || path.includes(pattern))) {
    return false
  }
  if (exclude.length > 0 && exclude.some(pattern => name.includes(pattern) || path.includes(pattern))) {
    return false
  }
  return true
}

function cloneProjectStats(stats: ProjectDayStats): ProjectDayStats {
  return cloneDurableProjectStats(stats)
}

function sumProjects(projects: Record<string, ProjectDayStats>): ProjectDayStats {
  const total: ProjectDayStats = { cost: 0, calls: 0, savingsUSD: 0, sessions: 0 }
  for (const stats of Object.values(projects)) {
    const targetHadUsage = hasProjectUsage(total)
    total.cost += stats.cost
    total.calls += stats.calls
    total.savingsUSD += stats.savingsUSD
    total.sessions += stats.sessions
    if (stats.inputTokens !== undefined) total.inputTokens = (total.inputTokens ?? 0) + stats.inputTokens
    if (stats.outputTokens !== undefined) total.outputTokens = (total.outputTokens ?? 0) + stats.outputTokens
    if (stats.reasoningTokens !== undefined) total.reasoningTokens = (total.reasoningTokens ?? 0) + stats.reasoningTokens
    if (stats.additiveReasoningTokens !== undefined) total.additiveReasoningTokens = (total.additiveReasoningTokens ?? 0) + stats.additiveReasoningTokens
    if (stats.cacheReadTokens !== undefined) total.cacheReadTokens = (total.cacheReadTokens ?? 0) + stats.cacheReadTokens
    if (stats.cacheWriteTokens !== undefined) total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + stats.cacheWriteTokens
    mergeProjectDetails(total, stats, targetHadUsage)
  }
  return total
}

function cloneModels(rows: ProviderDaySlice['models'] | undefined): NonNullable<ProviderDaySlice['models']> {
  const out: NonNullable<ProviderDaySlice['models']> = {}
  for (const [name, stats] of Object.entries(rows ?? {})) setOwn(out, name, cloneModelStats(stats))
  return out
}

function cloneCategories(rows: ProviderDaySlice['categories'] | undefined): NonNullable<ProviderDaySlice['categories']> {
  const out: NonNullable<ProviderDaySlice['categories']> = {}
  for (const [name, stats] of Object.entries(rows ?? {})) setOwn(out, name, cloneCategoryStats(stats))
  return out
}

function positiveFloatRemainder(total: number, attributed: number): number {
  const remainder = total - attributed
  return remainder > FLOAT_EPSILON ? remainder : 0
}

function positiveCountRemainder(total: number, attributed: number): number {
  return Math.max(0, total - attributed)
}

function materializeProjects(
  projects: Record<string, ProjectDayStats> | undefined,
  totals: Pick<ProjectDayStats, 'cost' | 'calls' | 'savingsUSD' | 'sessions'>,
): Record<string, ProjectDayStats> {
  const materialized = ownRecord<ProjectDayStats>()
  for (const [name, stats] of Object.entries(projects ?? {})) {
    setOwn(materialized, name, cloneProjectStats(stats))
  }

  const attributed = sumProjects(materialized)
  const unattributed: ProjectDayStats = {
    cost: positiveFloatRemainder(totals.cost, attributed.cost),
    calls: positiveCountRemainder(totals.calls, attributed.calls),
    savingsUSD: positiveFloatRemainder(totals.savingsUSD, attributed.savingsUSD),
    sessions: positiveCountRemainder(totals.sessions, attributed.sessions),
  }
  if (
    unattributed.cost > 0 || unattributed.calls > 0 ||
    unattributed.savingsUSD > 0 || unattributed.sessions > 0
  ) {
    setOwn(materialized, UNATTRIBUTED_PROJECT_KEY, unattributed)
  }
  return materialized
}

function filterProjects(
  projects: Record<string, ProjectDayStats>,
  filter: DurableProjectFilter,
): Record<string, ProjectDayStats> {
  const selected = ownRecord<ProjectDayStats>()
  for (const [name, stats] of Object.entries(projects)) {
    const matchName = name === UNATTRIBUTED_PROJECT_KEY ? UNATTRIBUTED_PROJECT_LABEL : name
    if (matchesDurableProjectFilter(matchName, stats.path, filter)) {
      setOwn(selected, name, cloneProjectStats(stats))
    }
  }
  return selected
}

function projectScopedSlice(
  slice: ProviderDaySlice,
  filter: DurableProjectFilter,
  preserveDetailedBreakdown: boolean,
): ProviderDaySlice {
  const projects = materializeProjects(slice.projects, {
    cost: slice.cost,
    calls: slice.calls,
    savingsUSD: slice.savingsUSD,
    sessions: slice.sessions ?? 0,
  })

  if (!hasDurableProjectFilter(filter)) {
    return {
      ...slice,
      ...(Object.keys(projects).length > 0 ? { projects } : {}),
    }
  }

  const selected = filterProjects(projects, filter)
  const totals = sumProjects(selected)
  const { modelDetail, categoryDetail, ...scalarTotals } = totals
  return {
    ...scalarTotals,
    inputTokens: preserveDetailedBreakdown ? (slice.inputTokens ?? 0) : (scalarTotals.inputTokens ?? 0),
    outputTokens: preserveDetailedBreakdown ? (slice.outputTokens ?? 0) : (scalarTotals.outputTokens ?? 0),
    reasoningTokens: preserveDetailedBreakdown ? slice.reasoningTokens : scalarTotals.reasoningTokens,
    additiveReasoningTokens: preserveDetailedBreakdown ? slice.additiveReasoningTokens : scalarTotals.additiveReasoningTokens,
    cacheReadTokens: preserveDetailedBreakdown ? (slice.cacheReadTokens ?? 0) : (scalarTotals.cacheReadTokens ?? 0),
    cacheWriteTokens: preserveDetailedBreakdown ? (slice.cacheWriteTokens ?? 0) : (scalarTotals.cacheWriteTokens ?? 0),
    editTurns: preserveDetailedBreakdown ? (slice.editTurns ?? 0) : 0,
    oneShotTurns: preserveDetailedBreakdown ? (slice.oneShotTurns ?? 0) : 0,
    models: preserveDetailedBreakdown ? cloneModels(slice.models) : cloneModels(modelDetail?.rows),
    categories: preserveDetailedBreakdown ? cloneCategories(slice.categories) : cloneCategories(categoryDetail?.rows),
    ...(Object.keys(selected).length > 0 ? { projects: selected } : {}),
  }
}

export function sliceDayToProvider(day: DailyEntry, provider: string): DailyEntry {
  const slice = Object.hasOwn(day.providers, provider) ? day.providers[provider] : undefined
  if (!slice) {
    return {
      date: day.date,
      cost: 0,
      savingsUSD: 0,
      calls: 0,
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: {},
      categories: {},
      providers: {},
      ...(day.carried ? { carried: true as const } : {}),
    }
  }

  const providers = ownRecord<ProviderDaySlice>()
  setOwn(providers, provider, {
    ...slice,
    ...(slice.models ? { models: cloneModels(slice.models) } : {}),
    ...(slice.categories ? { categories: cloneCategories(slice.categories) } : {}),
    ...(slice.projects ? { projects: cloneProjectStatsMap(slice.projects) } : {}),
  })
  const projectedSlice = providers[provider]!
  return {
    date: day.date,
    cost: projectedSlice.cost,
    savingsUSD: projectedSlice.savingsUSD ?? 0,
    calls: projectedSlice.calls,
    sessions: projectedSlice.sessions ?? 0,
    inputTokens: projectedSlice.inputTokens ?? 0,
    outputTokens: projectedSlice.outputTokens ?? 0,
    additiveReasoningTokens: projectedSlice.additiveReasoningTokens,
    cacheReadTokens: projectedSlice.cacheReadTokens ?? 0,
    cacheWriteTokens: projectedSlice.cacheWriteTokens ?? 0,
    editTurns: projectedSlice.editTurns ?? 0,
    oneShotTurns: projectedSlice.oneShotTurns ?? 0,
    models: projectedSlice.models ?? {},
    categories: projectedSlice.categories ?? {},
    providers,
    ...(projectedSlice.projects ? { projects: projectedSlice.projects } : {}),
    ...(day.carried ? { carried: true as const } : {}),
  }
}

/**
 * Build a read-only daily projection for a project scope. The durable cache is
 * never rewritten. Legacy totals without a project split are surfaced through
 * the synthetic Unattributed bucket rather than assigned to a real project.
 */
export function reconcileDurableProjectDay(
  day: DailyEntry,
  filter: DurableProjectFilter,
  options: DurableProjectScopeOptions = {},
): DailyEntry {
  const preserveDetailedBreakdown = options.preserveDetailedBreakdown === true
  const projects = materializeProjects(day.projects, day)
  const providers = ownRecord<ProviderDaySlice>()
  for (const [name, slice] of Object.entries(day.providers)) {
    setOwn(providers, name, projectScopedSlice(slice, filter, preserveDetailedBreakdown))
  }

  if (!hasDurableProjectFilter(filter)) {
    return {
      ...day,
      providers,
      ...(Object.keys(projects).length > 0 ? { projects } : {}),
    }
  }

  const selected = filterProjects(projects, filter)
  const totals = sumProjects(selected)
  const { modelDetail, categoryDetail, ...scalarTotals } = totals
  return {
    date: day.date,
    ...scalarTotals,
    inputTokens: preserveDetailedBreakdown ? day.inputTokens : (scalarTotals.inputTokens ?? 0),
    outputTokens: preserveDetailedBreakdown ? day.outputTokens : (scalarTotals.outputTokens ?? 0),
    reasoningTokens: preserveDetailedBreakdown ? day.reasoningTokens : scalarTotals.reasoningTokens,
    additiveReasoningTokens: preserveDetailedBreakdown ? day.additiveReasoningTokens : scalarTotals.additiveReasoningTokens,
    cacheReadTokens: preserveDetailedBreakdown ? day.cacheReadTokens : (scalarTotals.cacheReadTokens ?? 0),
    cacheWriteTokens: preserveDetailedBreakdown ? day.cacheWriteTokens : (scalarTotals.cacheWriteTokens ?? 0),
    editTurns: preserveDetailedBreakdown ? day.editTurns : 0,
    oneShotTurns: preserveDetailedBreakdown ? day.oneShotTurns : 0,
    models: preserveDetailedBreakdown ? cloneModels(day.models) : cloneModels(modelDetail?.rows),
    categories: preserveDetailedBreakdown ? cloneCategories(day.categories) : cloneCategories(categoryDetail?.rows),
    providers,
    ...(Object.keys(selected).length > 0 ? { projects: selected } : {}),
    ...(day.carried ? { carried: true as const } : {}),
  }
}

export function durableProjectDisplayName(projectKey: string): string {
  return projectKey === UNATTRIBUTED_PROJECT_KEY ? UNATTRIBUTED_PROJECT_LABEL : projectKey
}
