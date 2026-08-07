import type { DailyEntry, ModelDayStats } from './daily-cache.js'
import { getShortModelName } from './models.js'

export type DurableModelMetric = {
  cost: number
  savingsUSD: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type DurableModelAccountingRow = DurableModelMetric & {
  /** Null when historical model attribution survived but provider attribution did not. */
  provider: string | null
  /** Raw provider-observed model id. */
  model: string
  /** Stable human-readable model label. */
  name: string
}

export type DurableModelAccounting = {
  /** Complete untruncated model rows that can still be attributed from durable history. */
  rows: DurableModelAccountingRow[]
  /** Exact period totals from the durable day authority. */
  total: DurableModelMetric
  /** Sum of the attributed model rows. */
  attributed: DurableModelMetric
  /** Durable remainder whose model identity is no longer provable. */
  gap: DurableModelMetric
  /** Coverage ratios in [0, 1]. Cost and calls are separate because zero-cost usage exists. */
  coverage: { cost: number; calls: number }
}

const EPSILON = 1e-9
const SYNTHETIC_MODEL = '<synthetic>'

function zeroMetric(): DurableModelMetric {
  return {
    cost: 0,
    savingsUSD: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function addMetric(target: DurableModelMetric, source: DurableModelMetric): void {
  target.cost += source.cost
  target.savingsUSD += source.savingsUSD
  target.calls += source.calls
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
}

function modelMetric(model: ModelDayStats): DurableModelMetric {
  return {
    cost: model.cost,
    savingsUSD: model.savingsUSD,
    calls: model.calls,
    inputTokens: model.inputTokens,
    outputTokens: model.outputTokens,
    cacheReadTokens: model.cacheReadTokens,
    cacheWriteTokens: model.cacheWriteTokens,
  }
}

function dayMetric(day: DailyEntry): DurableModelMetric {
  return {
    cost: day.cost,
    savingsUSD: day.savingsUSD,
    calls: day.calls,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheWriteTokens: day.cacheWriteTokens,
  }
}

function materialSlice(slice: DailyEntry['providers'][string]): boolean {
  return slice.calls > 0 || Math.abs(slice.cost) > EPSILON || Math.abs(slice.savingsUSD) > EPSILON
}

function hasUsableModelBreakdown(slice: DailyEntry['providers'][string]): boolean {
  if (!materialSlice(slice)) return true
  return !!slice.models && Object.keys(slice.models).some(name => name !== SYNTHETIC_MODEL)
}

function positiveFloatRemainder(total: number, attributed: number): number {
  const value = total - attributed
  return value > EPSILON ? value : 0
}

function positiveCountRemainder(total: number, attributed: number): number {
  return Math.max(0, total - attributed)
}

function ratio(attributed: number, total: number): number {
  if (total <= EPSILON) return 1
  return Math.max(0, Math.min(1, attributed / total))
}

/**
 * Build the model authority from the exact durable day set behind a headline.
 *
 * Prefer provider-slice model maps when every material provider slice on a day
 * retains them. If any provider slice has lost that split, fall back to the
 * day's all-provider model map instead of mixing both levels and double-counting.
 * The fallback keeps model identity but leaves provider null unless the day is
 * already scoped to exactly one provider. If neither breakdown survives, the
 * value stays in `gap`; no model/provider is invented.
 */
export function aggregateDurableModelAccounting(days: DailyEntry[]): DurableModelAccounting {
  const total = zeroMetric()
  const rows = new Map<string, DurableModelAccountingRow>()

  const addRow = (provider: string | null, model: string, stats: ModelDayStats): void => {
    if (model === SYNTHETIC_MODEL) return
    const key = `${provider ?? ''}\u0000${model}`
    const existing = rows.get(key) ?? {
      provider,
      model,
      name: getShortModelName(model),
      ...zeroMetric(),
    }
    addMetric(existing, modelMetric(stats))
    rows.set(key, existing)
  }

  for (const day of days) {
    addMetric(total, dayMetric(day))

    const providers = Object.entries(day.providers).filter(([, slice]) => materialSlice(slice))
    const providerBreakdownComplete = providers.length > 0 && providers.every(([, slice]) => hasUsableModelBreakdown(slice))

    if (providerBreakdownComplete) {
      for (const [provider, slice] of providers) {
        for (const [model, stats] of Object.entries(slice.models ?? {})) addRow(provider, model, stats)
      }
      continue
    }

    const fallbackProvider = providers.length === 1 ? providers[0]![0] : null
    for (const [model, stats] of Object.entries(day.models)) addRow(fallbackProvider, model, stats)
  }

  const sortedRows = [...rows.values()].sort((left, right) =>
    (right.cost - left.cost) || (right.calls - left.calls) || left.name.localeCompare(right.name),
  )
  const attributed = zeroMetric()
  for (const row of sortedRows) addMetric(attributed, row)

  const gap: DurableModelMetric = {
    cost: positiveFloatRemainder(total.cost, attributed.cost),
    savingsUSD: positiveFloatRemainder(total.savingsUSD, attributed.savingsUSD),
    calls: positiveCountRemainder(total.calls, attributed.calls),
    inputTokens: positiveCountRemainder(total.inputTokens, attributed.inputTokens),
    outputTokens: positiveCountRemainder(total.outputTokens, attributed.outputTokens),
    cacheReadTokens: positiveCountRemainder(total.cacheReadTokens, attributed.cacheReadTokens),
    cacheWriteTokens: positiveCountRemainder(total.cacheWriteTokens, attributed.cacheWriteTokens),
  }

  return {
    rows: sortedRows,
    total,
    attributed,
    gap,
    coverage: {
      cost: ratio(attributed.cost, total.cost),
      calls: total.calls === 0 ? 1 : Math.max(0, Math.min(1, attributed.calls / total.calls)),
    },
  }
}

export function hasDurableModelGap(accounting: DurableModelAccounting): boolean {
  const gap = accounting.gap
  return gap.cost > EPSILON || gap.savingsUSD > EPSILON || gap.calls > 0 || gap.inputTokens > 0 || gap.outputTokens > 0 || gap.cacheReadTokens > 0 || gap.cacheWriteTokens > 0
}
