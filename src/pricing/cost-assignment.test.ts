import { describe, expect, it } from 'vitest'

import {
  CostAssignmentV1Schema,
  assertCostAssignmentMatchesUsdV1,
  costAssignmentMatchesUsdV1,
  costUsdToMicrosV1,
  settledCostMicrosV1,
  settledCostUsdV1,
} from './cost-assignment.js'

describe('cost assignment v1', () => {
  it('stores metered cost as safe integer micro-USD', () => {
    const assignment = CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'metered',
      amountMicrosUsd: 1_234_568,
      source: 'provider',
    })

    expect(settledCostMicrosV1(assignment)).toBe(1_234_568)
    expect(settledCostUsdV1(assignment)).toBe(1.234568)
    expect(costAssignmentMatchesUsdV1(assignment, 1.2345676)).toBe(true)
  })

  it('binds token pricing to one historical record and rate band', () => {
    const assignment = CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'token-price',
      amountMicrosUsd: 420_000,
      priceRecordId: 'openai:gpt-5.6-luna:standard:litellm-f1b781d',
      priceOrigin: 'reviewed-book',
      rateSelection: {
        kind: 'prompt-input-tokens-above',
        tokens: 272_000,
      },
    })

    expect(assertCostAssignmentMatchesUsdV1(assignment, 0.42)).toEqual(assignment)
  })

  it('keeps explicit zero distinct from unavailable pricing', () => {
    const free = CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'explicit-zero',
      amountMicrosUsd: 0,
      reason: 'free-route',
      priceRecordId: 'openrouter:model:free:2026-07-31',
      priceOrigin: 'reviewed-book',
    })
    const unavailable = CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'unavailable',
      reason: 'no-price-record',
    })

    expect(settledCostMicrosV1(free)).toBe(0)
    expect(settledCostMicrosV1(unavailable)).toBeUndefined()
    expect(costAssignmentMatchesUsdV1(unavailable, 0)).toBe(false)
  })

  it('requires explicit-zero record identity and origin together', () => {
    expect(() => CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'explicit-zero',
      amountMicrosUsd: 0,
      reason: 'free-route',
      priceRecordId: 'free-record',
    })).toThrow(/priceRecordId and priceOrigin must be present together/)
  })

  it('preserves legacy amounts without upgrading their provenance', () => {
    const legacy = CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'legacy-frozen',
      amountMicrosUsd: 987_654,
      reason: 'inherited-token-pricing',
    })

    expect(settledCostUsdV1(legacy)).toBe(0.987654)
    expect(costAssignmentMatchesUsdV1(legacy, 0.9876544)).toBe(true)
  })

  it('rejects a settled assignment that disagrees with the call cost', () => {
    const assignment = {
      version: 1,
      kind: 'metered',
      amountMicrosUsd: 1_000_000,
      source: 'client',
    } as const

    expect(() => assertCostAssignmentMatchesUsdV1(assignment, 1.01))
      .toThrow(/does not match the call cost/)
  })

  it('rounds only at micro-USD precision', () => {
    expect(costUsdToMicrosV1(0.00000049)).toBe(0)
    expect(costUsdToMicrosV1(0.0000005)).toBe(1)
  })

  it('rejects invalid monetary assignments', () => {
    expect(() => costUsdToMicrosV1(-1)).toThrow(/finite, non-negative/)
    expect(() => costUsdToMicrosV1(Number.NaN)).toThrow(/finite, non-negative/)
    expect(() => CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'metered',
      amountMicrosUsd: Number.MAX_SAFE_INTEGER + 1,
      source: 'provider',
    })).toThrow()
  })
})
