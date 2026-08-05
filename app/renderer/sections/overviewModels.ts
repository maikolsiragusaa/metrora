import type { DailyHistoryEntry, MenubarPayload } from '../lib/types'

export type AggregatedModel = {
  name: string
  cost: number
  calls: number
  inputTokens?: number
  outputTokens?: number
}

export function sessionModelKey(project: string, date: string, calls: number, cost: number): string {
  return `${project}|${date}|${calls}|${cost}`
}

export function buildModelIndex(data: MenubarPayload): Map<string, string> {
  const index = new Map<string, string>()
  for (const project of data.current.topProjects) {
    for (const session of project.sessionDetails) {
      const dominant = [...session.models].sort((a, b) => b.cost - a.cost)[0]
      if (dominant) index.set(sessionModelKey(project.name, session.date, session.calls, session.cost), dominant.name)
    }
  }
  return index
}

export function topModelsToAggregated(models: MenubarPayload['current']['topModels']): AggregatedModel[] {
  return models
    .map(model => ({ name: model.name, cost: model.cost, calls: model.calls }))
    .sort((a, b) => b.cost - a.cost)
}

export function aggregateModels(daily: DailyHistoryEntry[]): AggregatedModel[] {
  const byName = new Map<string, AggregatedModel>()
  for (const day of daily) {
    for (const model of day.topModels) {
      const row = byName.get(model.name) ?? {
        name: model.name,
        cost: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
      row.cost += model.cost
      row.calls += model.calls
      row.inputTokens = (row.inputTokens ?? 0) + model.inputTokens
      row.outputTokens = (row.outputTokens ?? 0) + model.outputTokens
      byName.set(model.name, row)
    }
  }
  return [...byName.values()].sort((a, b) => b.cost - a.cost)
}
