import type { DailyEntry, ModelDayStats } from './daily-cache-core.js'
import { combineReasoningSemantics, type ReasoningTokenSemantics } from './token-semantics.js'

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isReasoningTokenSemantics(value: unknown): value is ReasoningTokenSemantics {
  return value === 'separate'
    || value === 'aggregate-output'
    || value === 'unavailable'
    || value === 'mixed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

export function sanitizeModels(raw: unknown): DailyEntry['models'] {
  if (!isRecord(raw)) return {}
  const out: DailyEntry['models'] = {}
  for (const [name, m] of Object.entries(raw)) {
    if (name in Object.prototype || !isRecord(m)) continue
    setOwn(out, name, {
      calls: finiteNumber(m.calls),
      cost: finiteNumber(m.cost),
      savingsUSD: finiteNumber(m.savingsUSD),
      inputTokens: finiteNumber(m.inputTokens),
      outputTokens: finiteNumber(m.outputTokens),
      ...(typeof m.reasoningTokens === 'number' && Number.isFinite(m.reasoningTokens)
        ? { reasoningTokens: Math.max(0, m.reasoningTokens) }
        : {}),
      cacheReadTokens: finiteNumber(m.cacheReadTokens),
      cacheWriteTokens: finiteNumber(m.cacheWriteTokens),
      ...(isReasoningTokenSemantics(m.reasoningSemantics) ? { reasoningSemantics: m.reasoningSemantics } : {}),
      ...(typeof m.modelProvider === 'string' && m.modelProvider.trim().length > 0
        ? { modelProvider: m.modelProvider.trim() }
        : {}),
      ...(Array.isArray(m.sourceProviders)
        ? { sourceProviders: [...new Set(m.sourceProviders
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map(value => value.trim()))].sort() }
        : {}),
    })
  }
  return out
}

export function emptyModelStats(): ModelDayStats {
  return { calls: 0, cost: 0, savingsUSD: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

export function mergeModelStats(target: ModelDayStats, source: ModelDayStats): void {
  target.calls += source.calls
  target.cost += source.cost
  target.savingsUSD += source.savingsUSD ?? 0
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  if (source.reasoningTokens !== undefined) target.reasoningTokens = (target.reasoningTokens ?? 0) + source.reasoningTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
  if (!target.modelProvider && source.modelProvider) target.modelProvider = source.modelProvider
  if (source.sourceProviders && source.sourceProviders.length > 0) {
    target.sourceProviders = [...new Set([...(target.sourceProviders ?? []), ...source.sourceProviders])].sort()
  }
  if (source.reasoningSemantics) {
    target.reasoningSemantics = target.reasoningSemantics === undefined
      ? source.reasoningSemantics
      : combineReasoningSemantics([target.reasoningSemantics, source.reasoningSemantics])
  }
}
