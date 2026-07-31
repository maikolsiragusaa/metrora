import { z } from 'zod'

import {
  HistoricalPriceRecordV1Schema,
  parseHistoricalPriceBookV1,
  type HistoricalPriceRatesV1,
  type HistoricalPriceRecordV1,
} from './history.js'

const NonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const HistoricalPriceUsageV1Schema = z.strictObject({
  inputTokens: NonNegativeSafeIntegerSchema,
  billableOutputTokens: NonNegativeSafeIntegerSchema,
  cacheReadTokens: NonNegativeSafeIntegerSchema,
  cacheWriteTokens: NonNegativeSafeIntegerSchema,
  webSearchRequests: NonNegativeSafeIntegerSchema,
  promptInputTokens: NonNegativeSafeIntegerSchema.optional(),
  oneHourCacheWriteTokens: NonNegativeSafeIntegerSchema.optional(),
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
      reason: 'missing-prompt-input-token-count' | 'non-finite-result'
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
  promptInputTokens: number | undefined,
): { rates: HistoricalPriceRatesV1; selection: HistoricalRateSelectionV1 } | undefined {
  const bands = record.rateBands ?? []
  if (bands.length === 0) return { rates: record.rates, selection: { kind: 'base' } }
  if (promptInputTokens === undefined) return undefined

  let rates = record.rates
  let selection: HistoricalRateSelectionV1 = { kind: 'base' }
  for (const band of bands) {
    if (promptInputTokens <= band.when.tokens) break
    rates = band.rates
    selection = { kind: 'prompt-input-tokens-above', tokens: band.when.tokens }
  }
  return { rates, selection }
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

  const selected = selectRates(record, usage.promptInputTokens)
  if (!selected) {
    return {
      kind: 'unavailable',
      priceRecordId: record.priceRecordId,
      reason: 'missing-prompt-input-token-count',
    }
  }

  const rates = selected.rates
  const oneHourCacheWriteTokens = usage.oneHourCacheWriteTokens ?? 0
  const fiveMinuteCacheWriteTokens = usage.cacheWriteTokens - oneHourCacheWriteTokens
  const speedMultiplier = usage.speed === 'fast' ? (rates.fastMultiplier ?? 1) : 1
  const costUSD = speedMultiplier * (
    usage.inputTokens * rates.inputPerToken
    + usage.billableOutputTokens * rates.outputPerToken
    + usage.cacheReadTokens * rates.cacheReadPerToken
    + fiveMinuteCacheWriteTokens * rates.cacheWritePerToken
    + oneHourCacheWriteTokens
      * rates.cacheWritePerToken
      * ONE_HOUR_CACHE_WRITE_MULTIPLIER_FROM_FIVE_MINUTE_RATE
    + usage.webSearchRequests * (rates.webSearchPerRequest ?? 0)
  )

  if (!Number.isFinite(costUSD) || costUSD < 0) {
    return {
      kind: 'unavailable',
      priceRecordId: record.priceRecordId,
      reason: 'non-finite-result',
    }
  }

  return {
    kind: 'calculated',
    costUSD,
    priceRecordId: record.priceRecordId,
    selectedRates: rates,
    rateSelection: selected.selection,
  }
}
