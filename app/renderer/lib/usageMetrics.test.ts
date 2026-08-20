import { describe, expect, it } from 'vitest'

import {
  additiveReasoningTokenCount,
  cacheReuseMultiple,
  cacheShare,
  costPerMillionObserved,
  costPerMillionTotal,
  formatReuseMultiple,
  generatedTokenCount,
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

  it('keeps aggregate-output reasoning observed but not additive', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 20,
      additiveReasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningSemantics: 'aggregate-output' as const,
    }
    expect(additiveReasoningTokenCount(usage)).toBe(0)
    expect(generatedTokenCount(usage)).toBe(100)
    expect(totalTokenCount(usage)).toBe(100)
  })

  it('uses explicit additive reasoning for separate rows', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 30,
      additiveReasoningTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningSemantics: 'separate' as const,
    }
    expect(additiveReasoningTokenCount(usage)).toBe(30)
    expect(generatedTokenCount(usage)).toBe(130)
    expect(totalTokenCount(usage)).toBe(130)
  })

  it('keeps the legacy separate fallback when additive reasoning is absent', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningSemantics: 'separate' as const,
    }
    expect(additiveReasoningTokenCount(usage)).toBe(30)
    expect(generatedTokenCount(usage)).toBe(130)
    expect(totalTokenCount(usage)).toBe(130)
  })

  it('uses explicit additive reasoning for mixed rows without hiding observed reasoning', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 50,
      additiveReasoningTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningSemantics: 'mixed' as const,
    }
    expect(additiveReasoningTokenCount(usage)).toBe(30)
    expect(generatedTokenCount(usage)).toBe(230)
    expect(totalTokenCount(usage)).toBe(230)
    expect(costPerMillionTotal(2.3, usage)).toBeCloseTo(10_000, 8)
  })

  it('does not infer additive reasoning for legacy mixed rows', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningSemantics: 'mixed' as const,
    }
    expect(additiveReasoningTokenCount(usage)).toBe(0)
    expect(generatedTokenCount(usage)).toBe(200)
    expect(totalTokenCount(usage)).toBe(200)
  })

  it('keeps unavailable reasoning non-additive', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningSemantics: 'unavailable' as const,
    }
    expect(additiveReasoningTokenCount(usage)).toBe(0)
    expect(generatedTokenCount(usage)).toBeNull()
    expect(totalTokenCount(usage)).toBe(200)
  })

  it('returns unavailable instead of infinity when cache reuse has no uncached input denominator', () => {
    expect(cacheReuseMultiple(0, 20_000)).toBeNull()
    expect(formatReuseMultiple(null)).toBe('—')
  })
})
