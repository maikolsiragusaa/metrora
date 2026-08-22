import {
  mergeDayEntries,
  type CategoryDayStats,
  type DailyEntry,
  type ModelDayStats,
  type ProjectDayStats,
  type ProviderDaySlice,
} from './daily-cache-core.js'
import { cloneCategoryStats } from './daily-cache-category-detail.js'
import { cloneModelStats } from './daily-cache-model-detail.js'
import { cloneProjectStats } from './daily-cache-project-detail.js'

function num(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function hasSliceData(slice: ProviderDaySlice): boolean {
  return slice.cost > 0
    || slice.calls > 0
    || num(slice.savingsUSD) > 0
    || num(slice.inputTokens) > 0
    || num(slice.outputTokens) > 0
    || num(slice.reasoningTokens) > 0
    || num(slice.additiveReasoningTokens) > 0
    || num(slice.cacheReadTokens) > 0
    || num(slice.cacheWriteTokens) > 0
    || num(slice.editTurns) > 0
    || num(slice.oneShotTurns) > 0
}

function hasModelData(model: ModelDayStats): boolean {
  return model.calls > 0
    || model.cost > 0
    || num(model.savingsUSD) > 0
    || model.inputTokens > 0
    || model.outputTokens > 0
    || num(model.reasoningTokens) > 0
    || num(model.additiveReasoningTokens) > 0
    || model.cacheReadTokens > 0
    || model.cacheWriteTokens > 0
}

function subtractModelStats(base: ModelDayStats, sub: ModelDayStats): ModelDayStats | null {
  const calls = Math.max(0, base.calls - num(sub.calls))
  const cost = Math.max(0, base.cost - num(sub.cost))
  const savingsUSD = Math.max(0, num(base.savingsUSD) - num(sub.savingsUSD))
  const inputTokens = Math.max(0, base.inputTokens - num(sub.inputTokens))
  const outputTokens = Math.max(0, base.outputTokens - num(sub.outputTokens))
  const reasoningTokens = Math.max(0, num(base.reasoningTokens) - num(sub.reasoningTokens))
  const additiveReasoningTokens = Math.max(0, num(base.additiveReasoningTokens) - num(sub.additiveReasoningTokens))
  const cacheReadTokens = Math.max(0, base.cacheReadTokens - num(sub.cacheReadTokens))
  const cacheWriteTokens = Math.max(0, base.cacheWriteTokens - num(sub.cacheWriteTokens))

  if (
    calls === 0 && cost === 0 && savingsUSD === 0
    && inputTokens === 0 && outputTokens === 0 && reasoningTokens === 0
    && additiveReasoningTokens === 0
    && cacheReadTokens === 0 && cacheWriteTokens === 0
  ) return null

  return {
    calls,
    cost,
    savingsUSD,
    inputTokens,
    outputTokens,
    ...(base.reasoningTokens !== undefined || sub.reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(base.additiveReasoningTokens !== undefined || sub.additiveReasoningTokens !== undefined
      ? { additiveReasoningTokens } : {}),
    cacheReadTokens,
    cacheWriteTokens,
    ...(base.modelProvider ? { modelProvider: base.modelProvider } : {}),
    ...(base.sourceProviders?.length ? { sourceProviders: [...base.sourceProviders] } : {}),
    ...(base.reasoningSemantics ? { reasoningSemantics: base.reasoningSemantics } : {}),
  }
}

function subtractModels(
  base: Record<string, ModelDayStats> | undefined,
  sub: Record<string, ModelDayStats> | undefined,
): Record<string, ModelDayStats> | undefined {
  if (!base) return undefined
  const out: Record<string, ModelDayStats> = {}
  for (const [name, stats] of Object.entries(base)) {
    const reduced = sub && Object.hasOwn(sub, name) ? subtractModelStats(stats, sub[name]!) : cloneModelStats(stats)
    if (reduced) setOwn(out, name, reduced)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function subtractCategoryStats(base: CategoryDayStats, sub: CategoryDayStats): CategoryDayStats | null {
  const turns = Math.max(0, base.turns - num(sub.turns))
  const cost = Math.max(0, base.cost - num(sub.cost))
  const savingsUSD = Math.max(0, num(base.savingsUSD) - num(sub.savingsUSD))
  const editTurns = Math.max(0, base.editTurns - num(sub.editTurns))
  const oneShotTurns = Math.max(0, base.oneShotTurns - num(sub.oneShotTurns))
  if (turns === 0 && cost === 0 && savingsUSD === 0 && editTurns === 0 && oneShotTurns === 0) return null
  return { turns, cost, savingsUSD, editTurns, oneShotTurns }
}

function subtractCategories(
  base: Record<string, CategoryDayStats> | undefined,
  sub: Record<string, CategoryDayStats> | undefined,
): Record<string, CategoryDayStats> | undefined {
  if (!base) return undefined
  const out: Record<string, CategoryDayStats> = {}
  for (const [name, stats] of Object.entries(base)) {
    const reduced = sub && Object.hasOwn(sub, name) ? subtractCategoryStats(stats, sub[name]!) : cloneCategoryStats(stats)
    if (reduced) setOwn(out, name, reduced)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function detailCoverage(
  base: 'complete' | 'partial',
  sub: 'complete' | 'partial' | undefined,
  missingSubIsPartial: boolean,
): 'complete' | 'partial' {
  return base === 'partial' || sub === 'partial' || (missingSubIsPartial && sub === undefined) ? 'partial' : 'complete'
}

function subtractModelDetail(
  base: NonNullable<ProjectDayStats['modelDetail']>,
  sub: NonNullable<ProjectDayStats['modelDetail']> | undefined,
  missingSubIsPartial: boolean,
): NonNullable<ProjectDayStats['modelDetail']> {
  const rows: NonNullable<ProjectDayStats['modelDetail']>['rows'] = {}
  for (const [name, stats] of Object.entries(base.rows)) {
    const reduced = sub && Object.hasOwn(sub.rows, name) ? subtractModelStats(stats, sub.rows[name]!) : cloneModelStats(stats)
    if (reduced) setOwn(rows, name, reduced)
  }
  return {
    coverage: detailCoverage(base.coverage, sub?.coverage, missingSubIsPartial),
    rows,
  }
}

function subtractCategoryDetail(
  base: NonNullable<ProjectDayStats['categoryDetail']>,
  sub: NonNullable<ProjectDayStats['categoryDetail']> | undefined,
  missingSubIsPartial: boolean,
): NonNullable<ProjectDayStats['categoryDetail']> {
  const rows: NonNullable<ProjectDayStats['categoryDetail']>['rows'] = {}
  for (const [name, stats] of Object.entries(base.rows)) {
    const reduced = sub && Object.hasOwn(sub.rows, name) ? subtractCategoryStats(stats, sub.rows[name]!) : cloneCategoryStats(stats)
    if (reduced) setOwn(rows, name, reduced)
  }
  return {
    coverage: detailCoverage(base.coverage, sub?.coverage, missingSubIsPartial),
    rows,
  }
}

function subtractProjectStats(base: ProjectDayStats, sub: ProjectDayStats): ProjectDayStats | null {
  const cost = Math.max(0, base.cost - num(sub.cost))
  const calls = Math.max(0, base.calls - num(sub.calls))
  const savingsUSD = Math.max(0, num(base.savingsUSD) - num(sub.savingsUSD))
  const sessions = Math.max(0, num(base.sessions) - num(sub.sessions))
  const out: ProjectDayStats = { cost, calls, savingsUSD, sessions, ...(base.path ? { path: base.path } : {}) }
  const subHasUsage = sub.cost > 0 || sub.calls > 0 || num(sub.savingsUSD) > 0
  for (const field of ['inputTokens', 'outputTokens', 'reasoningTokens', 'additiveReasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (base[field] === undefined) continue
    if (subHasUsage && sub[field] === undefined) {
      // A basic-cost/calls subtraction without the token field cannot leave a
      // residual that claims a complete project token split.
      delete out[field]
    } else {
      out[field] = Math.max(0, base[field] - num(sub[field]))
    }
  }
  if (base.modelDetail) {
    out.modelDetail = subtractModelDetail(base.modelDetail, sub.modelDetail, subHasUsage)
  }
  if (base.categoryDetail) {
    out.categoryDetail = subtractCategoryDetail(base.categoryDetail, sub.categoryDetail, subHasUsage)
  }
  if (cost === 0 && calls === 0 && savingsUSD === 0 && sessions === 0
    && (out.inputTokens ?? 0) === 0 && (out.outputTokens ?? 0) === 0
    && (out.reasoningTokens ?? 0) === 0 && (out.cacheReadTokens ?? 0) === 0
    && (out.additiveReasoningTokens ?? 0) === 0
    && (out.cacheWriteTokens ?? 0) === 0) return null
  return out
}

function subtractProjects(
  base: Record<string, ProjectDayStats> | undefined,
  sub: Record<string, ProjectDayStats> | undefined,
): Record<string, ProjectDayStats> | undefined {
  if (!base) return undefined
  const out: Record<string, ProjectDayStats> = {}
  for (const [name, stats] of Object.entries(base)) {
    const reduced = sub && Object.hasOwn(sub, name) ? subtractProjectStats(stats, sub[name]!) : cloneProjectStats(stats)
    if (reduced) setOwn(out, name, reduced)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function subtractSlice(base: ProviderDaySlice, sub: ProviderDaySlice): ProviderDaySlice | null {
  const calls = Math.max(0, base.calls - num(sub.calls))
  const cost = Math.max(0, base.cost - num(sub.cost))
  const savingsUSD = Math.max(0, num(base.savingsUSD) - num(sub.savingsUSD))
  const sessions = Math.max(0, num(base.sessions) - num(sub.sessions))
  const inputTokens = Math.max(0, num(base.inputTokens) - num(sub.inputTokens))
  const outputTokens = Math.max(0, num(base.outputTokens) - num(sub.outputTokens))
  const reasoningTokens = Math.max(0, num(base.reasoningTokens) - num(sub.reasoningTokens))
  const additiveReasoningTokens = Math.max(0, num(base.additiveReasoningTokens) - num(sub.additiveReasoningTokens))
  const cacheReadTokens = Math.max(0, num(base.cacheReadTokens) - num(sub.cacheReadTokens))
  const cacheWriteTokens = Math.max(0, num(base.cacheWriteTokens) - num(sub.cacheWriteTokens))
  const editTurns = Math.max(0, num(base.editTurns) - num(sub.editTurns))
  const oneShotTurns = Math.max(0, num(base.oneShotTurns) - num(sub.oneShotTurns))
  const models = subtractModels(base.models, sub.models)
  const categories = subtractCategories(base.categories, sub.categories)
  const projects = subtractProjects(base.projects, sub.projects)

  const out: ProviderDaySlice = {
    calls,
    cost,
    savingsUSD,
    ...(base.sessions !== undefined || sub.sessions !== undefined ? { sessions } : {}),
    ...(base.inputTokens !== undefined || sub.inputTokens !== undefined ? { inputTokens } : {}),
    ...(base.outputTokens !== undefined || sub.outputTokens !== undefined ? { outputTokens } : {}),
    ...(base.reasoningTokens !== undefined || sub.reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(base.additiveReasoningTokens !== undefined || sub.additiveReasoningTokens !== undefined
      ? { additiveReasoningTokens } : {}),
    ...(base.cacheReadTokens !== undefined || sub.cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(base.cacheWriteTokens !== undefined || sub.cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(base.editTurns !== undefined || sub.editTurns !== undefined ? { editTurns } : {}),
    ...(base.oneShotTurns !== undefined || sub.oneShotTurns !== undefined ? { oneShotTurns } : {}),
    ...(models ? { models } : {}),
    ...(categories ? { categories } : {}),
    ...(projects ? { projects } : {}),
  }
  return hasSliceData(out) || num(out.sessions) > 0 ? out : null
}

function modelDelta(base: ModelDayStats, reduced: ModelDayStats | undefined): ModelDayStats {
  return {
    calls: Math.max(0, base.calls - num(reduced?.calls)),
    cost: Math.max(0, base.cost - num(reduced?.cost)),
    savingsUSD: Math.max(0, num(base.savingsUSD) - num(reduced?.savingsUSD)),
    inputTokens: Math.max(0, base.inputTokens - num(reduced?.inputTokens)),
    outputTokens: Math.max(0, base.outputTokens - num(reduced?.outputTokens)),
    ...(base.reasoningTokens !== undefined || reduced?.reasoningTokens !== undefined
      ? { reasoningTokens: Math.max(0, num(base.reasoningTokens) - num(reduced?.reasoningTokens)) }
      : {}),
    ...(base.additiveReasoningTokens !== undefined || reduced?.additiveReasoningTokens !== undefined
      ? { additiveReasoningTokens: Math.max(0, num(base.additiveReasoningTokens) - num(reduced?.additiveReasoningTokens)) }
      : {}),
    cacheReadTokens: Math.max(0, base.cacheReadTokens - num(reduced?.cacheReadTokens)),
    cacheWriteTokens: Math.max(0, base.cacheWriteTokens - num(reduced?.cacheWriteTokens)),
    ...(base.reasoningSemantics ? { reasoningSemantics: base.reasoningSemantics } : {}),
  }
}

function categoryDelta(base: CategoryDayStats, reduced: CategoryDayStats | undefined): CategoryDayStats {
  return {
    turns: Math.max(0, base.turns - num(reduced?.turns)),
    cost: Math.max(0, base.cost - num(reduced?.cost)),
    savingsUSD: Math.max(0, num(base.savingsUSD) - num(reduced?.savingsUSD)),
    editTurns: Math.max(0, base.editTurns - num(reduced?.editTurns)),
    oneShotTurns: Math.max(0, base.oneShotTurns - num(reduced?.oneShotTurns)),
  }
}

function projectDelta(base: ProjectDayStats, reduced: ProjectDayStats | undefined): ProjectDayStats {
  const out: ProjectDayStats = {
    cost: Math.max(0, base.cost - num(reduced?.cost)),
    calls: Math.max(0, base.calls - num(reduced?.calls)),
    savingsUSD: Math.max(0, num(base.savingsUSD) - num(reduced?.savingsUSD)),
    sessions: Math.max(0, num(base.sessions) - num(reduced?.sessions)),
  }
  const reducedHasUsage = reduced !== undefined && (reduced.cost > 0 || reduced.calls > 0 || num(reduced.savingsUSD) > 0)
  for (const field of ['inputTokens', 'outputTokens', 'reasoningTokens', 'additiveReasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (base[field] === undefined) continue
    if (reducedHasUsage && reduced?.[field] === undefined) {
      delete out[field]
    } else {
      out[field] = Math.max(0, base[field] - num(reduced?.[field]))
    }
  }
  if (base.modelDetail) {
    out.modelDetail = subtractModelDetail(base.modelDetail, reduced?.modelDetail, reduced !== undefined)
  }
  if (base.categoryDetail) {
    out.categoryDetail = subtractCategoryDetail(base.categoryDetail, reduced?.categoryDetail, reduced !== undefined)
  }
  return out
}

function refreshModelSourceProviders(day: DailyEntry, modelName: string): void {
  const aggregate = Object.hasOwn(day.models, modelName) ? day.models[modelName] : undefined
  if (!aggregate) return

  let hasSliceEvidence = false
  const providers: string[] = []
  for (const [provider, slice] of Object.entries(day.providers)) {
    if (!slice.models || !Object.hasOwn(slice.models, modelName)) continue
    hasSliceEvidence = true
    const stats = slice.models[modelName]
    if (stats && hasModelData(stats)) providers.push(provider)
  }
  if (!hasSliceEvidence) return

  if (providers.length > 0) aggregate.sourceProviders = [...new Set(providers)].sort()
  else delete aggregate.sourceProviders
}

function subtractSliceFromDay(day: DailyEntry, provider: string, sub: ProviderDaySlice): void {
  const current = Object.hasOwn(day.providers, provider) ? day.providers[provider] : undefined
  if (!current) return
  const reduced = subtractSlice(current, sub)
  if (reduced) setOwn(day.providers, provider, reduced)
  else delete day.providers[provider]

  day.cost = Math.max(0, day.cost - (current.cost - num(reduced?.cost)))
  day.calls = Math.max(0, day.calls - (current.calls - num(reduced?.calls)))
  day.savingsUSD = Math.max(0, day.savingsUSD - (num(current.savingsUSD) - num(reduced?.savingsUSD)))
  day.sessions = Math.max(0, day.sessions - (num(current.sessions) - num(reduced?.sessions)))
  day.inputTokens = Math.max(0, day.inputTokens - (num(current.inputTokens) - num(reduced?.inputTokens)))
  day.outputTokens = Math.max(0, day.outputTokens - (num(current.outputTokens) - num(reduced?.outputTokens)))
  if (day.reasoningTokens !== undefined || current.reasoningTokens !== undefined || reduced?.reasoningTokens !== undefined) {
    day.reasoningTokens = Math.max(0, num(day.reasoningTokens) - (num(current.reasoningTokens) - num(reduced?.reasoningTokens)))
  }
  if (day.additiveReasoningTokens !== undefined || current.additiveReasoningTokens !== undefined || reduced?.additiveReasoningTokens !== undefined) {
    day.additiveReasoningTokens = Math.max(0, num(day.additiveReasoningTokens) - (num(current.additiveReasoningTokens) - num(reduced?.additiveReasoningTokens)))
  }
  day.cacheReadTokens = Math.max(0, day.cacheReadTokens - (num(current.cacheReadTokens) - num(reduced?.cacheReadTokens)))
  day.cacheWriteTokens = Math.max(0, day.cacheWriteTokens - (num(current.cacheWriteTokens) - num(reduced?.cacheWriteTokens)))
  day.editTurns = Math.max(0, day.editTurns - (num(current.editTurns) - num(reduced?.editTurns)))
  day.oneShotTurns = Math.max(0, day.oneShotTurns - (num(current.oneShotTurns) - num(reduced?.oneShotTurns)))

  for (const [name, stats] of Object.entries(current.models ?? {})) {
    if (!Object.hasOwn(day.models, name)) continue
    const removed = modelDelta(stats, reduced?.models?.[name])
    const next = subtractModelStats(day.models[name]!, removed)
    if (next) setOwn(day.models, name, next)
    else delete day.models[name]
    refreshModelSourceProviders(day, name)
  }

  for (const [name, stats] of Object.entries(current.categories ?? {})) {
    if (!Object.hasOwn(day.categories, name)) continue
    const removed = categoryDelta(stats, reduced?.categories?.[name])
    const next = subtractCategoryStats(day.categories[name]!, removed)
    if (next) setOwn(day.categories, name, next)
    else delete day.categories[name]
  }

  if (day.projects) {
    for (const [name, stats] of Object.entries(current.projects ?? {})) {
      if (!Object.hasOwn(day.projects, name)) continue
      const removed = projectDelta(stats, reduced?.projects?.[name])
      const next = subtractProjectStats(day.projects[name]!, removed)
      if (next) setOwn(day.projects, name, next)
      else delete day.projects[name]
    }
  }
}

function hasPositiveDayContent(day: DailyEntry): boolean {
  return day.cost > 0
    || day.calls > 0
    || day.savingsUSD > 0
    || day.sessions > 0
    || day.inputTokens > 0
    || day.outputTokens > 0
    || num(day.reasoningTokens) > 0
    || num(day.additiveReasoningTokens) > 0
    || day.cacheReadTokens > 0
    || day.cacheWriteTokens > 0
    || day.editTurns > 0
    || day.oneShotTurns > 0
    || Object.keys(day.providers).length > 0
    || Object.keys(day.models).length > 0
    || Object.keys(day.categories).length > 0
    || Object.keys(day.projects ?? {}).length > 0
}

function buildSubtraction(days: DailyEntry[]): Map<string, Map<string, ProviderDaySlice>> {
  const out = new Map<string, Map<string, ProviderDaySlice>>()
  for (const day of days) {
    const providers = new Map<string, ProviderDaySlice>()
    for (const [provider, slice] of Object.entries(day.providers)) providers.set(provider, slice)
    if (providers.size > 0) out.set(day.date, providers)
  }
  return out
}

function addFreshPlaceholdersToResiduals(baseline: DailyEntry[], freshDays: DailyEntry[]): void {
  const freshByDate = new Map(freshDays.map(day => [day.date, day]))
  for (const day of baseline) {
    const fresh = freshByDate.get(day.date)
    if (!fresh) continue
    for (const [provider, residual] of Object.entries(day.providers)) {
      const placeholder = Object.hasOwn(fresh.providers, provider) ? fresh.providers[provider] : undefined
      if (!placeholder || hasSliceData(placeholder) || num(placeholder.sessions) === 0) continue

      residual.sessions = num(residual.sessions) + num(placeholder.sessions)
      if (!residual.projects || !placeholder.projects) continue
      for (const [name, project] of Object.entries(placeholder.projects)) {
        if (!Object.hasOwn(residual.projects, name)) continue
        residual.projects[name]!.sessions += num(project.sessions)
      }
    }
  }
}

/**
 * Remove from the old-timezone baseline exactly the usage still present in the
 * fresh parse when that same parse is bucketed under the OLD timezone. The
 * remainder is genuinely source-gone carried history; the removed portion is
 * the same evidence that moved across midnight and will be emitted by the fresh
 * current-timezone aggregation.
 *
 * This is intentionally a pre-merge transform. It lets Metrora keep the mature
 * generic NEVER-LOSE merge untouched while fixing timezone rebucketing, and it
 * preserves Metrora-only reasoning/model-provider/source-provider provenance.
 */
export function mergeTimezoneRebucketedDays(
  freshDays: DailyEntry[],
  baseline: DailyEntry[],
  freshUnderOldTimezone: DailyEntry[],
): DailyEntry[] {
  const subtraction = buildSubtraction(freshUnderOldTimezone)
  const adjusted: DailyEntry[] = []

  for (const sourceDay of baseline) {
    const day = structuredClone(sourceDay)
    const perProvider = subtraction.get(day.date)
    if (perProvider) {
      for (const [provider, sub] of perProvider) subtractSliceFromDay(day, provider, sub)
    }
    if (hasPositiveDayContent(day)) adjusted.push(day)
  }

  // Generic merge max-dedupes placeholder session counts. After subtraction the
  // residual sessions are known-distinct source-gone sessions, so fold the fresh
  // placeholder counts into the residual slice before handing it to that merge;
  // its existing `residual - placeholder` arithmetic then adds exactly the
  // genuine residual instead of clamping one session away.
  addFreshPlaceholdersToResiduals(adjusted, freshDays)
  return mergeDayEntries(freshDays, adjusted, true)
}
