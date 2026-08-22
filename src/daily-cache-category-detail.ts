import type { CategoryDayStats, DailyEntry } from './daily-cache-types.js'

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

export function emptyCategoryStats(): CategoryDayStats {
  return { turns: 0, cost: 0, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 }
}

export function cloneCategoryStats(stats: CategoryDayStats): CategoryDayStats {
  return {
    turns: finiteNumber(stats.turns),
    cost: finiteNumber(stats.cost),
    savingsUSD: finiteNumber(stats.savingsUSD),
    editTurns: finiteNumber(stats.editTurns),
    oneShotTurns: finiteNumber(stats.oneShotTurns),
  }
}

export function mergeCategoryStats(target: CategoryDayStats, source: CategoryDayStats): void {
  target.turns += source.turns
  target.cost += source.cost
  target.savingsUSD += source.savingsUSD ?? 0
  target.editTurns += source.editTurns
  target.oneShotTurns += source.oneShotTurns
}

export function sanitizeCategories(raw: unknown): DailyEntry['categories'] {
  if (!isRecord(raw)) return {}
  const out: DailyEntry['categories'] = {}
  for (const [name, category] of Object.entries(raw)) {
    if (name in Object.prototype || !isRecord(category)) continue
    setOwn(out, name, {
      turns: finiteNumber(category.turns),
      cost: finiteNumber(category.cost),
      savingsUSD: finiteNumber(category.savingsUSD),
      editTurns: finiteNumber(category.editTurns),
      oneShotTurns: finiteNumber(category.oneShotTurns),
    })
  }
  return out
}
