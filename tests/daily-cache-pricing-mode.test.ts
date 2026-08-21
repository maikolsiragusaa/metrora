import { afterEach, describe, expect, it } from 'vitest'

import catalogData from '../src/data/pricing-history/catalog.v1.json'
import { getDailyCacheConfigHash } from '../src/usage-aggregator.js'
import { DAILY_CACHE_VERSION } from '../src/daily-cache.js'
import { parseHistoricalPriceBookV1 } from '../src/pricing/history.js'
import {
  reviewedHistoricalPricingAuthorityFingerprintV1,
  runtimeHistoricalPricingCacheKeyV1,
} from '../src/pricing/runtime-cost-assignment.js'

const originalMode = process.env['METRORA_HISTORICAL_PRICING']

afterEach(() => {
  if (originalMode === undefined) delete process.env['METRORA_HISTORICAL_PRICING']
  else process.env['METRORA_HISTORICAL_PRICING'] = originalMode
})

describe('daily cache historical-pricing boundary', () => {
  it('uses distinct cache keys for historical, comparison, and legacy runtime views', () => {
    process.env['METRORA_HISTORICAL_PRICING'] = 'historical'
    const historical = getDailyCacheConfigHash()
    process.env['METRORA_HISTORICAL_PRICING'] = 'compare'
    const compare = getDailyCacheConfigHash()
    process.env['METRORA_HISTORICAL_PRICING'] = 'legacy'
    const legacy = getDailyCacheConfigHash()

    expect(new Set([historical, compare, legacy]).size).toBe(3)
    expect(historical).toContain('historicalPricing=historical')
    expect(compare).toContain('historicalPricing=compare')
    expect(legacy).toContain('historicalPricing=legacy')
  })

  it('normalizes compatibility aliases before they reach the cache key', () => {
    process.env['METRORA_HISTORICAL_PRICING'] = 'shadow'
    const shadow = getDailyCacheConfigHash()
    process.env['METRORA_HISTORICAL_PRICING'] = 'compare'
    expect(getDailyCacheConfigHash()).toBe(shadow)

    process.env['METRORA_HISTORICAL_PRICING'] = 'off'
    const off = getDailyCacheConfigHash()
    process.env['METRORA_HISTORICAL_PRICING'] = 'legacy'
    expect(getDailyCacheConfigHash()).toBe(off)
  })

  it('binds daily accounting to a deterministic semantic reviewed-price-book authority', () => {
    const book = parseHistoricalPriceBookV1(catalogData)
    const fingerprint = reviewedHistoricalPricingAuthorityFingerprintV1(book)
    const hash = getDailyCacheConfigHash()

    expect(hash).toContain(`reviewedBook=${fingerprint}`)
    expect(runtimeHistoricalPricingCacheKeyV1()).toContain(`reviewedBook=${fingerprint}`)
    expect(DAILY_CACHE_VERSION).toBe(19)

    const changed = structuredClone(book)
    changed.records[0]!.rates.inputPerToken += 1e-12
    expect(reviewedHistoricalPricingAuthorityFingerprintV1(changed)).not.toBe(fingerprint)
  })
})
