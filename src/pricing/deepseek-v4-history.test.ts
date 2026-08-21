import { describe, expect, it } from 'vitest'

import catalogData from '../data/pricing-history/catalog.v1.json'
import { assignRuntimeCostV1 } from './runtime-cost-assignment.js'
import { calculateHistoricalCostV1 } from './historical-cost.js'
import {
  parseHistoricalPriceBookV1,
  resolveHistoricalPriceRecordV1,
  type HistoricalPriceRecordV1,
} from './history.js'

const catalog = parseHistoricalPriceBookV1(catalogData)
const cutover = '2026-08-16T16:00:00Z'

const models = [
  {
    model: 'deepseek-v4-flash',
    oldRecordId: 'deepseek:deepseek-v4-flash:standard:official-2026-08-07',
    newRecordId: 'deepseek:deepseek-v4-flash:standard:official-2026-08-16',
    oldRates: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
    offPeakRates: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0.22 },
    peakRates: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 },
  },
  {
    model: 'deepseek-v4-pro',
    oldRecordId: 'deepseek:deepseek-v4-pro:standard:official-2026-08-07',
    newRecordId: 'deepseek:deepseek-v4-pro:standard:official-2026-08-16',
    oldRates: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0.435 },
    offPeakRates: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0.66 },
    peakRates: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 1.32 },
  },
] as const

const boundaryCases = [
  { label: 'immediately before cutover', timestamp: '2026-08-16T15:59:59.999Z', era: 'old' as const },
  { label: 'exactly at cutover', timestamp: cutover, era: 'off-peak' as const },
  { label: 'off-peak at 00:30 UTC', timestamp: '2026-08-17T00:30:00Z', era: 'off-peak' as const },
  { label: 'first peak start at 01:00 UTC', timestamp: '2026-08-17T01:00:00Z', era: 'peak-01-04' as const },
  { label: 'first peak end at 04:00 UTC', timestamp: '2026-08-17T04:00:00Z', era: 'off-peak' as const },
  { label: 'second peak start at 06:00 UTC', timestamp: '2026-08-17T06:00:00Z', era: 'peak-06-10' as const },
  { label: 'second peak end at 10:00 UTC', timestamp: '2026-08-17T10:00:00Z', era: 'off-peak' as const },
  { label: 'off-peak at 23:59 UTC', timestamp: '2026-08-17T23:59:59Z', era: 'off-peak' as const },
] as const

const usage = {
  inputTokens: 1_000_000,
  billableOutputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  webSearchRequests: 0,
  promptInputTokens: 3_000_000,
  oneHourCacheWriteTokens: 0,
  speed: 'standard' as const,
}

function lookup(model: string, timestamp: string): HistoricalPriceRecordV1 {
  const record = resolveHistoricalPriceRecordV1(catalog, {
    pricingAuthority: 'deepseek',
    pricingModel: model,
    route: 'standard',
    timestamp,
  })
  if (!record) throw new Error(`missing DeepSeek record for ${model} at ${timestamp}`)
  return record
}

function ratesPerMillion(record: HistoricalPriceRecordV1) {
  return {
    input: record.rates.inputPerToken * 1_000_000,
    output: record.rates.outputPerToken * 1_000_000,
    cacheRead: record.rates.cacheReadPerToken * 1_000_000,
    cacheWrite: record.rates.cacheWritePerToken * 1_000_000,
  }
}

function expectedCost(rates: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return rates.input + rates.output + rates.cacheRead + rates.cacheWrite
}

function expectRates(
  actual: { input: number; output: number; cacheRead: number; cacheWrite: number },
  expected: { input: number; output: number; cacheRead: number; cacheWrite: number },
): void {
  expect(actual.input).toBeCloseTo(expected.input, 12)
  expect(actual.output).toBeCloseTo(expected.output, 12)
  expect(actual.cacheRead).toBeCloseTo(expected.cacheRead, 12)
  expect(actual.cacheWrite).toBeCloseTo(expected.cacheWrite, 12)
}

function runtimeInput(model: string, timestamp: string) {
  return {
    provider: 'claude',
    model,
    modelProvider: 'deepseek',
    timestamp,
    speed: 'standard' as const,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.billableOutputTokens,
      cacheCreationInputTokens: usage.cacheWriteTokens,
      cacheReadInputTokens: usage.cacheReadTokens,
      reasoningTokens: 0,
      webSearchRequests: 0,
    },
    legacyCostUSD: 999,
  }
}

describe('DeepSeek V4 reviewed time-of-day pricing', () => {
  for (const model of models) {
    describe(model.model, () => {
      for (const boundary of boundaryCases) {
        it(`selects the ${boundary.era} record at ${boundary.label}`, () => {
          const record = lookup(model.model, boundary.timestamp)
          const expectedRates = boundary.era === 'old'
            ? model.oldRates
            : boundary.era === 'off-peak' ? model.offPeakRates : model.peakRates

          expect(record.priceRecordId).toBe(
            boundary.era === 'old' ? model.oldRecordId : model.newRecordId,
          )
          expectRates(
            ratesPerMillion(record),
            boundary.era === 'old' ? model.oldRates : model.offPeakRates,
          )

          const calculated = calculateHistoricalCostV1(record, {
            ...usage,
            timestamp: boundary.timestamp,
          })
          expect(calculated.kind).toBe('calculated')
          if (calculated.kind !== 'calculated') return
          expect(calculated.costUSD).toBeCloseTo(expectedCost(expectedRates), 12)
          expectRates({
            input: calculated.selectedRates.inputPerToken * 1_000_000,
            output: calculated.selectedRates.outputPerToken * 1_000_000,
            cacheRead: calculated.selectedRates.cacheReadPerToken * 1_000_000,
            cacheWrite: calculated.selectedRates.cacheWritePerToken * 1_000_000,
          }, expectedRates)

          if (boundary.era === 'peak-01-04' || boundary.era === 'peak-06-10') {
            expect(calculated.rateSelection).toMatchObject({
              kind: 'pricing-policy',
              policyId: boundary.era,
              conditionKinds: ['time-window'],
            })
          } else {
            expect(calculated.rateSelection).toEqual({ kind: 'base' })
          }
        })
      }

      it('keeps the legacy interval closed and the new interval half-open at the cutover', () => {
        const oldRecord = lookup(model.model, '2026-08-16T15:59:59.999Z')
        const newRecord = lookup(model.model, cutover)

        expect(oldRecord.validUntil).toBe(cutover)
        expect(newRecord.validFrom).toEqual({ basis: 'official-effective', at: cutover })
        expect(newRecord.supersedes).toBe(oldRecord.priceRecordId)
        expect(lookup(model.model, '2026-08-16T15:59:59.999Z').priceRecordId)
          .toBe(model.oldRecordId)
        expect(lookup(model.model, '2026-08-16T16:00:00.000Z').priceRecordId)
          .toBe(model.newRecordId)
      })

      it('settles the same usage through runtime historical assignment without using the mutable current-price layer', () => {
        const before = assignRuntimeCostV1(runtimeInput(model.model, '2026-08-16T15:59:59.999Z'))
        const peak = assignRuntimeCostV1(runtimeInput(model.model, '2026-08-17T01:00:00Z'))

        expect(before.storedAssignment).toMatchObject({
          kind: 'token-price',
          priceRecordId: model.oldRecordId,
          priceOrigin: 'reviewed-book',
        })
        expect(peak.storedAssignment).toMatchObject({
          kind: 'token-price',
          priceRecordId: model.newRecordId,
          priceOrigin: 'reviewed-book',
          rateSelection: { kind: 'pricing-policy', policyId: 'peak-01-04' },
        })
        expect(before.storedCostUSD).toBeCloseTo(expectedCost(model.oldRates), 12)
        expect(peak.storedCostUSD).toBeCloseTo(expectedCost(model.peakRates), 12)
        expect(before.storedCostUSD).not.toBe(peak.storedCostUSD)
      })
    })
  }

  it('represents recurring peak windows as deterministic UTC half-open policies', () => {
    const record = lookup('deepseek-v4-flash', cutover)
    expect(record.pricingMode).toBeUndefined()
    expect(record.pricingPolicies).toEqual([
      {
        policyId: 'peak-01-04',
        when: [{
          kind: 'time-window',
          window: { timeZone: 'UTC', startMinute: 60, endMinute: 240 },
        }],
        rates: {
          inputPerToken: 0.44 / 1_000_000,
          outputPerToken: 1.32 / 1_000_000,
          cacheReadPerToken: 0.014 / 1_000_000,
          cacheWritePerToken: 0.44 / 1_000_000,
        },
      },
      {
        policyId: 'peak-06-10',
        when: [{
          kind: 'time-window',
          window: { timeZone: 'UTC', startMinute: 360, endMinute: 600 },
        }],
        rates: {
          inputPerToken: 0.44 / 1_000_000,
          outputPerToken: 1.32 / 1_000_000,
          cacheReadPerToken: 0.014 / 1_000_000,
          cacheWritePerToken: 0.44 / 1_000_000,
        },
      },
    ])
  })
})
