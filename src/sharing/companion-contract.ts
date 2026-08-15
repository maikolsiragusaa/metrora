export const COMPANION_USAGE_KIND = 'metrora.companion.usage' as const
export const COMPANION_USAGE_VERSION = 1 as const

export type CompanionModelUsageV1 = {
  name: string
  calls: number
  costMicrosUsd: number
  estimatedCostMicrosUsd: number | null
}

export type CompanionTrendPointV1 = {
  date: string
  costMicrosUsd: number
}

export type CompanionTrendV1 = {
  granularity: 'day'
  periodLabel: string
  buckets: CompanionTrendPointV1[]
}

export type CompanionUsageV1 = {
  kind: typeof COMPANION_USAGE_KIND
  version: typeof COMPANION_USAGE_VERSION
  generatedAt: string
  period: {
    label: string
  }
  totals: {
    costMicrosUsd: number
    estimatedCostMicrosUsd: number | null
    calls: number
    sessions: number
    tokens: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
    cacheHitPercent: number
  }
  topModels: CompanionModelUsageV1[]
  quality: {
    pricingCoverage: number | null
  }
  /** Optional so older Desktop payloads remain valid for companions. */
  trend?: CompanionTrendV1
}

type JsonRecord = Record<string, unknown>

const MAX_TOP_MODELS = 5
const MAX_SAFE_MICROS_USD = Number.MAX_SAFE_INTEGER

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`invalid ${label}`)
  }
  return value as JsonRecord
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegativeInteger(value: unknown): number {
  return Math.max(0, Math.trunc(finiteNumber(value)))
}

function nullableNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

function nullableFraction(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null
  return value
}

function usdToMicros(value: unknown): number {
  const dollars = finiteNumber(value)
  if (dollars <= 0) return 0
  return Math.min(MAX_SAFE_MICROS_USD, Math.round(dollars * 1_000_000))
}

function nullableUsdToMicros(value: unknown): number | null {
  const dollars = nullableNonNegativeNumber(value)
  return dollars === null ? null : usdToMicros(dollars)
}

function safeGeneratedAt(value: unknown): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString()
  }
  return new Date().toISOString()
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TREND_BUCKETS = 31

function safeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function trendBounds(
  generatedAt: string,
  query: { period?: string; from?: string; to?: string },
): { from: string; to: string } {
  const generatedDate = safeDate(generatedAt.slice(0, 10)) ?? new Date().toISOString().slice(0, 10)
  const explicitFrom = safeDate(query.from)
  const explicitTo = safeDate(query.to)
  if (explicitFrom || explicitTo) {
    return {
      from: explicitFrom ?? shiftDate(explicitTo ?? generatedDate, -180),
      to: explicitTo ?? generatedDate,
    }
  }

  switch (query.period ?? 'month') {
    case 'today':
      return { from: generatedDate, to: generatedDate }
    case 'week':
      return { from: shiftDate(generatedDate, -6), to: generatedDate }
    case '30days':
      return { from: shiftDate(generatedDate, -29), to: generatedDate }
    case 'month':
      return { from: `${generatedDate.slice(0, 7)}-01`, to: generatedDate }
    case 'all':
      return { from: shiftDate(generatedDate, -179), to: generatedDate }
    case 'lifetime':
      return { from: '1970-01-01', to: generatedDate }
    default:
      return { from: `${generatedDate.slice(0, 7)}-01`, to: generatedDate }
  }
}

function companionTrend(
  root: JsonRecord,
  generatedAt: string,
  periodLabel: string,
  query: { period?: string; from?: string; to?: string },
): CompanionTrendV1 | undefined {
  if (typeof root.history !== 'object' || root.history === null || Array.isArray(root.history)) return undefined
  const history = root.history as JsonRecord
  if (!Array.isArray(history.daily)) return undefined
  const bounds = trendBounds(generatedAt, query)
  const buckets = history.daily
    .map((value): CompanionTrendPointV1 | null => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
      const day = value as JsonRecord
      const date = safeDate(day.date)
      if (!date || date < bounds.from || date > bounds.to) return null
      return {
        date,
        costMicrosUsd: usdToMicros(day.cost),
      }
    })
    .filter((value): value is CompanionTrendPointV1 => value !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_TREND_BUCKETS)

  return { granularity: 'day', periodLabel, buckets }
}

/**
 * Convert the internal desktop payload into the stable, content-minimal
 * contract consumed by first-party companions. Internal report structures must
 * never leak through `/api/v1/usage` directly.
 */
export function toCompanionUsageV1(
  payload: unknown,
  query: { period?: string; from?: string; to?: string } = {},
): CompanionUsageV1 {
  const root = record(payload, 'usage payload')
  const current = record(root.current, 'usage payload current period')

  const input = nonNegativeInteger(current.inputTokens)
  const output = nonNegativeInteger(current.outputTokens)
  const cacheRead = nonNegativeInteger(current.cacheReadTokens)
  const cacheWrite = nonNegativeInteger(current.cacheWriteTokens)
  const rawModels = Array.isArray(current.topModels) ? current.topModels : []

  const topModels = rawModels
    .slice(0, MAX_TOP_MODELS)
    .map((value): CompanionModelUsageV1 | null => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
      const model = value as JsonRecord
      const name = typeof model.name === 'string' ? model.name.trim() : ''
      if (!name) return null
      return {
        name: name.slice(0, 160),
        calls: nonNegativeInteger(model.calls),
        costMicrosUsd: usdToMicros(model.cost),
        estimatedCostMicrosUsd: nullableUsdToMicros(model.estimatedCostUSD),
      }
    })
    .filter((value): value is CompanionModelUsageV1 => value !== null)

  const label = typeof current.label === 'string' && current.label.trim()
    ? current.label.trim().slice(0, 120)
    : 'Selected period'

  const generatedAt = safeGeneratedAt(root.generated)
  const periodLabel = typeof current.label === 'string' && current.label.trim()
    ? current.label.trim().slice(0, 120)
    : 'Selected period'
  const trend = companionTrend(root, generatedAt, periodLabel, query)

  return {
    kind: COMPANION_USAGE_KIND,
    version: COMPANION_USAGE_VERSION,
    generatedAt,
    period: { label },
    totals: {
      costMicrosUsd: usdToMicros(current.cost),
      estimatedCostMicrosUsd: nullableUsdToMicros(current.estimatedCostUSD),
      calls: nonNegativeInteger(current.calls),
      sessions: nonNegativeInteger(current.sessions),
      tokens: {
        input,
        output,
        cacheRead,
        cacheWrite,
        total: input + output + cacheRead + cacheWrite,
      },
      cacheHitPercent: Math.min(100, Math.max(0, finiteNumber(current.cacheHitPercent))),
    },
    topModels,
    quality: {
      pricingCoverage: nullableFraction(current.pricingCoverage),
    },
    ...(trend ? { trend } : {}),
  }
}
