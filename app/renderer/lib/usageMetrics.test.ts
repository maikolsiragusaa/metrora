import { describe, expect, it } from 'vitest'

import {
  cacheReuseMultiple,
  cacheShare,
  costPerMillionObserved,
  costPerMillionTotal,
  formatReuseMultiple,
  observedTokenTotal,
  totalTokenCount,
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

  it('adds separately reported reasoning exactly once and never guesses unavailable reasoning', () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadTokens: 300,
      cacheWriteTokens: 10,
      reasoningSemantics: 'separate' as const,
    }
    expect(totalTokenCount(usage)).toBe(660)
    expect(costPerMillionTotal(6.6, usage)).toBe(10_000)
    expect(totalTokenCount({ ...usage, reasoningSemantics: 'unavailable' })).toBe(610)
    expect(totalTokenCount({ ...usage, reasoningSemantics: 'aggregate-output' })).toBe(610)
  })

  it('keeps the observed mixed subtotal in Total and Cost / 1M without estimating the missing part', () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadTokens: 300,
      cacheWriteTokens: 10,
      reasoningSemantics: 'mixed' as const,
    }
    expect(totalTokenCount(usage)).toBe(660)
    expect(costPerMillionTotal(6.6, usage)).toBe(10_000)
    expect(totalTokenCount({ ...usage, reasoningTokens: undefined })).toBe(610)
  })

  it('returns unavailable instead of infinity when cache reuse has no uncached input denominator', () => {
    expect(cacheReuseMultiple(0, 20_000)).toBeNull()
    expect(formatReuseMultiple(null)).toBe('—')
  })
})
