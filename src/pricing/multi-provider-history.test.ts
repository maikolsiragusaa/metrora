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
  it('keeps the reviewed authority set explicit and representative current/history records resolvable', () => {
    expect(new Set(catalog.records.map(record => record.pricingAuthority))).toEqual(
      new Set(['openai', 'anthropic', 'deepseek', 'xai', 'kimi', 'minimax', 'mistral', 'zai']),
    )

    expect(new Set(catalog.records.map(record => record.priceRecordId)).size).toBe(catalog.records.length)

    for (const [authority, model] of [
      ['deepseek', 'deepseek-v4-flash'],
      ['deepseek', 'deepseek-v4-pro'],
      ['xai', 'grok-3'],
      ['xai', 'grok-4-0709'],
      ['xai', 'grok-4.5'],
      ['kimi', 'kimi-k2.6'],
      ['kimi', 'kimi-k3'],
      ['minimax', 'MiniMax-M2.7-highspeed'],
      ['mistral', 'mistral-medium-3.5'],
      ['openai', 'gpt-5.3-codex'],
      ['openai', 'gpt-4.1'],
      ['anthropic', 'claude-3-opus'],
      ['anthropic', 'claude-opus-4-1'],
      ['zai', 'glm-5p1'],
    ]) {
      expect(lookup(authority, model).valuation.kind).toBe('priced')
    }
  })

  it('does not backdate DeepSeek V4 first-observed prices or fill unreviewed legacy intervals', () => {
    expect(lookupAt('deepseek', 'deepseek-v4-flash', '2026-08-07T17:12:59Z')).toBeUndefined()
    expect(lookupAt('deepseek', 'deepseek-v4-flash', '2026-08-07T17:13:00Z')).toBeDefined()

    expect(lookupAt('deepseek', 'deepseek-chat', '2025-09-05T15:59:59Z')).toBeDefined()
    expect(lookupAt('deepseek', 'deepseek-chat', '2025-09-05T16:00:00Z')).toBeUndefined()
    expect(lookupAt('deepseek', 'deepseek-chat', observedAt)).toBeUndefined()

    expect(lookupAt('deepseek', 'deepseek-reasoner', '2025-09-05T15:59:59Z')).toBeDefined()
    expect(lookupAt('deepseek', 'deepseek-reasoner', '2025-09-05T16:00:00Z')).toBeUndefined()
    expect(lookupAt('deepseek', 'deepseek-reasoner', observedAt)).toBeUndefined()
  })

  it('keeps the reviewed DeepSeek V4 direct rates explicit', () => {
    const flash = lookup('deepseek', 'deepseek-v4-flash')
    const pro = lookup('deepseek', 'deepseek-v4-pro')

    expect(flash.rates.inputPerToken).toBeCloseTo(0.14 / 1_000_000, 16)
    expect(flash.rates.outputPerToken).toBeCloseTo(0.28 / 1_000_000, 16)
    expect(flash.rates.cacheReadPerToken).toBeCloseTo(0.0028 / 1_000_000, 16)

    expect(pro.rates.inputPerToken).toBeCloseTo(0.435 / 1_000_000, 16)
    expect(pro.rates.outputPerToken).toBeCloseTo(0.87 / 1_000_000, 16)
    expect(pro.rates.cacheReadPerToken).toBeCloseTo(0.003625 / 1_000_000, 16)
  })

  it('switches retired xAI slugs to their official redirect economics at the exact boundary', () => {
    const grok3Before = lookupAt('xai', 'grok-3', '2026-05-15T18:59:59Z')
    const grok3After = lookupAt('xai', 'grok-3', '2026-05-15T19:00:00Z')
    expect(grok3Before?.rates.inputPerToken).toBeCloseTo(3 / 1_000_000, 16)
    expect(grok3After?.rates.inputPerToken).toBeCloseTo(1.25 / 1_000_000, 16)
    expect(grok3After?.rates.outputPerToken).toBeCloseTo(2.5 / 1_000_000, 16)
    expect(grok3After?.supersedes).toBe(grok3Before?.priceRecordId)

    const codeBefore = lookupAt('xai', 'grok-code-fast-1', '2026-05-15T18:59:59Z')
    const codeAfter = lookupAt('xai', 'grok-code-fast-1', '2026-05-15T19:00:00Z')
    expect(codeBefore?.rates.outputPerToken).toBeCloseTo(1.5 / 1_000_000, 16)
    expect(codeAfter?.rates.inputPerToken).toBeCloseTo(1 / 1_000_000, 16)
    expect(codeAfter?.rates.outputPerToken).toBeCloseTo(2 / 1_000_000, 16)
    expect(codeAfter?.supersedes).toBe(codeBefore?.priceRecordId)

    expect(lookupAt('xai', 'grok-4-0709', '2026-05-15T19:00:00Z')?.rates.inputPerToken)
      .toBeCloseTo(1.25 / 1_000_000, 16)
  })

  it('selects Grok 4 0709 long-context pricing at the inclusive 128K boundary before redirect', () => {
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

  it('prices Kimi K2.6 cache hits independently from uncached input', () => {
    const result = calculateHistoricalCostV1(lookup('kimi', 'kimi-k2.6'), {
      ...zeroUsage,
      inputTokens: 1_000_000,
      billableOutputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    })

    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(5.11, 12)
  })

  it('keeps MiniMax M2.7 HighSpeed economics distinct from standard M2.7', () => {
    const standard = lookup('minimax', 'MiniMax-M2.7')
    const highSpeed = lookup('minimax', 'MiniMax-M2.7-highspeed')

    expect(standard.rates.inputPerToken).toBeCloseTo(0.30 / 1_000_000, 16)
    expect(standard.rates.outputPerToken).toBeCloseTo(1.20 / 1_000_000, 16)
    expect(highSpeed.rates.inputPerToken).toBeCloseTo(0.60 / 1_000_000, 16)
    expect(highSpeed.rates.outputPerToken).toBeCloseTo(2.40 / 1_000_000, 16)
    expect(highSpeed.rates.cacheReadPerToken).toBeCloseTo(0.06 / 1_000_000, 16)
    expect(highSpeed.rates.cacheWritePerToken).toBeCloseTo(0.375 / 1_000_000, 16)
  })

  it('prices current Mistral cached input at ten percent of normal input', () => {
    const record = lookup('mistral', 'mistral-medium-3.5')
    expect(record.rates.inputPerToken).toBeCloseTo(1.50 / 1_000_000, 16)
    expect(record.rates.cacheReadPerToken).toBeCloseTo(0.15 / 1_000_000, 16)
  })

  it('keeps GPT-5.3 Codex cached input separate from normal input', () => {
    const result = calculateHistoricalCostV1(lookup('openai', 'gpt-5.3-codex'), {
      ...zeroUsage,
      cacheReadTokens: 1_000_000,
    })

    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(0.175, 12)
  })

  it('accounts for Anthropic one-hour prompt-cache writes only where V1 is exact', () => {
    const record = lookupAt('anthropic', 'claude-opus-4', '2025-06-01T00:00:00Z')
    if (!record) throw new Error('missing historical claude-opus-4')

    const result = calculateHistoricalCostV1(record, {
      ...zeroUsage,
      cacheWriteTokens: 1_000_000,
      oneHourCacheWriteTokens: 1_000_000,
    })

    expect(result.kind).toBe('calculated')
    if (result.kind !== 'calculated') throw new Error(result.reason)
    expect(result.costUSD).toBeCloseTo(30, 12)

    expect(catalog.records.some(item => item.pricingModel === 'claude-3-haiku')).toBe(false)
  })

  it('keeps current long-context and fast-mode boundaries reviewed independently', () => {
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
