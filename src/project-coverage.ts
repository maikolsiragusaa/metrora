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

function coverageState(values: boolean[], hasData: boolean): DetailCoverageState {
  if (!hasData || values.length === 0) return 'complete'
  if (values.every(Boolean)) return 'complete'
  if (values.some(Boolean)) return 'partial'
  return 'unavailable'
}

/**
 * A Project-scoped durable day owns cost/calls/sessions, but its model/category
 * split may have been removed with the source session files. Keep that fact as
 * metadata instead of making the missing split look like factual zeroes.
 */
export function withProjectDetailCoverage(
  data: PeriodData,
  days: DailyEntry[],
  projectScopeActive: boolean,
  liveDate: string,
): PeriodData {
  if (!projectScopeActive) return data

  const dataDays = days.filter(day => day.cost !== 0 || day.calls > 0 || day.sessions > 0)
  const modelDetail = dataDays.map(day => Object.keys(day.models).length > 0)
  const projectTokenDetail = dataDays.map(day => {
    const projects = Object.values(day.projects ?? {}).filter(value => value.cost !== 0 || value.calls > 0 || value.sessions > 0)
    return projects.length > 0 && projects.every(hasProjectTokenEvidence)
  })
  const categoryDetail = dataDays.map(day => Object.keys(day.categories).length > 0)
  return {
    ...data,
    projectDetailCoverage: {
      models: coverageState(modelDetail, dataDays.length > 0),
      tokens: coverageState(projectTokenDetail, dataDays.length > 0),
      categories: coverageState(categoryDetail, dataDays.length > 0),
      historical: dataDays.some(day => day.date !== liveDate),
    },
  }
}
