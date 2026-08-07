import { describe, expect, it } from 'vitest'

import catalogData from '../data/pricing-history/catalog.v1.json'
import { calculateHistoricalCostV1 } from './historical-cost.js'
import {
  parseHistoricalPriceBookV1,
  resolveHistoricalPriceRecordV1,
} from './history.js'

const catalog = parseHistoricalPriceBookV1(catalogData)
const gpt56Records = catalog.records.filter(record =>
  record.pricingAuthority === 'openai'
  && record.pricingModel.startsWith('gpt-5.6-')
  && record.route === 'standard'
)

const lookup = (model: string, timestamp: string) => resolveHistoricalPriceRecordV1(catalog, {
  pricingAuthority: 'openai',
  pricingModel: model,
  route: 'standard',
  timestamp,
})

const representativeUsage = {
  inputTokens: 1_000_000,
  billableOutputTokens: 100_000,
  cacheReadTokens: 2_000_000,
  cacheWriteTokens: 200_000,
  webSearchRequests: 0,
  promptInputTokens: 200_000,
  speed: 'standard' as const,
}

function calculatedCost(model: string, timestamp: string): number {
  const record = lookup(model, timestamp)
  if (!record) throw new Error(`missing ${model} record at ${timestamp}`)
  const result = calculateHistoricalCostV1(record, representativeUsage)
  if (result.kind !== 'calculated') throw new Error(`unexpected unavailable cost: ${result.reason}`)
  return result.costUSD
}

describe('reviewed GPT-5.6 standard price history', () => {
  it('keeps this tranche scoped to the six reviewed GPT-5.6 standard-route intervals', () => {
    expect(gpt56Records).toHaveLength(6)
    expect(gpt56Records.every(record => record.pricingAuthority === 'openai')).toBe(true)
    expect(gpt56Records.every(record => record.route === 'standard')).toBe(true)
    expect(gpt56Records.every(record => record.validFrom.basis === 'first-observed')).toBe(true)
  })

  it('does not invent coverage before GPT-5.6 prices were first observed', () => {
    expect(lookup('gpt-5.6-luna', '2026-07-09T18:51:11Z')).toBeUndefined()
  })

  it('uses the old Luna interval before the observed cut and the new interval at the boundary', () => {
    expect(lookup('gpt-5.6-luna', '2026-07-30T20:08:00Z')?.priceRecordId)
      .toBe('openai:gpt-5.6-luna:standard:litellm-a874de6')
    expect(lookup('gpt-5.6-luna', '2026-07-30T20:08:01Z')?.priceRecordId)
      .toBe('openai:gpt-5.6-luna:standard:litellm-f1b781d')
  })

  it('preserves the 80% Luna reduction without repricing earlier usage', () => {
    const oldCost = calculatedCost('gpt-5.6-luna', '2026-07-30T20:08:00Z')
    const newCost = calculatedCost('gpt-5.6-luna', '2026-07-30T20:08:01Z')
    expect(newCost).toBeCloseTo(oldCost * 0.2, 12)
  })

  it('preserves the 20% Terra reduction without repricing earlier usage', () => {
    const oldCost = calculatedCost('gpt-5.6-terra', '2026-07-30T20:08:00Z')
    const newCost = calculatedCost('gpt-5.6-terra', '2026-07-30T20:08:01Z')
    expect(newCost).toBeCloseTo(oldCost * 0.8, 12)
  })

  it('adds Sol fast-mode evidence without changing its standard price', () => {
    const before = lookup('gpt-5.6-sol', '2026-07-30T20:08:00Z')
    const after = lookup('gpt-5.6-sol', '2026-07-30T20:08:01Z')
    expect(before?.priceRecordId).toBe('openai:gpt-5.6-sol:standard:litellm-a874de6')
    expect(after?.priceRecordId).toBe('openai:gpt-5.6-sol:standard:official-2026-07-30')

    if (!after) throw new Error('missing post-fast-mode Sol record')
    const standard = calculateHistoricalCostV1(after, representativeUsage)
    const fast = calculateHistoricalCostV1(after, { ...representativeUsage, speed: 'fast' })
    expect(standard.kind).toBe('calculated')
    expect(fast.kind).toBe('calculated')
    if (standard.kind !== 'calculated' || fast.kind !== 'calculated') {
      throw new Error('expected standard and fast Sol calculations')
    }
    expect(fast.costUSD).toBeCloseTo(standard.costUSD * 2, 12)
  })

  it('selects the reviewed long-context band only above 272K prompt input tokens', () => {
    const record = lookup('gpt-5.6-luna', '2026-07-31T00:00:00Z')
    if (!record) throw new Error('missing current Luna record')

    const atThreshold = calculateHistoricalCostV1(record, {
      ...representativeUsage,
      promptInputTokens: 272_000,
    })
    const aboveThreshold = calculateHistoricalCostV1(record, {
      ...representativeUsage,
      promptInputTokens: 272_001,
    })

    expect(atThreshold.kind).toBe('calculated')
    expect(aboveThreshold.kind).toBe('calculated')
    if (atThreshold.kind !== 'calculated' || aboveThreshold.kind !== 'calculated') {
      throw new Error('expected reviewed calculations')
    }
    expect(atThreshold.rateSelection).toEqual({ kind: 'base' })
    expect(aboveThreshold.rateSelection).toEqual({
      kind: 'prompt-input-tokens-above',
      tokens: 272_000,
    })
    expect(aboveThreshold.selectedRates.inputPerToken).toBe(4e-7)
    expect(aboveThreshold.selectedRates.outputPerToken).toBe(1.8e-6)
  })

  it('does not collapse the standard route into an unqualified model lookup', () => {
    expect(resolveHistoricalPriceRecordV1(catalog, {
      pricingAuthority: 'openai',
      pricingModel: 'gpt-5.6-luna',
      timestamp: '2026-07-31T00:00:00Z',
    })).toBeUndefined()
  })
})
