import { describe, expect, it } from 'vitest'

import catalogData from '../data/pricing-history/catalog.v1.json'
import { calculateHistoricalCostV1 } from './historical-cost.js'
import {
  parseHistoricalPriceBookV1,
  resolveHistoricalPriceRecordV1,
} from './history.js'

const catalog = parseHistoricalPriceBookV1(catalogData)
const observedAt = '2026-08-07T19:30:00Z'

function lookupAt(authority: string, model: string, timestamp = observedAt) {
  return resolveHistoricalPriceRecordV1(catalog, {
    pricingAuthority: authority,
    pricingModel: model,
    route: 'standard',
    timestamp,
  })
}

function lookup(authority: string, model: string) {
  const record = lookupAt(authority, model)
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
  it('contains the expanded reviewed book without widening the authority set accidentally', () => {
    expect(catalog.records).toHaveLength(122)
    expect(new Set(catalog.records.map(record => record.pricingAuthority))).toEqual(
      new Set(['openai', 'anthropic', 'deepseek', 'xai', 'kimi', 'minimax', 'mistral', 'zai']),
    )

    for (const [authority, model] of [
      ['deepseek', 'deepseek-v4-flash'],
      ['deepseek', 'deepseek-v4-pro'],
      ['xai', 'grok-3'],
      ['xai', 'grok-4-0709'],
      ['xai', 'grok-4.20-0309-reasoning'],
      ['kimi', 'kimi-k2.7-code'],
      ['minimax', 'MiniMax-M2.1-highspeed'],
      ['minimax', 'MiniMax-M2.5'],
      ['mistral', 'open-mixtral-8x7b'],
      ['mistral', 'devstral-medium-latest'],
      ['openai', 'gpt-5.2-codex'],
      ['openai', 'o3-deep-research'],
      ['anthropic', 'claude-opus-3'],
      ['anthropic', 'claude-sonnet-3-7'],
      ['anthropic', 'claude-opus-4-1'],
      ['zai', 'glm-5p1'],
    ]) {
      expect(lookup(authority, model).valuation.kind).toBe('priced')
    }
  })

  it('preserves the DeepSeek V4 Flash cache-price cut as two historical intervals', () => {
    const launch = lookupAt('deepseek', 'deepseek-v4-flash', '2026-04-26T12:00:00Z')
    const reduced = lookupAt('deepseek', 'deepseek-v4-flash', '2026-04-28T12:00:00Z')
    expect(launch?.rates.cacheReadPerToken).toBeCloseTo(0.028 / 1_000_000, 16)
    expect(reduced?.rates.cacheReadPerToken).toBeCloseTo(0.0028 / 1_000_000, 16)
    expect(reduced?.supersedes).toBe(launch?.priceRecordId)
  })

  it('retires DeepSeek legacy compatibility slugs at the published UTC boundary', () => {
    expect(lookupAt('deepseek', 'deepseek-chat', '2026-07-24T15:59:59Z')).toBeDefined()
    expect(lookupAt('deepseek', 'deepseek-chat', '2026-07-24T16:00:00Z')).toBeUndefined()
    expect(lookupAt('deepseek', 'deepseek-reasoner', '2026-07-24T16:00:00Z')).toBeUndefined()
    expect(lookupAt('deepseek', 'deepseek-v4-flash', '2026-07-24T16:00:00Z')).toBeDefined()
  })

  it('keeps DeepSeek V3/V3.1/V3.2 economics date-effective', () => {
    expect(lookupAt('deepseek', 'deepseek-chat', '2025-06-01T00:00:00Z')?.rates.outputPerToken)
      .toBeCloseTo(1.10 / 1_000_000, 16)
    expect(lookupAt('deepseek', 'deepseek-chat', '2025-09-06T00:00:00Z')?.rates.outputPerToken)
      .toBeCloseTo(1.68 / 1_000_000, 16)
    expect(lookupAt('deepseek', 'deepseek-chat', '2025-10-01T00:00:00Z')?.rates.outputPerToken)
      .toBeCloseTo(0.42 / 1_000_000, 16)
  })

  it('keeps xAI retirement redirects on the exact May 15 boundary', () => {
    expect(lookupAt('xai', 'grok-3', '2026-05-15T18:59:59Z')?.rates.inputPerToken)
      .toBeCloseTo(3 / 1_000_000, 16)
    expect(lookupAt('xai', 'grok-3', '2026-05-15T19:00:00Z')?.rates.inputPerToken)
      .toBeCloseTo(1.25 / 1_000_000, 16)

    expect(lookupAt('xai', 'grok-code-fast-1', '2026-05-15T18:59:59Z')?.rates.outputPerToken)
      .toBeCloseTo(1.5 / 1_000_000, 16)
    expect(lookupAt('xai', 'grok-code-fast-1', '2026-05-15T19:00:00Z')?.rates.outputPerToken)
      .toBeCloseTo(2 / 1_000_000, 16)
  })

  it('selects Grok 4 0709 long-context pricing at the inclusive 128K boundary', () => {
    const record = lookupAt('xai', 'grok-4-0709', '2026-01-01T00:00:00Z')
    if (!record) throw new Error('missing historical grok-4-0709')
    const short = calculateHistoricalCostV1(record, {
      ...zeroUsage,
      inputTokens: 1_000_000,
      promptInputTokens: 127_999,
    })
    const long = calculateHistoricalCostV1(record, {
      ...zeroUsage,
      inputTokens: 1_000_000,
      promptInputTokens: 128_000,
    })
    expect(short.kind).toBe('calculated')
    expect(long.kind).toBe('calculated')
    if (short.kind !== 'calculated' || long.kind !== 'calculated') throw new Error('expected Grok calculations')
    expect(short.costUSD).toBeCloseTo(3, 12)
    expect(long.costUSD).toBeCloseTo(6, 12)
    expect(long.rateSelection).toEqual({ kind: 'prompt-input-tokens-above', tokens: 127_999 })
  })

  it('prices Kimi K2.7 Code cache hits independently from uncached input', () => {
    const result = calculateHistoricalCostV1(lookup('kimi', 'kimi-k2.7-code'), {
      ...zeroUsage,
      inputTokens: 1_000_000,
      billableOutputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(5.14, 12)
  })

  it('keeps MiniMax PayGo HighSpeed input distinct from Anthropic-compatible route examples', () => {
    const record = lookup('minimax', 'MiniMax-M2.1-highspeed')
    expect(record.rates.inputPerToken).toBeCloseTo(0.60 / 1_000_000, 16)
    expect(record.rates.outputPerToken).toBeCloseTo(2.40 / 1_000_000, 16)
    expect(record.rates.cacheReadPerToken).toBeCloseTo(0.03 / 1_000_000, 16)
    expect(record.rates.cacheWritePerToken).toBeCloseTo(0.375 / 1_000_000, 16)
  })

  it('prices current Mistral cached input at ten percent of normal input', () => {
    const record = lookup('mistral', 'open-mixtral-8x7b')
    expect(record.rates.inputPerToken).toBeCloseTo(0.70 / 1_000_000, 16)
    expect(record.rates.cacheReadPerToken).toBeCloseTo(0.07 / 1_000_000, 16)
  })

  it('keeps OpenAI deep-research web-search charges explicit', () => {
    const result = calculateHistoricalCostV1(lookup('openai', 'o3-deep-research'), {
      ...zeroUsage,
      webSearchRequests: 1,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(0.01, 12)
  })

  it('keeps GPT-5.2 Codex cached input separate from normal input', () => {
    const result = calculateHistoricalCostV1(lookup('openai', 'gpt-5.2-codex'), {
      ...zeroUsage,
      cacheReadTokens: 1_000_000,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(0.175, 12)
  })

  it('accounts for Anthropic one-hour prompt-cache writes only where V1 is exact', () => {
    const result = calculateHistoricalCostV1(lookup('anthropic', 'claude-opus-4'), {
      ...zeroUsage,
      cacheWriteTokens: 1_000_000,
      oneHourCacheWriteTokens: 1_000_000,
    })
    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(30, 12)

    expect(catalog.records.some(record => record.pricingModel === 'claude-3-haiku')).toBe(false)
  })

  it('keeps current long-context and fast-mode boundaries already reviewed', () => {
    const xai = lookup('xai', 'grok-4.5')
    const xaiLong = calculateHistoricalCostV1(xai, {
      ...zeroUsage,
      inputTokens: 1_000_000,
      promptInputTokens: 200_000,
    })
    expect(xaiLong.kind).toBe('calculated')
    if (xaiLong.kind !== 'calculated') throw new Error(xaiLong.reason)
    expect(xaiLong.costUSD).toBeCloseTo(4, 12)

    const fast = calculateHistoricalCostV1(lookup('anthropic', 'claude-opus-5'), {
      ...zeroUsage,
      inputTokens: 1_000_000,
      speed: 'fast',
    })
    expect(fast.kind).toBe('calculated')
    if (fast.kind !== 'calculated') throw new Error(fast.reason)
    expect(fast.costUSD).toBeCloseTo(10, 12)
  })
})
