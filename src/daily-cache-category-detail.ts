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

export type SanitizedCategories = {
  rows: DailyEntry['categories']
  sanitizationIsLossless: boolean
}

const REQUIRED_CATEGORY_NUMERICS = ['turns', 'cost', 'savingsUSD', 'editTurns', 'oneShotTurns'] as const

function hasRequiredCategoryStats(category: Record<string, unknown>): boolean {
  return REQUIRED_CATEGORY_NUMERICS.every(field =>
    Object.hasOwn(category, field) && typeof category[field] === 'number' && Number.isFinite(category[field]),
  )
}

/**
 * Sanitize Project category detail while retaining whether any serialized row
 * was rejected or had its required numeric structure altered.
 */
export function sanitizeCategoriesWithIntegrity(raw: unknown): SanitizedCategories {
  if (!isRecord(raw)) return { rows: {}, sanitizationIsLossless: false }

  const rows: DailyEntry['categories'] = {}
  let sanitizationIsLossless = true
  for (const [name, category] of Object.entries(raw)) {
    if (name in Object.prototype || !isRecord(category) || !hasRequiredCategoryStats(category)) {
      sanitizationIsLossless = false
      continue
    }
    setOwn(rows, name, {
      turns: category.turns as number,
      cost: category.cost as number,
      savingsUSD: category.savingsUSD as number,
      editTurns: category.editTurns as number,
      oneShotTurns: category.oneShotTurns as number,
    })
  }
  return { rows, sanitizationIsLossless }
}
