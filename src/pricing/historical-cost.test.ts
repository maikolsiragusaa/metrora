import { describe, expect, it } from 'vitest'

import { calculateCost } from '../models.js'
import { calculateHistoricalCostV1 } from './historical-cost.js'
import type { HistoricalPriceRecordV1 } from './history.js'

function record(overrides: Partial<HistoricalPriceRecordV1> = {}): HistoricalPriceRecordV1 {
  return {
    priceRecordId: 'test:model-a:2026-01-01',
    pricingAuthority: 'test',
    pricingModel: 'model-a',
    validFrom: { basis: 'reviewed-effective', at: '2026-01-01T00:00:00Z' },
    rates: {
      inputPerToken: 0.5e-6,
      outputPerToken: 2.5e-6,
      cacheReadPerToken: 0.2e-6,
      cacheWritePerToken: 0.5e-6,
      webSearchPerRequest: 0.01,
    },
    valuation: { kind: 'priced' },
    source: {
      kind: 'manual-reviewed',
      reference: 'test fixture',
      observedAt: '2026-01-01T00:00:00Z',
    },
    ...overrides,
  }
}

const usage = {
  inputTokens: 1_000,
  billableOutputTokens: 200,
  cacheReadTokens: 400,
  cacheWriteTokens: 300,
  webSearchRequests: 2,
  oneHourCacheWriteTokens: 100,
  speed: 'standard' as const,
}

describe('historical cost calculation v1', () => {
  it('matches the inherited pricing formula for equivalent flat rates', () => {
    const historical = calculateHistoricalCostV1(record(), usage)
    const inherited = calculateCost(
      'composer-2.5',
      usage.inputTokens,
      usage.billableOutputTokens,
      usage.cacheWriteTokens,
      usage.cacheReadTokens,
      usage.webSearchRequests,
      usage.speed,
      usage.oneHourCacheWriteTokens,
    )

    expect(historical.kind).toBe('calculated')
    if (historical.kind !== 'calculated') throw new Error('expected historical calculation')
    expect(historical.costUSD).toBeCloseTo(inherited, 12)
    expect(historical.rateSelection).toEqual({ kind: 'base' })
  })

  it('uses the base price at the exact threshold and the band above it', () => {
    const conditional = record({
      rateBands: [{
        when: { kind: 'prompt-input-tokens-above', tokens: 272_000 },
        rates: {
          inputPerToken: 2e-6,
          outputPerToken: 3e-6,
          cacheReadPerToken: 0.4e-6,
          cacheWritePerToken: 2.5e-6,
          webSearchPerRequest: 0.02,
        },
      }],
    })

    const atThreshold = calculateHistoricalCostV1(conditional, {
      ...usage,
      promptInputTokens: 272_000,
    })
    const aboveThreshold = calculateHistoricalCostV1(conditional, {
      ...usage,
      promptInputTokens: 272_001,
    })

    expect(atThreshold.kind).toBe('calculated')
    expect(aboveThreshold.kind).toBe('calculated')
    if (atThreshold.kind !== 'calculated' || aboveThreshold.kind !== 'calculated') {
      throw new Error('expected historical calculations')
    }
    expect(atThreshold.rateSelection).toEqual({ kind: 'base' })
    expect(aboveThreshold.rateSelection).toEqual({
      kind: 'prompt-input-tokens-above',
      tokens: 272_000,
    })
    expect(aboveThreshold.costUSD).toBeGreaterThan(atThreshold.costUSD)
  })

  it('selects the highest matching conditional band', () => {
    const conditional = record({
      rateBands: [
        {
          when: { kind: 'prompt-input-tokens-above', tokens: 100_000 },
          rates: {
            inputPerToken: 1e-6,
            outputPerToken: 3e-6,
            cacheReadPerToken: 0.3e-6,
            cacheWritePerToken: 1.25e-6,
          },
        },
        {
          when: { kind: 'prompt-input-tokens-above', tokens: 500_000 },
          rates: {
            inputPerToken: 2e-6,
            outputPerToken: 4e-6,
            cacheReadPerToken: 0.4e-6,
            cacheWritePerToken: 2.5e-6,
          },
        },
      ],
    })

    const result = calculateHistoricalCostV1(conditional, {
      ...usage,
      webSearchRequests: 0,
      promptInputTokens: 700_000,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error('expected historical calculation')
    expect(result.rateSelection).toEqual({
      kind: 'prompt-input-tokens-above',
      tokens: 500_000,
    })
    expect(result.selectedRates.inputPerToken).toBe(2e-6)
  })

  it('fails closed when a conditional price lacks prompt-size evidence', () => {
    const result = calculateHistoricalCostV1(record({
      rateBands: [{
        when: { kind: 'prompt-input-tokens-above', tokens: 272_000 },
        rates: {
          inputPerToken: 2e-6,
          outputPerToken: 3e-6,
          cacheReadPerToken: 0.4e-6,
          cacheWritePerToken: 2.5e-6,
        },
      }],
    }), usage)

    expect(result).toEqual({
      kind: 'unavailable',
      priceRecordId: 'test:model-a:2026-01-01',
      reason: 'missing-prompt-input-token-count',
    })
  })

  it('returns an evidenced explicit zero without requiring threshold input', () => {
    const free = record({
      rates: {
        inputPerToken: 0,
        outputPerToken: 0,
        cacheReadPerToken: 0,
        cacheWritePerToken: 0,
      },
      rateBands: [{
        when: { kind: 'prompt-input-tokens-above', tokens: 272_000 },
        rates: {
          inputPerToken: 0,
          outputPerToken: 0,
          cacheReadPerToken: 0,
          cacheWritePerToken: 0,
        },
      }],
      valuation: { kind: 'explicit-zero', reason: 'free-route' },
    })

    const result = calculateHistoricalCostV1(free, usage)
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error('expected zero calculation')
    expect(result.costUSD).toBe(0)
  })

  it('applies the selected fast multiplier', () => {
    const fast = record({
      rates: {
        inputPerToken: 1e-6,
        outputPerToken: 2e-6,
        cacheReadPerToken: 0.1e-6,
        cacheWritePerToken: 1.25e-6,
        webSearchPerRequest: 0.01,
        fastMultiplier: 2,
      },
    })
    const standard = calculateHistoricalCostV1(fast, { ...usage, speed: 'standard' })
    const accelerated = calculateHistoricalCostV1(fast, { ...usage, speed: 'fast' })

    expect(standard.kind).toBe('calculated')
    expect(accelerated.kind).toBe('calculated')
    if (standard.kind !== 'calculated' || accelerated.kind !== 'calculated') {
      throw new Error('expected historical calculations')
    }
    expect(accelerated.costUSD).toBeCloseTo(standard.costUSD * 2, 12)
  })

  it('rejects inconsistent one-hour cache-write evidence', () => {
    expect(() => calculateHistoricalCostV1(record(), {
      ...usage,
      cacheWriteTokens: 10,
      oneHourCacheWriteTokens: 11,
    })).toThrow(/one-hour cache writes cannot exceed total cache writes/)
  })

  it('fails closed on an arithmetic overflow', () => {
    const result = calculateHistoricalCostV1(record({
      rates: {
        inputPerToken: Number.MAX_VALUE,
        outputPerToken: 1,
        cacheReadPerToken: 1,
        cacheWritePerToken: 1,
      },
    }), {
      inputTokens: 2,
      billableOutputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
      speed: 'standard',
    })

    expect(result).toEqual({
      kind: 'unavailable',
      priceRecordId: 'test:model-a:2026-01-01',
      reason: 'non-finite-result',
    })
  })
})
