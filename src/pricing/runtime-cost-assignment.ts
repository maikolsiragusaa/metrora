import { AsyncLocalStorage } from 'node:async_hooks'

import catalogData from '../data/pricing-history/catalog.v1.json'
import { explicitZeroReasonForModel, getHistoricalPricingModelKey } from '../models.js'
import {
  CostAssignmentV1Schema,
  costUsdToMicrosV1,
  settledCostUsdV1,
  type CostAssignmentV1,
} from './cost-assignment.js'
import {
  parseHistoricalPriceBookV1,
  type HistoricalPriceBookV1,
  type HistoricalPriceRecordV1,
} from './history.js'
import {
  loadLocalPriceObservationBookV1,
  resolveHistoricalPriceAcrossBooksV1,
} from './local-observation-ledger.js'
import { settleHistoricalCostV1 } from './settled-historical-cost.js'

export type RuntimeHistoricalPricingModeV1 = 'historical' | 'compare' | 'legacy'

export type RuntimePricingUsageV1 = {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  reasoningTokens: number
  webSearchRequests: number
  cacheCreationOneHourTokens?: number
}

export type RuntimeCostAssignmentInputV1 = {
  provider: string
  model: string
  modelProvider?: string
  timestamp: string
  speed: 'standard' | 'fast'
  usage: RuntimePricingUsageV1
  legacyCostUSD: number
  isEstimated?: boolean
  existingAssignment?: CostAssignmentV1
  existingStoredCostUSD?: number
  existingLegacyCostUSD?: number
}

export type RuntimeCostAssignmentResultV1 = {
  storedCostUSD?: number
  storedAssignment: CostAssignmentV1
  storedLegacyCostUSD?: number
  runtimeCostUSD: number
  runtimeAssignment: CostAssignmentV1
}

type RuntimePricingStatsV1 = {
  comparedCalls: number
  changedCalls: number
  legacyTotalUSD: number
  historicalTotalUSD: number
  unavailableCalls: number
}

type RuntimePricingContextV1 = {
  mode: RuntimeHistoricalPricingModeV1
  reviewedBook: HistoricalPriceBookV1
  localBook: HistoricalPriceBookV1
  stats: RuntimePricingStatsV1
  localLedgerError?: string
}

const reviewedBook = parseHistoricalPriceBookV1(catalogData)
const emptyBook: HistoricalPriceBookV1 = { schemaVersion: 1, records: [] }
const contextStorage = new AsyncLocalStorage<RuntimePricingContextV1>()

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export function runtimeHistoricalPricingModeV1(): RuntimeHistoricalPricingModeV1 {
  const raw = (process.env['METRORA_HISTORICAL_PRICING'] ?? 'historical').trim().toLowerCase()
  if (raw === 'compare' || raw === 'shadow') return 'compare'
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'legacy' || raw === 'disabled') return 'legacy'
  return 'historical'
}

export function runtimeHistoricalPricingCacheKeyV1(): string {
  return runtimeHistoricalPricingModeV1()
}

async function createContext(): Promise<RuntimePricingContextV1> {
  let localBook = emptyBook
  let localLedgerError: string | undefined
  try {
    localBook = await loadLocalPriceObservationBookV1()
  } catch (error) {
    localLedgerError = error instanceof Error ? error.message : String(error)
  }
  return {
    mode: runtimeHistoricalPricingModeV1(),
    reviewedBook,
    localBook,
    stats: {
      comparedCalls: 0,
      changedCalls: 0,
      legacyTotalUSD: 0,
      historicalTotalUSD: 0,
      unavailableCalls: 0,
    },
    ...(localLedgerError ? { localLedgerError } : {}),
  }
}

function activeContext(): RuntimePricingContextV1 {
  return contextStorage.getStore() ?? {
    mode: runtimeHistoricalPricingModeV1(),
    reviewedBook,
    localBook: emptyBook,
    stats: {
      comparedCalls: 0,
      changedCalls: 0,
      legacyTotalUSD: 0,
      historicalTotalUSD: 0,
      unavailableCalls: 0,
    },
  }
}

function emitContextSummary(context: RuntimePricingContextV1): void {
  if (context.localLedgerError) {
    process.stderr.write('metrora: local price observation ledger is invalid; reviewed history and legacy-frozen values remain available\n')
  }
  if (context.mode !== 'compare' || context.stats.comparedCalls === 0) return
  const delta = context.stats.historicalTotalUSD - context.stats.legacyTotalUSD
  process.stderr.write(
    `metrora: historical pricing comparison: ${context.stats.comparedCalls} calls, `
    + `${context.stats.changedCalls} changed, legacy $${context.stats.legacyTotalUSD.toFixed(6)}, `
    + `historical $${context.stats.historicalTotalUSD.toFixed(6)}, delta ${delta >= 0 ? '+' : ''}$${delta.toFixed(6)}, `
    + `${context.stats.unavailableCalls} unavailable\n`,
  )
}

export async function withRuntimeHistoricalPricingV1<T>(operation: () => Promise<T>): Promise<T> {
  const existing = contextStorage.getStore()
  if (existing) return operation()
  const context = await createContext()
  return contextStorage.run(context, async () => {
    try {
      return await operation()
    } finally {
      emitContextSummary(context)
    }
  })
}

function legacyAssignment(costUSD: number): CostAssignmentV1 {
  return CostAssignmentV1Schema.parse({
    version: 1,
    kind: 'legacy-frozen',
    amountMicrosUsd: costUsdToMicrosV1(costUSD),
    reason: 'inherited-token-pricing',
  })
}

function unavailableAssignment(): CostAssignmentV1 {
  return CostAssignmentV1Schema.parse({
    version: 1,
    kind: 'unavailable',
    reason: 'no-price-record',
  })
}

function explicitZeroAssignment(reason: 'local-inference' | 'manual-reviewed'): CostAssignmentV1 {
  return CostAssignmentV1Schema.parse({
    version: 1,
    kind: 'explicit-zero',
    amountMicrosUsd: 0,
    reason,
  })
}

function meteredSource(
  provider: string,
  isEstimated: boolean | undefined,
): 'provider' | 'client' | 'billing-export' | undefined {
  if (provider === 'vercel-gateway') return 'billing-export'
  if (isEstimated === true) return undefined
  if (provider === 'hermes' || provider === 'codewhale' || provider === 'quickdesk') return 'client'
  return undefined
}

function meteredAssignment(costUSD: number, source: 'provider' | 'client' | 'billing-export'): CostAssignmentV1 {
  return CostAssignmentV1Schema.parse({
    version: 1,
    kind: 'metered',
    amountMicrosUsd: costUsdToMicrosV1(costUSD),
    source,
  })
}

function recordsAt(
  books: readonly HistoricalPriceBookV1[],
  pricingModel: string,
  route: string,
  timestamp: string,
): HistoricalPriceRecordV1[] {
  const at = Date.parse(timestamp)
  if (!Number.isFinite(at)) return []
  return books.flatMap(book => book.records.filter((record: HistoricalPriceRecordV1) => {
    if (record.pricingModel !== pricingModel) return false
    if ((record.route ?? 'standard') !== route) return false
    const start = Date.parse(record.validFrom.at)
    const end = record.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(record.validUntil)
    return start <= at && at < end
  }))
}

function normalizeAuthority(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

function resolveHistoricalRecord(
  context: RuntimePricingContextV1,
  input: RuntimeCostAssignmentInputV1,
): ReturnType<typeof resolveHistoricalPriceAcrossBooksV1> {
  const pricingModel = getHistoricalPricingModelKey(input.model)
  const route = 'standard'
  let pricingAuthority = normalizeAuthority(input.modelProvider)

  if (!pricingAuthority) {
    const authorities = new Set(
      recordsAt([context.reviewedBook, context.localBook], pricingModel, route, input.timestamp)
        .map(record => record.pricingAuthority),
    )
    // Internal price-book disambiguation only: this never populates or changes
    // the source-recorded modelProvider field presented to the user.
    if (authorities.size === 1) pricingAuthority = [...authorities][0]
  }
  if (!pricingAuthority) return undefined

  return resolveHistoricalPriceAcrossBooksV1(context.reviewedBook, context.localBook, {
    pricingAuthority,
    pricingModel,
    route,
    timestamp: input.timestamp,
  })
}

function usageForSettlement(input: RuntimeCostAssignmentInputV1) {
  const outputTokens = input.provider === 'claude'
    ? input.usage.outputTokens
    : input.usage.outputTokens + input.usage.reasoningTokens
  return {
    inputTokens: input.usage.inputTokens,
    billableOutputTokens: outputTokens,
    cacheReadTokens: input.usage.cacheReadInputTokens,
    cacheWriteTokens: input.usage.cacheCreationInputTokens,
    webSearchRequests: input.usage.webSearchRequests,
    promptInputTokens: input.usage.inputTokens
      + input.usage.cacheReadInputTokens
      + input.usage.cacheCreationInputTokens,
    oneHourCacheWriteTokens: input.usage.cacheCreationOneHourTokens ?? 0,
    speed: input.speed,
  } as const
}

function runtimeView(
  context: RuntimePricingContextV1,
  storedCostUSD: number | undefined,
  storedAssignment: CostAssignmentV1,
  legacyCostUSD: number,
  storedLegacyCostUSD: number | undefined,
): Pick<RuntimeCostAssignmentResultV1, 'runtimeCostUSD' | 'runtimeAssignment'> {
  if (context.mode === 'historical' || storedLegacyCostUSD === undefined) {
    return {
      runtimeCostUSD: storedCostUSD ?? 0,
      runtimeAssignment: storedAssignment,
    }
  }
  return {
    runtimeCostUSD: legacyCostUSD,
    runtimeAssignment: legacyCostUSD > 0 ? legacyAssignment(legacyCostUSD) : unavailableAssignment(),
  }
}

export function assignRuntimeCostV1(inputValue: RuntimeCostAssignmentInputV1): RuntimeCostAssignmentResultV1 {
  const context = activeContext()
  const legacyCostUSD = finiteNonNegative(inputValue.existingLegacyCostUSD ?? inputValue.legacyCostUSD)
  const existing = inputValue.existingAssignment
    ? CostAssignmentV1Schema.parse(inputValue.existingAssignment)
    : undefined

  // Existing provider-metered evidence is the strongest possible basis and is
  // never replaced by a model catalog or local configuration.
  if (existing?.kind === 'metered') {
    const storedCostUSD = inputValue.existingStoredCostUSD ?? settledCostUsdV1(existing) ?? legacyCostUSD
    return {
      storedCostUSD,
      storedAssignment: existing,
      runtimeCostUSD: storedCostUSD,
      runtimeAssignment: existing,
    }
  }

  const inferredMetered = meteredSource(inputValue.provider, inputValue.isEstimated)
  if (!existing && inferredMetered !== undefined) {
    const assignment = meteredAssignment(legacyCostUSD, inferredMetered)
    return {
      storedCostUSD: legacyCostUSD,
      storedAssignment: assignment,
      runtimeCostUSD: legacyCostUSD,
      runtimeAssignment: assignment,
    }
  }

  const zeroReason = explicitZeroReasonForModel(inputValue.model)
  if (zeroReason) {
    const assignment = explicitZeroAssignment(zeroReason)
    return {
      storedCostUSD: 0,
      storedAssignment: assignment,
      runtimeCostUSD: 0,
      runtimeAssignment: assignment,
    }
  }

  // A settled assignment already in v8 is immutable. The optional legacy value
  // exists solely for a controlled rollback/comparison view; it never mutates
  // the stored historical amount or its evidence.
  if (existing) {
    const storedCostUSD = existing.kind === 'unavailable'
      ? undefined
      : inputValue.existingStoredCostUSD ?? settledCostUsdV1(existing)
    const storedLegacyCostUSD = inputValue.existingLegacyCostUSD
    return {
      storedCostUSD,
      storedAssignment: existing,
      ...(storedLegacyCostUSD !== undefined ? { storedLegacyCostUSD } : {}),
      ...runtimeView(context, storedCostUSD, existing, legacyCostUSD, storedLegacyCostUSD),
    }
  }

  const resolved = resolveHistoricalRecord(context, inputValue)
  if (resolved) {
    const historical = settleHistoricalCostV1(resolved.record, resolved.origin, usageForSettlement(inputValue))
    if (historical.costUSD !== undefined) {
      const differs = costUsdToMicrosV1(historical.costUSD) !== costUsdToMicrosV1(legacyCostUSD)
      const storedLegacyCostUSD = differs ? legacyCostUSD : undefined
      if (context.mode === 'compare') {
        context.stats.comparedCalls++
        context.stats.legacyTotalUSD += legacyCostUSD
        context.stats.historicalTotalUSD += historical.costUSD
        if (differs) context.stats.changedCalls++
      }
      return {
        storedCostUSD: historical.costUSD,
        storedAssignment: historical.assignment,
        ...(storedLegacyCostUSD !== undefined ? { storedLegacyCostUSD } : {}),
        ...runtimeView(context, historical.costUSD, historical.assignment, legacyCostUSD, storedLegacyCostUSD),
      }
    }
    if (context.mode === 'compare') context.stats.unavailableCalls++
  }

  if (legacyCostUSD > 0) {
    const assignment = legacyAssignment(legacyCostUSD)
    return {
      storedCostUSD: legacyCostUSD,
      storedAssignment: assignment,
      runtimeCostUSD: legacyCostUSD,
      runtimeAssignment: assignment,
    }
  }

  const assignment = unavailableAssignment()
  return {
    storedAssignment: assignment,
    runtimeCostUSD: 0,
    runtimeAssignment: assignment,
  }
}
