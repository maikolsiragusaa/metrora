import { afterEach, describe, expect, it } from 'vitest'

import { getDailyCacheConfigHash } from '../src/usage-aggregator.js'

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
})
