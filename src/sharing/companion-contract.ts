import { normalizeExplicitModelProvider } from '../model-provider.js'
import { normalizeModelBrandId, resolveModelBrandId, type ModelBrandId } from '../model-brand.js'

export const COMPANION_USAGE_KIND = 'metrora.companion.usage' as const
export const COMPANION_USAGE_VERSION = 1 as const
export type CompanionTrendGranularity = 'day' | 'week' | 'month'

export type CompanionModelUsageV1 = {
  name: string
  calls: number
  costMicrosUsd: number
  estimatedCostMicrosUsd: number | null
  /** Source-recorded provider identity; absent means unknown, not inferred. */
  providerId?: string
  /** Canonical model-vendor identity for presentation branding only. */
  brandId?: ModelBrandId
}

/**
 * Exact cost/call accounting that cannot be assigned to a retained named
 * model without inventing model identity. This is a residual, not a model
 * row, and intentionally carries no provider, route, pricing, or token split.
 */
export type ModelAccountingGapV1 = {
  costMicrosUsd: number
  calls: number
}

export type CompanionTrendPointV1 = {
  date: string
  costMicrosUsd: number
}

export type CompanionTrendV1 = {
  granularity: CompanionTrendGranularity
  periodLabel: string
  buckets: CompanionTrendPointV1[]
}

export type CompanionUsageV1 = {
  kind: typeof COMPANION_USAGE_KIND
  version: typeof COMPANION_USAGE_VERSION
  generatedAt: string
  /** Additive scope identity; absent on older Desktop payloads. */
  scope?: { projectId: string }
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
  /** Bounded full model breakdown. Older payloads may omit this field. */
  models?: CompanionModelUsageV1[]
  /** Additive factual residual for a neutral "Other models" presentation row. */
  modelAccountingGap?: ModelAccountingGapV1
  quality: {
    pricingCoverage: number | null
    /** Additive Project-scoped detail coverage; zero is never used as a proxy. */
    projectDetailCoverage?: {
      models: 'complete' | 'partial' | 'unavailable'
      tokens: 'complete' | 'partial' | 'unavailable'
      categories: 'complete' | 'partial' | 'unavailable'
      historical: boolean
    }
  }
  /** Optional so older Desktop payloads remain valid for companions. */
  trend?: CompanionTrendV1
}

type JsonRecord = Record<string, unknown>

const MAX_TOP_MODELS = 5
const MAX_MODELS = 20
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

function materialModelAccountingGap(value: unknown): ModelAccountingGapV1 | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const gap = value as JsonRecord
  const costMicrosUsd = usdToMicros(gap.cost)
  const calls = nonNegativeInteger(gap.calls)
  // Keep the bounded contract free of floating-point dust rows. A positive
  // call remainder remains material even when its cost rounds below one
  // micro-dollar.
  return costMicrosUsd > 0 || calls > 0 ? { costMicrosUsd, calls } : undefined
}

function projectDetailCoverage(value: unknown): CompanionUsageV1['quality']['projectDetailCoverage'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const coverage = value as JsonRecord
  const state = (candidate: unknown): 'complete' | 'partial' | 'unavailable' | undefined =>
    candidate === 'complete' || candidate === 'partial' || candidate === 'unavailable' ? candidate : undefined
  const models = state(coverage.models)
  const tokens = state(coverage.tokens)
  const categories = state(coverage.categories)
  if (!models || !tokens || !categories || typeof coverage.historical !== 'boolean') return undefined
  return { models, tokens, categories, historical: coverage.historical }
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
const MAX_TREND_BUCKETS = 128

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

function dateSpanDays(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`).getTime()
  const end = new Date(`${to}T00:00:00.000Z`).getTime()
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export function companionTrendGranularity(
  query: { period?: string; from?: string; to?: string; granularity?: string },
  bounds: { from: string; to: string },
): CompanionTrendV1['granularity'] {
  if (query.granularity === 'day' || query.granularity === 'week' || query.granularity === 'month') {
    return query.granularity
  }
  if (query.period === 'lifetime') return 'month'
  if (query.period === 'all') return 'week'
  const span = dateSpanDays(bounds.from, bounds.to)
  if (span > 366) return 'month'
  if (span > 31) return 'week'
  return 'day'
}

export function companionTrendBucketDate(date: string, granularity: CompanionTrendV1['granularity']): string {
  if (granularity === 'day') return date
  if (granularity === 'month') return date.slice(0, 7) + '-01'
  const parsed = new Date(`${date}T00:00:00.000Z`)
  const daysSinceSunday = parsed.getUTCDay()
  parsed.setUTCDate(parsed.getUTCDate() - ((daysSinceSunday + 6) % 7))
  return parsed.toISOString().slice(0, 10)
}

function trendBounds(
  generatedAt: string,
  query: { period?: string; from?: string; to?: string; effectiveFrom?: string; effectiveTo?: string },
): { from: string; to: string } {
  const generatedDate = safeDate(generatedAt.slice(0, 10)) ?? new Date().toISOString().slice(0, 10)
  const resolvedFrom = safeDate(query.effectiveFrom)
  const resolvedTo = safeDate(query.effectiveTo)
  if (resolvedFrom || resolvedTo) {
    return {
      from: resolvedFrom ?? shiftDate(resolvedTo ?? generatedDate, -180),
      to: resolvedTo ?? generatedDate,
    }
  }
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
  query: { period?: string; from?: string; to?: string; granularity?: string; effectiveFrom?: string; effectiveTo?: string },
): CompanionTrendV1 | undefined {
  if (typeof root.history !== 'object' || root.history === null || Array.isArray(root.history)) return undefined
  const history = root.history as JsonRecord
  const source = Array.isArray(history.periodDaily)
    ? history.periodDaily
    : Array.isArray(history.daily)
      ? history.daily
      : null
  if (!source) return undefined
  const bounds = trendBounds(generatedAt, query)
  const granularity = companionTrendGranularity(query, bounds)
  const totals = new Map<string, number>()
  source.forEach((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
      const day = value as JsonRecord
      const date = safeDate(day.date)
      if (!date || date < bounds.from || date > bounds.to) return null
      const bucket = companionTrendBucketDate(date, granularity)
      const next = (totals.get(bucket) ?? 0) + usdToMicros(day.cost)
      totals.set(bucket, Math.min(MAX_SAFE_MICROS_USD, next))
      return null
    })
  const allBuckets = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, costMicrosUsd]) => ({ date, costMicrosUsd }))
  let buckets = allBuckets
  if (buckets.length > MAX_TREND_BUCKETS) {
    const keep = buckets.slice(-(MAX_TREND_BUCKETS - 1))
    const overflow = buckets.slice(0, buckets.length - keep.length)
      .reduce((sum, value) => Math.min(MAX_SAFE_MICROS_USD, sum + value.costMicrosUsd), 0)
    buckets = [{ date: allBuckets[0]!.date, costMicrosUsd: overflow }, ...keep]
  }

  return { granularity, periodLabel, buckets }
}

/**
 * Convert the internal desktop payload into the stable, content-minimal
 * contract consumed by first-party companions. Internal report structures must
 * never leak through `/api/v1/usage` directly.
 */
export function toCompanionUsageV1(
  payload: unknown,
  query: {
    period?: string
    from?: string
    to?: string
    granularity?: string
    effectiveFrom?: string
    effectiveTo?: string
  } = {},
): CompanionUsageV1 {
  const root = record(payload, 'usage payload')
  const current = record(root.current, 'usage payload current period')

  const input = nonNegativeInteger(current.inputTokens)
  const output = nonNegativeInteger(current.outputTokens)
  const cacheRead = nonNegativeInteger(current.cacheReadTokens)
  const cacheWrite = nonNegativeInteger(current.cacheWriteTokens)
  const rawModels = Array.isArray(current.topModels) ? current.topModels : []

  const mapModel = (value: unknown): CompanionModelUsageV1 | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const model = value as JsonRecord
    const name = typeof model.name === 'string' ? model.name.trim() : ''
    if (!name) return null
    const providerId = normalizeExplicitModelProvider(model.providerId ?? model.provider)
    const brandId = normalizeModelBrandId(model.brandId) ?? resolveModelBrandId({
      canonicalIdentity: typeof model.canonicalIdentity === 'string' ? model.canonicalIdentity : undefined,
      modelOwner: typeof model.modelOwner === 'string' ? model.modelOwner : undefined,
    })
    return {
      name: name.slice(0, 160),
      calls: nonNegativeInteger(model.calls),
      costMicrosUsd: usdToMicros(model.cost),
      estimatedCostMicrosUsd: nullableUsdToMicros(model.estimatedCostUSD),
      ...(providerId ? { providerId } : {}),
      ...(brandId ? { brandId } : {}),
    }
  }

  const topModels = rawModels
    .slice(0, MAX_TOP_MODELS)
    .map(mapModel)
    .filter((value): value is CompanionModelUsageV1 => value !== null)

  const accounting = typeof current.modelAccounting === 'object' && current.modelAccounting !== null && !Array.isArray(current.modelAccounting)
    ? current.modelAccounting as JsonRecord
    : null
  const models = accounting && Array.isArray(accounting.rows)
    ? accounting.rows.slice(0, MAX_MODELS)
      .map(mapModel)
      .filter((value): value is CompanionModelUsageV1 => value !== null)
    : undefined
  const modelAccountingGap = materialModelAccountingGap(accounting?.gap)

  const label = typeof current.label === 'string' && current.label.trim()
    ? current.label.trim().slice(0, 120)
    : 'Selected period'

  const generatedAt = safeGeneratedAt(root.generated)
  const projectScope = root.projectScope && typeof root.projectScope === 'object' && !Array.isArray(root.projectScope)
    ? root.projectScope as JsonRecord
    : null
  const projectId = typeof projectScope?.selectedId === 'string' && projectScope.selectedId.trim()
    ? projectScope.selectedId.trim().slice(0, 120)
    : 'all'
  const coverage = projectDetailCoverage(current.projectDetailCoverage)
  const periodLabel = typeof current.label === 'string' && current.label.trim()
    ? current.label.trim().slice(0, 120)
    : 'Selected period'
  const trend = companionTrend(root, generatedAt, periodLabel, query)

  return {
    kind: COMPANION_USAGE_KIND,
    version: COMPANION_USAGE_VERSION,
    generatedAt,
    scope: { projectId },
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
    ...(models ? { models } : {}),
    ...(modelAccountingGap ? { modelAccountingGap } : {}),
    quality: {
      pricingCoverage: nullableFraction(current.pricingCoverage),
      ...(coverage ? { projectDetailCoverage: coverage } : {}),
    },
    ...(trend ? { trend } : {}),
  }
}
