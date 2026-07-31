import { describe, expect, it } from 'vitest'

import { calculateHistoricalCostV1 } from './historical-cost.js'
import type { HistoricalPriceRecordV1 } from './history.js'

function record(rates: HistoricalPriceRecordV1['rates']): HistoricalPriceRecordV1 {
  return {
    priceRecordId: 'test:coverage',
    pricingAuthority: 'test',
    pricingModel: 'coverage-model',
    validFrom: { basis: 'reviewed-effective', at: '2026-01-01T00:00:00Z' },
    rates,
    valuation: { kind: 'priced' },
    source: {
      kind: 'manual-reviewed',
      reference: 'coverage fixture',
      observedAt: '2026-01-01T00:00:00Z',
    },
  }
}

const baseRates = {
  inputPerToken: 1e-6,
  outputPerToken: 2e-6,
  cacheReadPerToken: 0.1e-6,
  cacheWritePerToken: 1.25e-6,
}

const baseUsage = {
  inputTokens: 1_000,
  billableOutputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearchRequests: 0,
  speed: 'standard' as const,
}

describe('historical optional-rate coverage', () => {
  it('fails closed when web-search usage has no reviewed request rate', () => {
    expect(calculateHistoricalCostV1(record(baseRates), {
      ...baseUsage,
      webSearchRequests: 1,
    })).toEqual({
      kind: 'unavailable',
      priceRecordId: 'test:coverage',
      reason: 'missing-web-search-rate',
    })
  })

  it('fails closed when fast usage has no reviewed multiplier', () => {
    expect(calculateHistoricalCostV1(record(baseRates), {
      ...baseUsage,
      speed: 'fast',
    })).toEqual({
      kind: 'unavailable',
      priceRecordId: 'test:coverage',
      reason: 'missing-fast-rate',
    })
  })

  it('uses reviewed optional rates when they are present', () => {
    const result = calculateHistoricalCostV1(record({
      ...baseRates,
      webSearchPerRequest: 0.01,
      fastMultiplier: 2,
    }), {
      ...baseUsage,
      webSearchRequests: 1,
      speed: 'fast',
    })

    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error('expected calculation')
    expect(result.costUSD).toBeCloseTo(0.0224, 12)
  })
})
