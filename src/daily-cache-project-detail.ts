import type {
  CategoryDayStats,
  DurableProjectDetailCoverage,
  ModelDayStats,
  ProjectCategoryDetail,
  ProjectDayStats,
  ProjectModelDetail,
} from './daily-cache-types.js'
import { cloneCategoryStats, mergeCategoryStats, sanitizeCategories, setOwn } from './daily-cache-category-detail.js'
import { cloneModelStats, mergeModelStats, sanitizeModels } from './daily-cache-model-detail.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCoverage(value: unknown): value is DurableProjectDetailCoverage {
  return value === 'complete' || value === 'partial'
}

export function cloneModelDetail(detail: ProjectModelDetail): ProjectModelDetail {
  const rows: ProjectModelDetail['rows'] = {}
  for (const [name, stats] of Object.entries(detail.rows)) setOwn(rows, name, cloneModelStats(stats))
  return { coverage: detail.coverage, rows }
}

export function cloneCategoryDetail(detail: ProjectCategoryDetail): ProjectCategoryDetail {
  const rows: ProjectCategoryDetail['rows'] = {}
  for (const [name, stats] of Object.entries(detail.rows)) setOwn(rows, name, cloneCategoryStats(stats))
  return { coverage: detail.coverage, rows }
}

export function cloneProjectStats(stats: ProjectDayStats): ProjectDayStats {
  return {
    cost: stats.cost,
    calls: stats.calls,
    savingsUSD: stats.savingsUSD,
    sessions: stats.sessions,
    ...(stats.inputTokens !== undefined ? { inputTokens: stats.inputTokens } : {}),
    ...(stats.outputTokens !== undefined ? { outputTokens: stats.outputTokens } : {}),
    ...(stats.reasoningTokens !== undefined ? { reasoningTokens: stats.reasoningTokens } : {}),
    ...(stats.additiveReasoningTokens !== undefined ? { additiveReasoningTokens: stats.additiveReasoningTokens } : {}),
    ...(stats.cacheReadTokens !== undefined ? { cacheReadTokens: stats.cacheReadTokens } : {}),
    ...(stats.cacheWriteTokens !== undefined ? { cacheWriteTokens: stats.cacheWriteTokens } : {}),
    ...(stats.path !== undefined ? { path: stats.path } : {}),
    ...(stats.modelDetail ? { modelDetail: cloneModelDetail(stats.modelDetail) } : {}),
    ...(stats.categoryDetail ? { categoryDetail: cloneCategoryDetail(stats.categoryDetail) } : {}),
  }
}

export function cloneProjectStatsMap(
  projects: Record<string, ProjectDayStats> | undefined,
): Record<string, ProjectDayStats> | undefined {
  if (!projects) return undefined
  const out: Record<string, ProjectDayStats> = {}
  for (const [name, stats] of Object.entries(projects)) {
    if (!isRecord(stats)) continue
    setOwn(out, name, cloneProjectStats(stats as ProjectDayStats))
  }
  return out
}

export function hasProjectUsage(stats: ProjectDayStats): boolean {
  return stats.cost > 0 || stats.calls > 0 || stats.savingsUSD > 0
}

type DetailBlock<T> = {
  coverage: DurableProjectDetailCoverage
  rows: Record<string, T>
}

function mergeDetailBlock<T>(
  targetDetail: DetailBlock<T> | undefined,
  sourceDetail: DetailBlock<T> | undefined,
  targetHadUsage: boolean,
  cloneRow: (row: T) => T,
  mergeRow: (target: T, source: T) => void,
): DetailBlock<T> | undefined {
  if (!sourceDetail) {
    if (targetDetail && targetHadUsage) targetDetail.coverage = 'partial'
    return targetDetail
  }

  if (!targetDetail) {
    const copy: DetailBlock<T> = {
      coverage: targetHadUsage || sourceDetail.coverage === 'partial' ? 'partial' : 'complete',
      rows: {},
    }
    for (const [name, row] of Object.entries(sourceDetail.rows)) setOwn(copy.rows, name, cloneRow(row))
    return copy
  }

  for (const [name, row] of Object.entries(sourceDetail.rows)) {
    const existing = Object.hasOwn(targetDetail.rows, name) ? targetDetail.rows[name] : undefined
    if (existing) mergeRow(existing, row)
    else setOwn(targetDetail.rows, name, cloneRow(row))
  }
  if (targetDetail.coverage === 'partial' || sourceDetail.coverage === 'partial') targetDetail.coverage = 'partial'
  return targetDetail
}

export function mergeProjectDetails(target: ProjectDayStats, source: ProjectDayStats, targetHadUsage: boolean): void {
  if (!hasProjectUsage(source)) return
  target.modelDetail = mergeDetailBlock(
    target.modelDetail,
    source.modelDetail,
    targetHadUsage,
    cloneModelStats,
    mergeModelStats,
  )
  target.categoryDetail = mergeDetailBlock(
    target.categoryDetail,
    source.categoryDetail,
    targetHadUsage,
    cloneCategoryStats,
    mergeCategoryStats,
  )
}

export function addModelDetail(target: ProjectDayStats, key: string, stats: ModelDayStats): void {
  if (!target.modelDetail) target.modelDetail = { coverage: 'complete', rows: {} }
  const existing = Object.hasOwn(target.modelDetail.rows, key) ? target.modelDetail.rows[key] : undefined
  if (existing) mergeModelStats(existing, stats)
  else setOwn(target.modelDetail.rows, key, cloneModelStats(stats))
}

export function addCategoryDetail(target: ProjectDayStats, key: string, stats: CategoryDayStats): void {
  if (!target.categoryDetail) target.categoryDetail = { coverage: 'complete', rows: {} }
  const existing = Object.hasOwn(target.categoryDetail.rows, key) ? target.categoryDetail.rows[key] : undefined
  if (existing) mergeCategoryStats(existing, stats)
  else setOwn(target.categoryDetail.rows, key, cloneCategoryStats(stats))
}

export function sanitizeProjectDetails(raw: Record<string, unknown>): Pick<ProjectDayStats, 'modelDetail' | 'categoryDetail'> {
  const result: Pick<ProjectDayStats, 'modelDetail' | 'categoryDetail'> = {}
  const model = raw.modelDetail
  if (isRecord(model) && isCoverage(model.coverage) && isRecord(model.rows)) {
    result.modelDetail = { coverage: model.coverage, rows: sanitizeModels(model.rows) }
  }
  const category = raw.categoryDetail
  if (isRecord(category) && isCoverage(category.coverage) && isRecord(category.rows)) {
    result.categoryDetail = { coverage: category.coverage, rows: sanitizeCategories(category.rows) }
  }
  return result
}
