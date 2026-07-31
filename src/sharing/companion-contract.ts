export const COMPANION_USAGE_KIND = 'qovrion.companion.usage' as const
export const COMPANION_USAGE_VERSION = 1 as const

export type CompanionModelUsageV1 = {
  name: string
  calls: number
  costMicrosUsd: number
  estimatedCostMicrosUsd: number | null
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

/**
 * Convert the internal desktop payload into the stable, content-minimal
 * contract consumed by first-party companions. Internal report structures must
 * never leak through `/api/v1/usage` directly.
 */
export function toCompanionUsageV1(payload: unknown): CompanionUsageV1 {
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

  return {
    kind: COMPANION_USAGE_KIND,
    version: COMPANION_USAGE_VERSION,
    generatedAt: safeGeneratedAt(root.generated),
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
      pricingCoverage: nullableNonNegativeNumber(current.pricingCoverage),
    },
  }
}
