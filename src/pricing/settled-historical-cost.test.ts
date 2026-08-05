import { describe, expect, it } from 'vitest'

import catalogData from '../data/pricing-history/catalog.v1.json'
import { parseHistoricalPriceBookV1, resolveHistoricalPriceRecordV1 } from './history.js'
import { settleHistoricalCostV1 } from './settled-historical-cost.js'

const catalog = parseHistoricalPriceBookV1(catalogData)

function lunaRecord() {
  const record = resolveHistoricalPriceRecordV1(catalog, {
    pricingAuthority: 'openai',
    pricingModel: 'gpt-5.6-luna',
    route: 'standard',
    timestamp: '2026-07-31T00:00:00Z',
  })
  if (!record) throw new Error('missing reviewed Luna record')
  return record
}

const usage = {
  inputTokens: 1_000_000,
  billableOutputTokens: 100_000,
  cacheReadTokens: 500_000,
  cacheWriteTokens: 100_000,
  webSearchRequests: 0,
  promptInputTokens: 200_000,
  speed: 'standard' as const,
}

describe('historical cost settlement v1', () => {
  it('binds a calculated amount to the exact reviewed price record', () => {
    const settled = settleHistoricalCostV1(lunaRecord(), 'reviewed-book', usage)

    expect(settled.costUSD).toBeDefined()
    expect(settled.assignment).toMatchObject({
      version: 1,
      kind: 'token-price',
      priceRecordId: 'openai:gpt-5.6-luna:standard:litellm-f1b781d',
      priceOrigin: 'reviewed-book',
      rateSelection: { kind: 'base' },
    })
  })

  it('binds the selected long-context band into the assignment', () => {
    const settled = settleHistoricalCostV1(lunaRecord(), 'reviewed-book', {
      ...usage,
      promptInputTokens: 300_000,
    })

    expect(settled.assignment).toMatchObject({
      kind: 'token-price',
      rateSelection: {
        kind: 'prompt-input-tokens-above',
        tokens: 272_000,
      },
    })
  })

  it('does not settle a numeric amount when required rate evidence is missing', () => {
    const settled = settleHistoricalCostV1(lunaRecord(), 'reviewed-book', {
      ...usage,
      webSearchRequests: 1,
    })

    expect(settled.costUSD).toBeUndefined()
    expect(settled.assignment).toEqual({
      version: 1,
      kind: 'unavailable',
      reason: 'missing-required-rate',
    })
  })

  it('settles reviewed explicit-zero evidence without confusing it with unavailable', () => {
    const free = {
      ...lunaRecord(),
      priceRecordId: 'openrouter:test-model:free:2026-07-31',
      pricingAuthority: 'openrouter',
      pricingModel: 'test-model',
      route: 'free',
      rates: {
        inputPerToken: 0,
        outputPerToken: 0,
        cacheReadPerToken: 0,
        cacheWritePerToken: 0,
      },
      rateBands: undefined,
      valuation: { kind: 'explicit-zero' as const, reason: 'free-route' as const },
    }
    const settled = settleHistoricalCostV1(free, 'reviewed-book', usage)

    expect(settled.costUSD).toBe(0)
    expect(settled.assignment).toEqual({
      version: 1,
      kind: 'explicit-zero',
      amountMicrosUsd: 0,
      reason: 'free-route',
      priceRecordId: 'openrouter:test-model:free:2026-07-31',
      priceOrigin: 'reviewed-book',
    })
  })
})
