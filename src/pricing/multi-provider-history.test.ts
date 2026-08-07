import { describe, expect, it } from 'vitest'

import catalogData from '../data/pricing-history/catalog.v1.json'
import { calculateHistoricalCostV1 } from './historical-cost.js'
import {
  parseHistoricalPriceBookV1,
  resolveHistoricalPriceRecordV1,
} from './history.js'

const catalog = parseHistoricalPriceBookV1(catalogData)
const observedAt = '2026-08-07T17:39:00Z'

function lookup(authority: string, model: string) {
  const record = resolveHistoricalPriceRecordV1(catalog, {
    pricingAuthority: authority,
    pricingModel: model,
    route: 'standard',
    timestamp: observedAt,
  })
  if (!record) throw new Error(`missing reviewed ${authority}/${model} record`)
  return record
}

const zeroUsage = {
  inputTokens: 0,
  billableOutputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearchRequests: 0,
  promptInputTokens: 0,
  oneHourCacheWriteTokens: 0,
  speed: 'standard' as const,
}

describe('reviewed multi-provider historical pricing tranche', () => {
  it('includes the intended reviewed authorities and compatibility pricing keys', () => {
    expect(catalog.records).toHaveLength(35)
    expect(new Set(catalog.records.map(record => record.pricingAuthority))).toEqual(
      new Set(['openai', 'anthropic', 'deepseek', 'xai', 'kimi', 'minimax', 'zai']),
    )

    for (const [authority, model] of [
      ['deepseek', 'deepseek-v4-flash'],
      ['deepseek', 'deepseek-v4-pro'],
      ['deepseek', 'deepseek-chat'],
      ['deepseek', 'deepseek-reasoner'],
      ['xai', 'grok-4.5'],
      ['xai', 'grok-build-0.1'],
      ['xai', 'grok-4.3'],
      ['kimi', 'kimi-k3'],
      ['kimi', 'kimi-k2.6'],
      ['kimi', 'kimi-k2p6'],
      ['minimax', 'MiniMax-M2.7'],
      ['minimax', 'MiniMax-M2.7-highspeed'],
      ['zai', 'glm-5p1'],
      ['openai', 'gpt-5.5'],
      ['openai', 'gpt-5.4'],
      ['openai', 'gpt-5.4-mini'],
      ['openai', 'gpt-5.4-nano'],
      ['openai', 'gpt-5.3-codex'],
      ['openai', 'gpt-5.2'],
      ['anthropic', 'claude-fable-5'],
      ['anthropic', 'claude-opus-5'],
      ['anthropic', 'claude-sonnet-5'],
      ['anthropic', 'claude-haiku-4-5'],
      ['anthropic', 'claude-opus-4-8'],
      ['anthropic', 'claude-opus-4-7'],
      ['anthropic', 'claude-opus-4-6'],
      ['anthropic', 'claude-opus-4-5'],
      ['anthropic', 'claude-sonnet-4-6'],
      ['anthropic', 'claude-sonnet-4-5'],
    ]) {
      expect(lookup(authority, model).valuation.kind).toBe('priced')
    }
  })

  it('prices DeepSeek V4 Flash cache hits independently from cache misses', () => {
    const result = calculateHistoricalCostV1(lookup('deepseek', 'deepseek-v4-flash'), {
      ...zeroUsage,
      inputTokens: 1_000_000,
      billableOutputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(0.4228, 12)
  })

  it('selects xAI long-context pricing at the published inclusive 200K boundary', () => {
    const record = lookup('xai', 'grok-4.5')
    const short = calculateHistoricalCostV1(record, {
      ...zeroUsage,
      inputTokens: 1_000_000,
      promptInputTokens: 199_999,
    })
    const long = calculateHistoricalCostV1(record, {
      ...zeroUsage,
      inputTokens: 1_000_000,
      promptInputTokens: 200_000,
    })
    expect(short.kind).toBe('calculated')
    expect(long.kind).toBe('calculated')
    if (short.kind !== 'calculated' || long.kind !== 'calculated') {
      throw new Error('expected xAI short and long calculations')
    }
    expect(short.costUSD).toBeCloseTo(2, 12)
    expect(long.costUSD).toBeCloseTo(4, 12)
    expect(long.rateSelection).toEqual({
      kind: 'prompt-input-tokens-above',
      tokens: 199_999,
    })
  })

  it('keeps Kimi web-search billing additive to token pricing', () => {
    const result = calculateHistoricalCostV1(lookup('kimi', 'kimi-k3'), {
      ...zeroUsage,
      webSearchRequests: 1,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(0.004, 12)
  })

  it('prices MiniMax M2.7 cache reads and writes from published API rates', () => {
    const result = calculateHistoricalCostV1(lookup('minimax', 'MiniMax-M2.7'), {
      ...zeroUsage,
      inputTokens: 1_000_000,
      billableOutputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(1.935, 12)
  })

  it('prices the GLM-5.2 compatibility key from current Z.ai API rates', () => {
    const result = calculateHistoricalCostV1(lookup('zai', 'glm-5p1'), {
      ...zeroUsage,
      inputTokens: 1_000_000,
      billableOutputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      webSearchRequests: 1,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(6.07, 12)
  })

  it('selects GPT-5.5 long-context pricing only above 272K prompt input tokens', () => {
    const record = lookup('openai', 'gpt-5.5')
    const atThreshold = calculateHistoricalCostV1(record, {
      ...zeroUsage,
      inputTokens: 1_000_000,
      promptInputTokens: 272_000,
    })
    const aboveThreshold = calculateHistoricalCostV1(record, {
      ...zeroUsage,
      inputTokens: 1_000_000,
      promptInputTokens: 272_001,
    })
    expect(atThreshold.kind).toBe('calculated')
    expect(aboveThreshold.kind).toBe('calculated')
    if (atThreshold.kind !== 'calculated' || aboveThreshold.kind !== 'calculated') {
      throw new Error('expected GPT-5.5 short and long calculations')
    }
    expect(atThreshold.costUSD).toBeCloseTo(5, 12)
    expect(aboveThreshold.costUSD).toBeCloseTo(10, 12)
    expect(aboveThreshold.rateSelection).toEqual({
      kind: 'prompt-input-tokens-above',
      tokens: 272_000,
    })
  })

  it('accounts for Anthropic one-hour prompt-cache writes from the five-minute rate', () => {
    const result = calculateHistoricalCostV1(lookup('anthropic', 'claude-opus-5'), {
      ...zeroUsage,
      cacheWriteTokens: 1_000_000,
      oneHourCacheWriteTokens: 1_000_000,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(10, 12)
  })

  it('keeps Anthropic web-search billing explicit instead of hiding it in token rates', () => {
    const result = calculateHistoricalCostV1(lookup('anthropic', 'claude-haiku-4-5'), {
      ...zeroUsage,
      webSearchRequests: 1,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(0.01, 12)
  })

  it('applies current 2x fast-mode pricing to Opus 5 and Opus 4.8 only where reviewed', () => {
    for (const model of ['claude-opus-5', 'claude-opus-4-8']) {
      const result = calculateHistoricalCostV1(lookup('anthropic', model), {
        ...zeroUsage,
        inputTokens: 1_000_000,
        speed: 'fast',
      })
      expect(result.kind).toBe('calculated')
      if (result.kind !== 'calculated') throw new Error(result.reason)
      expect(result.costUSD).toBeCloseTo(10, 12)
    }

    const unavailable = calculateHistoricalCostV1(lookup('anthropic', 'claude-opus-4-7'), {
      ...zeroUsage,
      inputTokens: 1_000_000,
      speed: 'fast',
    })
    expect(unavailable).toMatchObject({
      kind: 'unavailable',
      reason: 'missing-fast-rate',
    })
  })
})
