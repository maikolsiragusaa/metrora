import { afterEach, describe, expect, it } from 'vitest'

import {
  getModelCosts,
  setModelAliases,
} from '../src/models.js'
import { assignRuntimeCostV1 } from '../src/pricing/runtime-cost-assignment.js'

const originalMode = process.env['METRORA_HISTORICAL_PRICING']

afterEach(() => {
  setModelAliases({})
  if (originalMode === undefined) delete process.env['METRORA_HISTORICAL_PRICING']
  else process.env['METRORA_HISTORICAL_PRICING'] = originalMode
})

function assignment(timestamp: string, overrides: Record<string, unknown> = {}) {
  return assignRuntimeCostV1({
    provider: 'codex',
    model: 'openai/gpt-5.6-luna',
    modelProvider: 'openai',
    timestamp,
    speed: 'standard',
    usage: {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheCreationInputTokens: 100_000,
      cacheReadInputTokens: 2_000_000,
      reasoningTokens: 25_000,
      webSearchRequests: 0,
    },
    legacyCostUSD: 1.6,
    ...overrides,
  })
}

describe('pricing authority reconciliation fixtures', () => {
  it('changes only the price authority at an effective boundary for identical usage', () => {
    process.env['METRORA_HISTORICAL_PRICING'] = 'historical'
    const before = assignment('2026-07-30T20:08:00Z')
    const atBoundary = assignment('2026-07-30T20:08:01Z')

    expect(before.storedAssignment.kind).toBe('token-price')
    expect(atBoundary.storedAssignment.kind).toBe('token-price')
    expect(before.storedAssignment.priceRecordId).toContain('litellm-a874de6')
    expect(atBoundary.storedAssignment.priceRecordId).toContain('litellm-f1b781d')
    expect(before.storedCostUSD).toBeGreaterThan(atBoundary.storedCostUSD ?? 0)
    expect(before.storedCostUSD).toBeCloseTo((atBoundary.storedCostUSD ?? 0) * 5, 12)
    expect(atBoundary.storedLegacyCostUSD).toBeCloseTo(1.6, 12)
  })

  it('keeps a current fallback-only model out of historical authority', () => {
    const currentFallback = getModelCosts('qwen3.7-max')
    expect(currentFallback).not.toBeNull()
    expect(currentFallback!.inputCostPerToken).toBeGreaterThan(0)

    const historical = assignment('2026-08-07T12:00:00Z', {
      model: 'qwen3.7-max',
      modelProvider: 'openrouter',
      legacyCostUSD: 0.25,
    })
    expect(historical.storedCostUSD).toBe(0.25)
    expect(historical.storedAssignment.kind).toBe('legacy-frozen')
  })

  it('keeps aliases internal and does not collapse provider-specific authority', () => {
    setModelAliases({ 'local-luna-alias': 'gpt-5.6-luna' })
    const aliased = getModelCosts('local-luna-alias')
    const direct = getModelCosts('gpt-5.6-luna')

    expect(aliased).toEqual(direct)
    const routed = assignment('2026-07-31T00:00:00Z')
    expect(routed.storedAssignment.kind).toBe('token-price')
    expect(routed.storedAssignment.priceRecordId).toContain('openai:')
  })

  it('does not treat a batch suffix as historical evidence for a separate tier', () => {
    const batch = getModelCosts('gpt-4.1:batch')
    // No date-effective batch record is inferred from a model suffix.
    expect(batch).toBeNull()
  })
})
