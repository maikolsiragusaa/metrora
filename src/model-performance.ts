import { aggregateModelTotals } from './model-breakdown.js'
import { getShortModelName } from './models.js'
import type { ProjectSummary } from './types.js'

export function enrichModelsWithObservedPerformance<T extends { name: string }>(models: T[], projects: ProjectSummary[]): T[] {
  const performance = new Map(
    Object.entries(aggregateModelTotals(projects))
      .filter(([, totals]) => totals.activeDurationMs > 0 && totals.activeGeneratedTokens > 0)
      .map(([name, totals]) => [getShortModelName(name), {
        activeDurationMs: totals.activeDurationMs,
        activeGeneratedTokens: totals.activeGeneratedTokens,
      }] as const),
  )
  if (performance.size === 0) return models
  return models.map(model => {
    const timing = performance.get(getShortModelName(model.name))
    return timing ? { ...model, ...timing } : model
  })
}
