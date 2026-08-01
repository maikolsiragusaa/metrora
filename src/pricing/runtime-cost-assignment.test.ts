import { afterEach, describe, expect, it } from 'vitest'

import { assignRuntimeCostV1 } from './runtime-cost-assignment.js'

const originalMode = process.env['METRORA_HISTORICAL_PRICING']

afterEach(() => {
  if (originalMode === undefined) delete process.env['METRORA_HISTORICAL_PRICING']
  else process.env['METRORA_HISTORICAL_PRICING'] = originalMode
})

function input(timestamp: string, overrides: Record<string, unknown> = {}) {
  return {
    provider: 'codex',
    model: 'openai/gpt-5.6-luna',
    timestamp,
    speed: 'standard' as const,
    usage: {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
    },
    legacyCostUSD: 1.6,
    ...overrides,
  }
}

describe('runtime historical cost assignment', () => {
  it('settles equal token usage on different sides of the Luna boundary to different immutable records', () => {
    process.env['METRORA_HISTORICAL_PRICING'] = 'historical'
    const before = assignRuntimeCostV1(input('2026-07-30T20:08:00Z'))
    const after = assignRuntimeCostV1(input('2026-07-30T20:08:01Z'))

    expect(before.storedAssignment.kind).toBe('token-price')
    expect(after.storedAssignment.kind).toBe('token-price')
    if (before.storedAssignment.kind !== 'token-price' || after.storedAssignment.kind !== 'token-price') return
    expect(before.storedAssignment.priceRecordId).toContain('litellm-a874de6')
    expect(after.storedAssignment.priceRecordId).toContain('litellm-f1b781d')
    expect(before.storedCostUSD).toBeCloseTo(1.6, 12)
    expect(after.storedCostUSD).toBeCloseTo(0.32, 12)
    expect(after.storedLegacyCostUSD).toBeCloseTo(1.6, 12)
  })

  it('uses internal pricing aliases without changing the observed model or inventing modelProvider', () => {
    const observedModel = 'openai/gpt-5.6-luna'
    const result = assignRuntimeCostV1(input('2026-07-31T00:00:00Z', { model: observedModel }))
    expect(result.storedAssignment.kind).toBe('token-price')
    expect((input('2026-07-31T00:00:00Z', { model: observedModel }) as { model: string }).model).toBe(observedModel)
  })

  it('keeps provider-metered billing exports authoritative', () => {
    const result = assignRuntimeCostV1(input('2026-07-31T00:00:00Z', {
      provider: 'vercel-gateway',
      legacyCostUSD: 9.876543,
    }))
    expect(result.storedCostUSD).toBe(9.876543)
    expect(result.storedAssignment).toMatchObject({ kind: 'metered', source: 'billing-export' })
  })

  it('distinguishes unresolved zero from intentional zero', () => {
    const unresolved = assignRuntimeCostV1(input('2026-07-31T00:00:00Z', {
      model: 'unknown-frontier-model',
      legacyCostUSD: 0,
    }))
    expect(unresolved.storedCostUSD).toBeUndefined()
    expect(unresolved.storedAssignment.kind).toBe('unavailable')

    const local = assignRuntimeCostV1(input('2026-07-31T00:00:00Z', {
      model: 'qwen3.6:35b-a3b-bf16',
      legacyCostUSD: 0,
    }))
    expect(local.storedCostUSD).toBe(0)
    expect(local.storedAssignment).toMatchObject({ kind: 'explicit-zero', reason: 'local-inference' })
  })

  it('supports compare and rollback views without mutating the stored historical settlement', () => {
    process.env['METRORA_HISTORICAL_PRICING'] = 'compare'
    const compared = assignRuntimeCostV1(input('2026-07-31T00:00:00Z'))
    expect(compared.storedCostUSD).toBeCloseTo(0.32, 12)
    expect(compared.runtimeCostUSD).toBeCloseTo(1.6, 12)
    expect(compared.storedAssignment.kind).toBe('token-price')
    expect(compared.runtimeAssignment.kind).toBe('legacy-frozen')

    process.env['METRORA_HISTORICAL_PRICING'] = 'legacy'
    const rolledBack = assignRuntimeCostV1({
      ...input('2026-07-31T00:00:00Z'),
      existingAssignment: compared.storedAssignment,
      existingStoredCostUSD: compared.storedCostUSD,
      existingLegacyCostUSD: compared.storedLegacyCostUSD,
    })
    expect(rolledBack.storedCostUSD).toBeCloseTo(0.32, 12)
    expect(rolledBack.runtimeCostUSD).toBeCloseTo(1.6, 12)
    expect(rolledBack.runtimeAssignment.kind).toBe('legacy-frozen')
  })

  it('never reprices an existing settled assignment from a later current-price value', () => {
    const first = assignRuntimeCostV1(input('2026-07-31T00:00:00Z'))
    const reloaded = assignRuntimeCostV1({
      ...input('2026-07-31T00:00:00Z'),
      legacyCostUSD: 999,
      existingAssignment: first.storedAssignment,
      existingStoredCostUSD: first.storedCostUSD,
      existingLegacyCostUSD: first.storedLegacyCostUSD,
    })
    expect(reloaded.storedAssignment).toEqual(first.storedAssignment)
    expect(reloaded.storedCostUSD).toBe(first.storedCostUSD)
    expect(reloaded.runtimeCostUSD).toBe(first.runtimeCostUSD)
  })
})
