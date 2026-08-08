import type { MenubarPayload, ModelAccounting, PeriodData } from './menubar-json.js'
import { getShortModelName } from './models.js'

const TOP_MODELS_LIMIT = 20
const SYNTHETIC_MODEL_NAME = '<synthetic>'

type MergedModelRow = {
  name: string
  cost: number
  calls: number
  savingsUSD: number
  estimatedCostUSD: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokenDetail: boolean
  activeDurationMs: number
  activeGeneratedTokens: number
}

function mergedModelRows(models: PeriodData['models']): MergedModelRow[] {
  // Durable day entries can use raw provider model ids. Resolve display names
  // here so aliases that collapse to one visible model also collapse to one
  // accounting row, while retaining only detail that can be merged safely.
  const merged = new Map<string, Omit<MergedModelRow, 'name'>>()
  for (const model of models) {
    if (model.name === SYNTHETIC_MODEL_NAME) continue
    const name = getShortModelName(model.name)
    const hasTokenDetail = [model.inputTokens, model.outputTokens, model.cacheReadTokens, model.cacheWriteTokens]
      .every(value => typeof value === 'number' && Number.isFinite(value))
    const acc = merged.get(name) ?? {
      cost: 0,
      calls: 0,
      savingsUSD: 0,
      estimatedCostUSD: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokenDetail: true,
      activeDurationMs: 0,
      activeGeneratedTokens: 0,
    }
    acc.cost += model.cost
    acc.calls += model.calls
    acc.savingsUSD += model.savingsUSD ?? 0
    acc.estimatedCostUSD += model.estimatedCostUSD ?? 0
    acc.tokenDetail = acc.tokenDetail && hasTokenDetail
    if (hasTokenDetail) {
      acc.inputTokens += model.inputTokens!
      acc.outputTokens += model.outputTokens!
      acc.cacheReadTokens += model.cacheReadTokens!
      acc.cacheWriteTokens += model.cacheWriteTokens!
    }
    if (
      typeof model.activeDurationMs === 'number' && Number.isFinite(model.activeDurationMs) && model.activeDurationMs > 0
      && typeof model.activeGeneratedTokens === 'number' && Number.isFinite(model.activeGeneratedTokens) && model.activeGeneratedTokens > 0
    ) {
      acc.activeDurationMs += model.activeDurationMs
      acc.activeGeneratedTokens += model.activeGeneratedTokens
    }
    merged.set(name, acc)
  }
  return [...merged.entries()]
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([name, data]) => ({ name, ...data }))
}

export function buildTopModels(models: PeriodData['models']): MenubarPayload['current']['topModels'] {
  return mergedModelRows(models)
    .slice(0, TOP_MODELS_LIMIT)
    .map(row => ({
      name: row.name,
      cost: row.cost,
      calls: row.calls,
      savingsUSD: row.savingsUSD,
      estimatedCostUSD: row.estimatedCostUSD,
      savingsBaselineModel: '',
    }))
}

export function buildModelAccounting(models: PeriodData['models'], totalCost: number, totalCalls: number): ModelAccounting {
  const rows: ModelAccounting['rows'] = mergedModelRows(models).map(row => ({
    name: row.name,
    cost: row.cost,
    savingsUSD: row.savingsUSD,
    calls: row.calls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    tokenDetail: row.tokenDetail,
    ...(row.activeDurationMs > 0 && row.activeGeneratedTokens > 0
      ? { activeDurationMs: row.activeDurationMs, activeGeneratedTokens: row.activeGeneratedTokens }
      : {}),
  }))
  const representedCost = rows.reduce((sum, row) => sum + row.cost, 0)
  const representedSavings = rows.reduce((sum, row) => sum + row.savingsUSD, 0)
  const representedCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  const tokenDetailedCost = rows.reduce((sum, row) => sum + (row.tokenDetail ? row.cost : 0), 0)
  const tokenDetailedCalls = rows.reduce((sum, row) => sum + (row.tokenDetail ? row.calls : 0), 0)
  const totalSavings = models.reduce((sum, model) => sum + (model.savingsUSD ?? 0), 0)
  const gapCost = Math.max(0, totalCost - representedCost)
  const gapCalls = Math.max(0, totalCalls - representedCalls)
  const gapSavings = Math.max(0, totalSavings - representedSavings)
  return {
    rows,
    gap: { cost: gapCost > 1e-9 ? gapCost : 0, savingsUSD: gapSavings > 1e-9 ? gapSavings : 0, calls: gapCalls },
    coverage: {
      cost: totalCost > 1e-9 ? Math.max(0, Math.min(1, representedCost / totalCost)) : 1,
      calls: totalCalls > 0 ? Math.max(0, Math.min(1, representedCalls / totalCalls)) : 1,
    },
    tokenCoverage: {
      cost: representedCost > 1e-9 ? Math.max(0, Math.min(1, tokenDetailedCost / representedCost)) : 1,
      calls: representedCalls > 0 ? Math.max(0, Math.min(1, tokenDetailedCalls / representedCalls)) : 1,
    },
  }
}
