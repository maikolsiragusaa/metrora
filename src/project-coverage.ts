import type { DailyEntry } from './daily-cache.js'
import type { PeriodData } from './menubar-json.js'

export type DetailCoverageState = 'complete' | 'partial' | 'unavailable'

export type ProjectDetailCoverage = {
  models: DetailCoverageState
  tokens: DetailCoverageState
  categories: DetailCoverageState
  historical: boolean
}

function hasProjectTokenEvidence(stats: NonNullable<DailyEntry['projects']>[string]): boolean {
  return stats.inputTokens !== undefined
    && stats.outputTokens !== undefined
    && stats.cacheReadTokens !== undefined
    && stats.cacheWriteTokens !== undefined
}

function hasProjectUsage(stats: NonNullable<DailyEntry['projects']>[string]): boolean {
  return stats.cost > 0 || stats.calls > 0 || stats.savingsUSD > 0
}

function hasDayUsage(day: DailyEntry): boolean {
  return day.cost !== 0 || day.calls > 0 || day.savingsUSD !== 0
}

function hasModelRows(project: NonNullable<DailyEntry['projects']>[string]): boolean {
  return Object.values(project.modelDetail?.rows ?? {}).some(row =>
    row.calls > 0
    || row.cost > 0
    || row.savingsUSD > 0
    || row.inputTokens > 0
    || row.outputTokens > 0
    || (row.reasoningTokens ?? 0) > 0
    || (row.additiveReasoningTokens ?? 0) > 0
    || row.cacheReadTokens > 0
    || row.cacheWriteTokens > 0,
  )
}

function hasCategoryRows(project: NonNullable<DailyEntry['projects']>[string]): boolean {
  return Object.values(project.categoryDetail?.rows ?? {}).some(row =>
    row.turns > 0 || row.cost > 0 || row.savingsUSD > 0,
  )
}

function projectDetailCoverage(
  days: DailyEntry[],
  kind: 'modelDetail' | 'categoryDetail',
): DetailCoverageState[] {
  return days.map(day => {
    const projects = Object.values(day.projects ?? {}).filter(hasProjectUsage)
    // A sessions-only shell has no model/category usage to cover. Treat it as
    // neutral complete-empty evidence; a cost/call-bearing day with no
    // attributed project usage remains unavailable.
    if (projects.length === 0) return hasDayUsage(day) ? 'unavailable' : 'complete'
    const states = projects.map(project => {
      const block = project[kind]
      const hasRows = kind === 'modelDetail' ? hasModelRows(project) : hasCategoryRows(project)
      if (!block || !hasRows) return 'unavailable' as const
      return block.coverage
    })
    if (states.every(state => state === 'complete')) return 'complete'
    if (states.some(state => state === 'complete' || state === 'partial')) return 'partial'
    return 'unavailable'
  })
}

function coverageState(values: boolean[], hasData: boolean): DetailCoverageState {
  if (!hasData || values.length === 0) return 'complete'
  if (values.every(Boolean)) return 'complete'
  if (values.some(Boolean)) return 'partial'
  return 'unavailable'
}

function detailCoverageState(values: DetailCoverageState[], hasData: boolean): DetailCoverageState {
  if (!hasData || values.length === 0) return 'complete'
  if (values.every(value => value === 'complete')) return 'complete'
  if (values.some(value => value === 'complete' || value === 'partial')) return 'partial'
  return 'unavailable'
}

/**
 * A Project-scoped durable day owns cost/calls/sessions and now carries explicit
 * Source Project model/category detail blocks. Coverage is derived from those
 * blocks, never from whether a projected map happens to contain rows.
 */
export function withProjectDetailCoverage(
  data: PeriodData,
  days: DailyEntry[],
  projectScopeActive: boolean,
  liveDate: string,
): PeriodData {
  if (!projectScopeActive) return data

  const dataDays = days.filter(day => day.cost !== 0 || day.calls > 0 || day.sessions > 0)
  const modelDetail = projectDetailCoverage(dataDays, 'modelDetail')
  const projectTokenDetail = dataDays.map(day => {
    const projects = Object.values(day.projects ?? {}).filter(value => value.cost !== 0 || value.calls > 0 || value.sessions > 0)
    return projects.length > 0 && projects.every(hasProjectTokenEvidence)
  })
  const categoryDetail = projectDetailCoverage(dataDays, 'categoryDetail')
  return {
    ...data,
    projectDetailCoverage: {
      models: detailCoverageState(modelDetail, dataDays.length > 0),
      tokens: coverageState(projectTokenDetail, dataDays.length > 0),
      categories: detailCoverageState(categoryDetail, dataDays.length > 0),
      historical: dataDays.some(day => day.date !== liveDate),
    },
  }
}
