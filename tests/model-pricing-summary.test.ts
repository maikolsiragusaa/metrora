import { describe, expect, it } from 'vitest'

import {
  createModelPricingCounts,
  observeModelPricing,
  summarizeModelPricing,
} from '../src/model-pricing-summary.js'

describe('model pricing summary', () => {
  it('distinguishes paid, explicitly free, unavailable, partial, and unknown evidence', () => {
    const paid = createModelPricingCounts()
    observeModelPricing(paid, {
      version: 1,
      kind: 'metered',
      amountMicrosUsd: 1_000_000,
      source: 'provider',
    })
    expect(summarizeModelPricing(paid)).toMatchObject({ state: 'priced', coveredCalls: 1 })

    const free = createModelPricingCounts()
    observeModelPricing(free, {
      version: 1,
      kind: 'explicit-zero',
      amountMicrosUsd: 0,
      reason: 'free-model',
    })
    expect(summarizeModelPricing(free)).toMatchObject({ state: 'explicit-zero', coveredCalls: 1 })

    const unavailable = createModelPricingCounts()
    observeModelPricing(unavailable, {
      version: 1,
      kind: 'unavailable',
      reason: 'no-price-record',
    })
    expect(summarizeModelPricing(unavailable)).toMatchObject({
      state: 'unavailable',
      coveredCalls: 0,
      missingPriceRecordCalls: 1,
    })

    const partial = createModelPricingCounts()
    observeModelPricing(partial, {
      version: 1,
      kind: 'token-price',
      amountMicrosUsd: 750_000,
      priceRecordId: 'test-price',
      priceOrigin: 'reviewed-book',
      rateSelection: { kind: 'base' },
    })
    observeModelPricing(partial, {
      version: 1,
      kind: 'unavailable',
      reason: 'missing-required-rate',
    })
    expect(summarizeModelPricing(partial)).toMatchObject({
      state: 'partial',
      totalCalls: 2,
      coveredCalls: 1,
      unavailableCalls: 1,
    })

    const unknown = createModelPricingCounts()
    observeModelPricing(unknown, undefined)
    expect(summarizeModelPricing(unknown)).toMatchObject({ state: 'unknown', unknownCalls: 1 })
  })
})
