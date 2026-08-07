import { describe, expect, it } from 'vitest'

import {
  cacheReuseMultiple,
  cacheShare,
  costPerMillionObserved,
  formatReuseMultiple,
  observedTokenTotal,
} from './usageMetrics'

describe('shared usage metrics', () => {
  it('uses one observed-token denominator across Models and Sessions', () => {
    expect(observedTokenTotal({
      inputTokens: 503_000,
      outputTokens: 76_000,
      cacheReadTokens: 24_000_000,
      cacheWriteTokens: 0,
    })).toBe(24_579_000)
  })

  it('expresses cache reuse as cached input per uncached input token', () => {
    expect(cacheReuseMultiple(503_000, 24_000_000)).toBeCloseTo(47.7137, 3)
    expect(formatReuseMultiple(cacheReuseMultiple(503_000, 24_000_000))).toBe('47.7×')
  })

  it('keeps cache share as the secondary percentage representation', () => {
    expect(cacheShare(503_000, 24_000_000)).toBeCloseTo(0.97947, 4)
  })

  it('derives effective API-equivalent value per one million observed tokens', () => {
    expect(costPerMillionObserved(3.54, 24_579_000)).toBeCloseTo(0.1440, 3)
  })

  it('returns unavailable instead of infinity when cache reuse has no uncached input denominator', () => {
    expect(cacheReuseMultiple(0, 20_000)).toBeNull()
    expect(formatReuseMultiple(null)).toBe('—')
  })
})
