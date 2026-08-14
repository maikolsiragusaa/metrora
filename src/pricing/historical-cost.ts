import { z } from 'zod'

import {
  HistoricalPriceRecordV1Schema,
  parseHistoricalPriceBookV1,
  type HistoricalPriceRatesV1,
  type HistoricalPriceRecordV1,
} from './history.js'
import { HistoricalPricingEvidenceV1Schema, type HistoricalPricingEvidenceV1 } from './pricing-context.js'
import {
  selectHistoricalPricePolicyV1,
  type HistoricalPricePolicyRequestV1,
} from './pricing-policy.js'

const NonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const HistoricalPriceUsageV1Schema = z.strictObject({
  inputTokens: NonNegativeSafeIntegerSchema,
  billableOutputTokens: NonNegativeSafeIntegerSchema,
  cacheReadTokens: NonNegativeSafeIntegerSchema,
  cacheWriteTokens: NonNegativeSafeIntegerSchema,
  webSearchRequests: NonNegativeSafeIntegerSchema,
  gatewayRequests: NonNegativeSafeIntegerSchema.optional(),
  toolRequests: NonNegativeSafeIntegerSchema.optional(),
  promptInputTokens: NonNegativeSafeIntegerSchema.optional(),
  oneHourCacheWriteTokens: NonNegativeSafeIntegerSchema.optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  route: z.string().trim().min(1).max(240).optional(),
  billingTier: z.string().trim().min(1).max(240).optional(),
  cacheTier: z.enum(['none', 'read', 'write-5m', 'write-1h']).optional(),
  pricingEvidence: z.array(HistoricalPricingEvidenceV1Schema).max(8).optional(),
  speed: z.enum(['standard', 'fast']).default('standard'),
}).superRefine((usage, context) => {
  if ((usage.oneHourCacheWriteTokens ?? 0) > usage.cacheWriteTokens) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['oneHourCacheWriteTokens'],
      message: 'one-hour cache writes cannot exceed total cache writes',
    })
  }
})

export type HistoricalPriceUsageV1 = z.infer<typeof HistoricalPriceUsageV1Schema>
export type HistoricalRateSelectionV1 =
  | { kind: 'base' }
  | { kind: 'prompt-input-tokens-above'; tokens: number }
  | { kind: 'pricing-policy'; policyId: string; conditionKinds: string[] }
  | { kind: 'pricing-evidence'; evidenceKind: HistoricalPricingEvidenceV1['kind'] }

export type HistoricalCostCalculationV1 =
  | {
      kind: 'calculated'
      costUSD: number
      priceRecordId: string
      selectedRates: HistoricalPriceRatesV1
      rateSelection: HistoricalRateSelectionV1
    }
  | {
      kind: 'unavailable'
      priceRecordId: string
      reason:
        | 'missing-prompt-input-token-count'
        | 'missing-web-search-rate'
        | 'missing-fast-rate'
        | 'missing-request-charge-rate'
        | 'missing-pricing-evidence'
        | 'ambiguous-pricing-policy'
        | 'non-finite-result'
    }

const ONE_HOUR_CACHE_WRITE_MULTIPLIER_FROM_FIVE_MINUTE_RATE = 1.6

function validatedStandaloneRecord(input: HistoricalPriceRecordV1 | unknown): HistoricalPriceRecordV1 {
  const record = HistoricalPriceRecordV1Schema.parse(input)
  // Record-level economic validation lives in the price-book parser. Remove the
  // chain pointer for this standalone validation because its predecessor is not
  // part of a one-record calculation call.
  parseHistoricalPriceBookV1({
    schemaVersion: 1,
    records: [{ ...record, supersedes: undefined }],
  })
  return record
}

function selectRates(
  record: HistoricalPriceRecordV1,
  usage: HistoricalPriceUsageV1,
): { rates: HistoricalPriceRatesV1; selection: HistoricalRateSelectionV1 }
  | { unavailable: Extract<HistoricalCostCalculationV1, { kind: 'unavailable' }>['reason'] }
  | undefined {
  const bands = record.rateBands ?? []
  if (bands.length > 0 && usage.promptInputTokens === undefined) return undefined

  let rates = record.rates
  let selection: HistoricalRateSelectionV1 = { kind: 'base' }
  for (const band of bands) {
    if (usage.promptInputTokens! <= band.when.tokens) break
    rates = band.rates
    selection = { kind: 'prompt-input-tokens-above', tokens: band.when.tokens }
  }

  const policy = selectHistoricalPricePolicyV1(record, usage as HistoricalPricePolicyRequestV1)
  if (policy.kind === 'unavailable') return { unavailable: policy.reason }
  if (policy.selection.kind !== 'base' || record.pricingPolicies?.length) {
    rates = policy.rates
    selection = policy.selection
  }
  return { rates, selection }
}

function unavailable(
  record: HistoricalPriceRecordV1,
  reason: Extract<HistoricalCostCalculationV1, { kind: 'unavailable' }>['reason'],
): HistoricalCostCalculationV1 {
  return { kind: 'unavailable', priceRecordId: record.priceRecordId, reason }
}

export function calculateHistoricalCostV1(
  recordInput: HistoricalPriceRecordV1 | unknown,
  usageInput: HistoricalPriceUsageV1 | unknown,
): HistoricalCostCalculationV1 {
  const record = validatedStandaloneRecord(recordInput)
  const usage = HistoricalPriceUsageV1Schema.parse(usageInput)

  if (record.valuation.kind === 'explicit-zero') {
    return {
      kind: 'calculated',
      costUSD: 0,
      priceRecordId: record.priceRecordId,
      selectedRates: record.rates,
      rateSelection: { kind: 'base' },
    }
  }

  const selected = selectRates(record, usage)
  if (!selected) return unavailable(record, 'missing-prompt-input-token-count')
  if ('unavailable' in selected) return unavailable(record, selected.unavailable)

  const rates = selected.rates
  if (usage.webSearchRequests > 0 && rates.webSearchPerRequest === undefined) {
    return unavailable(record, 'missing-web-search-rate')
  }
  if (usage.speed === 'fast' && rates.fastMultiplier === undefined) {
    return unavailable(record, 'missing-fast-rate')
  }

  if (rates.requestCharges?.gatewayServicePerRequest !== undefined && usage.gatewayRequests === undefined) {
    return unavailable(record, 'missing-request-charge-rate')
  }
  if (rates.requestCharges?.toolRequestPerRequest !== undefined && usage.toolRequests === undefined) {
    return unavailable(record, 'missing-request-charge-rate')
  }

  const oneHourCacheWriteTokens = usage.oneHourCacheWriteTokens ?? 0
  const fiveMinuteCacheWriteTokens = usage.cacheWriteTokens - oneHourCacheWriteTokens
  const speedMultiplier = usage.speed === 'fast' ? rates.fastMultiplier! : 1
  const costUSD = speedMultiplier * (
    usage.inputTokens * rates.inputPerToken
    + usage.billableOutputTokens * rates.outputPerToken
    + usage.cacheReadTokens * rates.cacheReadPerToken
    + fiveMinuteCacheWriteTokens * rates.cacheWritePerToken
    + oneHourCacheWriteTokens
      * rates.cacheWritePerToken
      * ONE_HOUR_CACHE_WRITE_MULTIPLIER_FROM_FIVE_MINUTE_RATE
    + usage.webSearchRequests * (rates.webSearchPerRequest ?? 0)
    + (usage.gatewayRequests ?? 0) * (rates.requestCharges?.gatewayServicePerRequest ?? 0)
    + (usage.toolRequests ?? 0) * (rates.requestCharges?.toolRequestPerRequest ?? 0)
  )

  if (!Number.isFinite(costUSD) || costUSD < 0) {
    return unavailable(record, 'non-finite-result')
  }

  return {
    kind: 'calculated',
    costUSD,
    priceRecordId: record.priceRecordId,
    selectedRates: rates,
    rateSelection: selected.selection,
  }
}
