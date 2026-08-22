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

const DETAIL_EPSILON = 1e-9
const PROJECT_DETAIL_NUMERICS = [
  'cost',
  'calls',
  'savingsUSD',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'additiveReasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
] as const

function hasMagnitude(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > DETAIL_EPSILON
}

function approximatelyEqual(actual: number, expected: number): boolean {
  const tolerance = Math.max(DETAIL_EPSILON, Math.abs(expected) * DETAIL_EPSILON)
  return Math.abs(actual - expected) <= tolerance
}

function hasFactualProjectUsage(project: ProjectDayStats): boolean {
  return PROJECT_DETAIL_NUMERICS.some(field => hasMagnitude(project[field]))
}

function hasFactualModelRow(row: ModelDayStats): boolean {
  return PROJECT_DETAIL_NUMERICS.some(field => hasMagnitude(row[field]))
}

function hasFactualCategoryRow(row: CategoryDayStats): boolean {
  return hasMagnitude(row.turns)
    || hasMagnitude(row.cost)
    || hasMagnitude(row.savingsUSD)
}

type ModelDetailTotals = {
  calls: number
  cost: number
  savingsUSD: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  additiveReasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

function modelDetailTotals(rows: Record<string, ModelDayStats>): ModelDetailTotals {
  const totals: ModelDetailTotals = {
    calls: 0,
    cost: 0,
    savingsUSD: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    additiveReasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  for (const row of Object.values(rows)) {
    totals.calls += row.calls
    totals.cost += row.cost
    totals.savingsUSD += row.savingsUSD
    totals.inputTokens += row.inputTokens
    totals.outputTokens += row.outputTokens
    totals.reasoningTokens += row.reasoningTokens ?? 0
    totals.additiveReasoningTokens += row.additiveReasoningTokens ?? 0
    totals.cacheReadTokens += row.cacheReadTokens
    totals.cacheWriteTokens += row.cacheWriteTokens
  }
  return totals
}

function modelRowsReconcile(project: ProjectDayStats, rows: Record<string, ModelDayStats>): boolean {
  const totals = modelDetailTotals(rows)
  if (!approximatelyEqual(totals.calls, project.calls)) return false
  if (!approximatelyEqual(totals.cost, project.cost)) return false
  if (!approximatelyEqual(totals.savingsUSD, project.savingsUSD)) return false
  for (const field of ['inputTokens', 'outputTokens', 'reasoningTokens', 'additiveReasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (project[field] !== undefined && !approximatelyEqual(totals[field], project[field])) return false
  }
  return true
}

function categoryRowsReconcile(project: ProjectDayStats, rows: Record<string, CategoryDayStats>): boolean {
  let cost = 0
  let savingsUSD = 0
  for (const row of Object.values(rows)) {
    cost += row.cost
    savingsUSD += row.savingsUSD
  }
  return approximatelyEqual(cost, project.cost)
    && approximatelyEqual(savingsUSD, project.savingsUSD)
}

function normalizeModelDetail(
  coverage: DurableProjectDetailCoverage,
  rows: Record<string, ModelDayStats>,
  project: ProjectDayStats,
): ProjectModelDetail | undefined {
  const hasUsage = hasFactualProjectUsage(project)
  const hasRows = Object.values(rows).some(hasFactualModelRow)

  if (!hasUsage) {
    // Complete-empty is authoritative only for a genuinely sessions-only
    // project. A partial claim cannot be upgraded during sanitization.
    return coverage === 'complete' && !hasRows ? { coverage: 'complete', rows: {} } : undefined
  }
  if (!hasRows) return undefined
  if (coverage === 'partial') return { coverage: 'partial', rows }
  return { coverage: modelRowsReconcile(project, rows) ? 'complete' : 'partial', rows }
}

function normalizeCategoryDetail(
  coverage: DurableProjectDetailCoverage,
  rows: Record<string, CategoryDayStats>,
  project: ProjectDayStats,
): ProjectCategoryDetail | undefined {
  const hasUsage = hasFactualProjectUsage(project)
  const hasRows = Object.values(rows).some(hasFactualCategoryRow)

  if (!hasUsage) {
    return coverage === 'complete' && !hasRows ? { coverage: 'complete', rows: {} } : undefined
  }
  if (!hasRows) return undefined
  if (coverage === 'partial') return { coverage: 'partial', rows }
  return { coverage: categoryRowsReconcile(project, rows) ? 'complete' : 'partial', rows }
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

export function sanitizeProjectDetails(
  raw: Record<string, unknown>,
  project: ProjectDayStats = { cost: 0, calls: 0, savingsUSD: 0, sessions: 0 },
): Pick<ProjectDayStats, 'modelDetail' | 'categoryDetail'> {
  const result: Pick<ProjectDayStats, 'modelDetail' | 'categoryDetail'> = {}
  const model = raw.modelDetail
  if (isRecord(model) && isCoverage(model.coverage) && isRecord(model.rows)) {
    const rows = sanitizeModels(model.rows)
    const normalized = normalizeModelDetail(model.coverage, rows, project)
    if (normalized) result.modelDetail = normalized
  }
  const category = raw.categoryDetail
  if (isRecord(category) && isCoverage(category.coverage) && isRecord(category.rows)) {
    const rows = sanitizeCategories(category.rows)
    const normalized = normalizeCategoryDetail(category.coverage, rows, project)
    if (normalized) result.categoryDetail = normalized
  }
  return result
}
