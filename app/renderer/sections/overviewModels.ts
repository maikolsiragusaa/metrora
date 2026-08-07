import type { DailyHistoryEntry, MenubarPayload } from '../lib/types'

export type AggregatedModel = {
  name: string
  cost: number
  calls: number
  inputTokens?: number
  outputTokens?: number
}

export const OTHER_MODELS_HISTORY_GAP = 'Other models'

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

/**
 * Aggregate the model detail retained in history.daily without pretending that
 * its topModels array is a complete accounting ledger. The daily payload is a
 * presentation-sized top-N view; any omitted spend/calls/tokens are preserved as
 * an explicit "Other models" gap so this table still reconciles to the durable
 * daily headline instead of silently dropping the tail.
 */
export function aggregateModels(daily: DailyHistoryEntry[]): AggregatedModel[] {
  const byName = new Map<string, AggregatedModel>()
  const add = (name: string, cost: number, calls: number, inputTokens: number, outputTokens: number) => {
    const row = byName.get(name) ?? {
      name,
      cost: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    row.cost += cost
    row.calls += calls
    row.inputTokens = (row.inputTokens ?? 0) + inputTokens
    row.outputTokens = (row.outputTokens ?? 0) + outputTokens
    byName.set(name, row)
  }

  for (const day of daily) {
    let representedCost = 0
    let representedCalls = 0
    let representedInput = 0
    let representedOutput = 0

    for (const model of day.topModels) {
      add(model.name, model.cost, model.calls, model.inputTokens, model.outputTokens)
      representedCost += model.cost
      representedCalls += model.calls
      representedInput += model.inputTokens
      representedOutput += model.outputTokens
    }

    const gapCost = Math.max(0, day.cost - representedCost)
    const gapCalls = Math.max(0, day.calls - representedCalls)
    const gapInput = Math.max(0, day.inputTokens - representedInput)
    const gapOutput = Math.max(0, day.outputTokens - representedOutput)
    // Floating-point additions can leave a microscopic cost residue. Only emit
    // a gap row when at least one material accounting dimension is actually
    // missing from topModels.
    if (gapCost > 0.000001 || gapCalls > 0 || gapInput > 0 || gapOutput > 0) {
      add(OTHER_MODELS_HISTORY_GAP, gapCost, gapCalls, gapInput, gapOutput)
    }
  }
  return [...byName.values()].sort((a, b) => b.cost - a.cost)
}
