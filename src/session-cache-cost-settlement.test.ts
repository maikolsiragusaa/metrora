import { describe, expect, it } from 'vitest'

import type { CachedCall, SessionCache } from './session-cache.js'
import {
  deepseekV4PricingMigrationTargetV1,
  settleCachedCallCost,
  settleSessionCacheCostsForRuntimeV1,
} from './session-cache-cost-settlement.js'

const models = [
  {
    model: 'deepseek-v4-flash',
    oldRecordId: 'deepseek:deepseek-v4-flash:standard:official-2026-08-07',
    newRecordId: 'deepseek:deepseek-v4-flash:standard:official-2026-08-16',
    oldCost: 0.5628,
    offPeakCost: 1.107,
    peak01Cost: 2.214,
  },
  {
    model: 'deepseek-v4-pro',
    oldRecordId: 'deepseek:deepseek-v4-pro:standard:official-2026-08-07',
    newRecordId: 'deepseek:deepseek-v4-pro:standard:official-2026-08-16',
    oldCost: 1.743625,
    offPeakCost: 3.322,
    peak01Cost: 6.644,
  },
] as const

function usage() {
  return {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    reasoningTokens: 0,
    webSearchRequests: 0,
    cacheCreationOneHourTokens: 0,
  }
}

function oldAssignment(recordId: string, amountUSD: number): NonNullable<CachedCall['costAssignment']> {
  return {
    version: 1,
    kind: 'token-price',
    amountMicrosUsd: Math.round(amountUSD * 1_000_000),
    priceRecordId: recordId,
    priceOrigin: 'reviewed-book',
    rateSelection: { kind: 'base' },
  }
}

function call(
  model: string,
  timestamp: string,
  assignment: NonNullable<CachedCall['costAssignment']>,
  costUSD: number,
  overrides: Partial<CachedCall> = {},
): CachedCall {
  return {
    provider: 'claude',
    model,
    modelProvider: 'deepseek',
    usage: usage(),
    costUSD,
    costAssignment: assignment,
    speed: 'standard',
    timestamp,
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: `${model}:${timestamp}`,
    ...overrides,
  }
}

function cacheWithCall(cachedCall: CachedCall): SessionCache {
  return {
    version: 8,
    complete: true,
    providers: {
      claude: {
        envFingerprint: 'synthetic',
        files: {
          'synthetic.jsonl': {
            fingerprint: { dev: 1, ino: 1, mtimeMs: 1, sizeBytes: 1 },
            mcpInventory: [],
            turns: [{ timestamp: cachedCall.timestamp, sessionId: 'synthetic', userMessage: 'synthetic', calls: [cachedCall] }],
          },
        },
      },
    },
  }
}

describe('DeepSeek V4 explicit session-cache pricing remediation', () => {
  for (const model of models) {
    describe(model.model, () => {
      for (const boundary of [
        { label: 'off-peak', timestamp: '2026-08-17T00:30:00Z', cost: model.offPeakCost, policyId: undefined },
        { label: 'peak-01-04', timestamp: '2026-08-17T01:00:00Z', cost: model.peak01Cost, policyId: 'peak-01-04' },
        { label: 'peak-06-10', timestamp: '2026-08-17T06:00:00Z', cost: model.peak01Cost, policyId: 'peak-06-10' },
      ] as const) {
        it(`migrates a post-cutover old assignment to ${boundary.label}`, () => {
          const cachedCall = call(model.model, boundary.timestamp, oldAssignment(model.oldRecordId, model.oldCost), model.oldCost)

          expect(deepseekV4PricingMigrationTargetV1(cachedCall)).toEqual({
            model: model.model,
            successorRecordId: model.newRecordId,
          })

          const settlement = settleCachedCallCost(cachedCall)
          expect(settlement.storedCostUSD).toBeCloseTo(boundary.cost, 12)
          expect(settlement.storedLegacyCostUSD).toBeCloseTo(model.oldCost, 12)
          expect(settlement.storedAssignment).toMatchObject({
            kind: 'token-price',
            priceRecordId: model.newRecordId,
            priceOrigin: 'reviewed-book',
            ...(boundary.policyId === undefined
              ? { rateSelection: { kind: 'base' } }
              : { rateSelection: { kind: 'pricing-policy', policyId: boundary.policyId } }),
          })
        })
      }
    })
  }

  it('keeps an exact pre-cutover old assignment immutable', () => {
    const cachedCall = call(
      'deepseek-v4-flash',
      '2026-08-16T15:59:59.999Z',
      oldAssignment(models[0].oldRecordId, models[0].oldCost),
      models[0].oldCost,
    )
    const settlement = settleCachedCallCost(cachedCall)

    expect(deepseekV4PricingMigrationTargetV1(cachedCall)).toBeUndefined()
    expect(settlement.storedAssignment).toEqual(cachedCall.costAssignment)
    expect(settlement.storedCostUSD).toBe(models[0].oldCost)
    expect(settlement.storedLegacyCostUSD).toBeUndefined()
  })

  it('keeps a correctly settled successor assignment immutable and idempotent', () => {
    const assignment: NonNullable<CachedCall['costAssignment']> = {
      version: 1,
      kind: 'token-price',
      amountMicrosUsd: 2_214_000,
      priceRecordId: models[0].newRecordId,
      priceOrigin: 'reviewed-book',
      rateSelection: { kind: 'pricing-policy', policyId: 'peak-01-04', conditionKinds: ['time-window'] },
    }
    const cachedCall = call('deepseek-v4-flash', '2026-08-17T01:00:00Z', assignment, 2.214, { legacyCostUSD: 0.5628 })
    const first = settleCachedCallCost(cachedCall)
    const second = settleCachedCallCost({
      ...cachedCall,
      costUSD: first.storedCostUSD,
      costAssignment: first.storedAssignment,
      legacyCostUSD: first.storedLegacyCostUSD,
    })

    expect(deepseekV4PricingMigrationTargetV1(cachedCall)).toBeUndefined()
    expect(second.storedAssignment).toEqual(first.storedAssignment)
    expect(second.storedCostUSD).toBe(first.storedCostUSD)
    expect(second.storedLegacyCostUSD).toBe(first.storedLegacyCostUSD)
  })

  it('leaves metered and unrelated model assignments untouched', () => {
    const metered = call(
      'deepseek-v4-flash',
      '2026-08-17T01:00:00Z',
      { version: 1, kind: 'metered', amountMicrosUsd: 123_000, source: 'provider' },
      0.123,
    )
    const unrelated = call(
      'deepseek-chat',
      '2026-08-17T01:00:00Z',
      oldAssignment(models[0].oldRecordId, models[0].oldCost),
      models[0].oldCost,
    )
    const explicitZero = call(
      'deepseek-v4-flash',
      '2026-08-17T01:00:00Z',
      { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'manual-reviewed' },
      0,
    )

    for (const candidate of [metered, unrelated, explicitZero]) {
      const settlement = settleCachedCallCost(candidate)
      expect(deepseekV4PricingMigrationTargetV1(candidate)).toBeUndefined()
      expect(settlement.storedAssignment).toEqual(candidate.costAssignment)
      expect(settlement.storedCostUSD).toBe(candidate.costUSD)
    }
  })

  it('migrates the stored cache exactly once and retains the old amount as rollback evidence', () => {
    const cachedCall = call(
      'deepseek-v4-pro',
      '2026-08-17T06:00:00Z',
      oldAssignment(models[1].oldRecordId, models[1].oldCost),
      models[1].oldCost,
    )
    const cache = cacheWithCall(cachedCall)

    expect(settleSessionCacheCostsForRuntimeV1(cache)).toBe(true)
    const migrated = cache.providers.claude!.files['synthetic.jsonl']!.turns[0]!.calls[0]!
    const snapshot = structuredClone(migrated)
    expect(migrated.costUSD).toBeCloseTo(models[1].peak01Cost, 12)
    expect(migrated.legacyCostUSD).toBeCloseTo(models[1].oldCost, 12)
    expect(migrated.costAssignment).toMatchObject({
      kind: 'token-price',
      priceRecordId: models[1].newRecordId,
      rateSelection: { kind: 'pricing-policy', policyId: 'peak-06-10' },
    })

    expect(settleSessionCacheCostsForRuntimeV1(cache)).toBe(false)
    expect(migrated).toEqual(snapshot)
  })
})
