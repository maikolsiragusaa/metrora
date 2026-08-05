import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  PRICING_LOOKUP_VERSION,
  calculateCost,
  explicitZeroReasonForModel,
  getHistoricalPricingModelKey,
  getModelCosts,
  getPriceOverridesConfigHash,
  getShortModelName,
  loadPricing,
  setPriceOverrides,
} from '../src/models.js'
import { getDailyCacheConfigHash } from '../src/usage-aggregator.js'

beforeAll(async () => {
  await loadPricing()
})

afterEach(() => {
  setPriceOverrides({})
})

describe('Kimi numeric context-tag normalization', () => {
  it('prices and displays tagged K3 ids through the canonical alias', () => {
    const canonical = getModelCosts('kimi-k3')
    expect(canonical).not.toBeNull()
    expect(getModelCosts('kimi/k3[1m]')).toEqual(canonical)
    expect(getModelCosts('k3[128k]')).toEqual(canonical)
    expect(calculateCost('kimi/k3[1m]', 1_000_000, 100_000, 0, 0, 0)).toBeGreaterThan(0)
    expect(getShortModelName('kimi/k3[1m]')).toBe('Kimi K3')
    expect(getHistoricalPricingModelKey('kimi/k3[1m]')).toBe('kimi-k3')
  })

  it('keeps an exact zero-rate override on the raw tagged id authoritative', () => {
    setPriceOverrides({
      'kimi/k3[1m]': { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    })

    expect(calculateCost('kimi/k3[1m]', 1_000_000, 100_000, 0, 0, 0)).toBe(0)
    expect(explicitZeroReasonForModel('kimi/k3[1m]')).toBe('manual-reviewed')
  })

  it('does not strip arbitrary descriptive bracket suffixes', () => {
    expect(getShortModelName('custom-model[preview]')).toBe('custom-model[preview]')
    expect(getModelCosts('custom-model[preview]')).toBeNull()
  })

  it('binds the daily accounting hash to the pricing lookup authority', () => {
    expect(getPriceOverridesConfigHash()).toContain(`lookup:${PRICING_LOOKUP_VERSION}`)
    expect(getDailyCacheConfigHash()).toContain(`lookup:${PRICING_LOOKUP_VERSION}`)
  })
})
