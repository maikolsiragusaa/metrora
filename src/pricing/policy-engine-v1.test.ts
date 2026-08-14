import { describe, expect, it } from 'vitest'

import catalogData from '../data/pricing-history/catalog.v1.json'
import {
  HistoricalPriceRecordV1Schema,
  parseHistoricalPriceBookV1,
  renderHistoricalPriceBookMarkdownV1,
  resolveHistoricalPriceRecordV1,
  type HistoricalPriceBookV1,
  type HistoricalPriceRatesV1,
  type HistoricalPriceRecordV1,
} from './history.js'
import { calculateHistoricalCostV1, type HistoricalPriceUsageV1 } from './historical-cost.js'
import { assignRuntimeCostV1 } from './runtime-cost-assignment.js'
import { settleHistoricalCostV1 } from './settled-historical-cost.js'

function rates(inputPerToken = 1e-6, outputPerToken = 2e-6): HistoricalPriceRatesV1 {
  return {
    inputPerToken,
    outputPerToken,
    cacheReadPerToken: inputPerToken / 10,
    cacheWritePerToken: inputPerToken * 1.25,
  }
}

function record(overrides: Record<string, unknown> = {}): HistoricalPriceRecordV1 {
  return HistoricalPriceRecordV1Schema.parse({
    priceRecordId: 'provider-a:kimi-k3:standard:fixture',
    pricingAuthority: 'provider-a',
    pricingModel: 'kimi-k3',
    validFrom: { basis: 'reviewed-effective', at: '2026-08-01T00:00:00Z' },
    rates: rates(),
    valuation: { kind: 'priced' },
    source: {
      kind: 'manual-reviewed',
      reference: 'synthetic policy fixture',
      observedAt: '2026-08-01T00:00:00Z',
    },
    ...overrides,
  })
}

function book(records: HistoricalPriceRecordV1[]): HistoricalPriceBookV1 {
  return parseHistoricalPriceBookV1({ schemaVersion: 1, records })
}

function lookup(overrides: Record<string, unknown> = {}) {
  return {
    pricingAuthority: 'provider-a',
    pricingModel: 'kimi-k3',
    route: 'standard',
    timestamp: '2026-08-10T12:00:00Z',
    ...overrides,
  }
}

function usage(overrides: Record<string, unknown> = {}): HistoricalPriceUsageV1 {
  return {
    inputTokens: 1_000,
    billableOutputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearchRequests: 0,
    speed: 'standard',
    ...overrides,
  } as HistoricalPriceUsageV1
}

describe('pricing policy engine v1 foundation', () => {
  it('keeps the existing simple provider/model standard price and token bands unchanged', () => {
    const simple = calculateHistoricalCostV1(record({
      rateBands: [{
        when: { kind: 'prompt-input-tokens-above', tokens: 1_000 },
        rates: rates(2e-6, 3e-6),
      }],
    }), usage({ promptInputTokens: 1_000 }))
    const above = calculateHistoricalCostV1(record({
      rateBands: [{
        when: { kind: 'prompt-input-tokens-above', tokens: 1_000 },
        rates: rates(2e-6, 3e-6),
      }],
    }), usage({ promptInputTokens: 1_001 }))

    expect(simple.kind).toBe('calculated')
    expect(above.kind).toBe('calculated')
    if (simple.kind !== 'calculated' || above.kind !== 'calculated') return
    expect(simple.rateSelection).toEqual({ kind: 'base' })
    expect(above.rateSelection).toEqual({ kind: 'prompt-input-tokens-above', tokens: 1_000 })
    expect(above.costUSD).toBeGreaterThan(simple.costUSD)
  })

  it('resolves the same model identity to different provider authorities without collision', () => {
    const providerA = record({
      priceRecordId: 'provider-a:kimi-k3:standard:fixture',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
      route: 'standard',
      rates: rates(1e-6, 2e-6),
    })
    const providerB = record({
      priceRecordId: 'provider-b:kimi-k3:standard:fixture',
      pricingAuthority: 'provider-b',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-b',
      route: 'standard',
      rates: rates(3e-6, 4e-6),
    })
    const reviewed = book([providerA, providerB])

    expect(resolveHistoricalPriceRecordV1(reviewed, lookup({
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
      route: 'standard',
    }))?.priceRecordId).toBe(providerA.priceRecordId)
    expect(resolveHistoricalPriceRecordV1(reviewed, lookup({
      pricingAuthority: 'provider-b',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-b',
    }))?.priceRecordId).toBe(providerB.priceRecordId)
  })

  it('does not borrow the original model-owner price for a differently hosted model', () => {
    const ownerPrice = record({
      priceRecordId: 'moonshot:kimi-k3:standard:fixture',
      pricingAuthority: 'moonshot',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
    })

    expect(resolveHistoricalPriceRecordV1(book([ownerPrice]), lookup({
      pricingAuthority: 'provider-a',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
    }))).toBeUndefined()
  })

  it('keeps direct and gateway delivery identities separate, including unknown downstream hosting', () => {
    const direct = record({
      priceRecordId: 'provider-a:kimi-k3:standard:direct',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
      route: 'standard',
      rates: rates(1e-6, 2e-6),
    })
    const gateway = record({
      priceRecordId: 'openrouter:kimi-k3:standard:gateway',
      pricingAuthority: 'openrouter',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
      gateway: 'openrouter',
      route: 'standard',
      rates: rates(5e-7, 1e-6),
    })
    const reviewed = book([direct, gateway])

    expect(resolveHistoricalPriceRecordV1(reviewed, lookup({
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
    }))?.priceRecordId).toBe(direct.priceRecordId)
    expect(resolveHistoricalPriceRecordV1(reviewed, lookup({
      pricingAuthority: 'openrouter',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
      gateway: 'openrouter',
    }))?.priceRecordId).toBe(gateway.priceRecordId)
    expect(resolveHistoricalPriceRecordV1(reviewed, lookup({
      pricingAuthority: 'openrouter',
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      gateway: 'openrouter',
    }))).toBeUndefined()
  })

  it('fails closed when provider or route evidence is missing for an extended identity', () => {
    const extended = record({
      modelIdentity: 'kimi-k3-family',
      inferenceProvider: 'provider-a',
      route: 'priority',
    })
    expect(resolveHistoricalPriceRecordV1(book([extended]), lookup({
      modelIdentity: 'kimi-k3-family',
      route: undefined,
    }))).toBeUndefined()
    expect(resolveHistoricalPriceRecordV1(book([extended]), lookup({
      modelIdentity: 'kimi-k3-family',
      inferenceProvider: undefined,
      route: 'priority',
    }))).toBeUndefined()
  })

  it('selects a deterministic off-peak rule across midnight with half-open boundaries', () => {
    const offPeak = record({
      pricingPolicies: [{
        policyId: 'weekday-off-peak',
        when: [{
          kind: 'time-window',
          window: {
            timeZone: 'UTC',
            startMinute: 22 * 60,
            endMinute: 2 * 60,
            daysOfWeek: [1],
          },
        }],
        rates: rates(0.5e-6, 1e-6),
      }],
    })

    const before = calculateHistoricalCostV1(offPeak, usage({ timestamp: '2026-08-10T21:59:59Z' }))
    const atStart = calculateHistoricalCostV1(offPeak, usage({ timestamp: '2026-08-10T22:00:00Z' }))
    const afterMidnight = calculateHistoricalCostV1(offPeak, usage({ timestamp: '2026-08-11T01:59:59Z' }))
    const atEnd = calculateHistoricalCostV1(offPeak, usage({ timestamp: '2026-08-11T02:00:00Z' }))

    for (const result of [before, atStart, afterMidnight, atEnd]) expect(result.kind).toBe('calculated')
    if (before.kind !== 'calculated' || atStart.kind !== 'calculated'
      || afterMidnight.kind !== 'calculated' || atEnd.kind !== 'calculated') return
    expect(before.costUSD).toBeCloseTo(atStart.costUSD * 2, 12)
    expect(afterMidnight.costUSD).toBeCloseTo(atStart.costUSD, 12)
    expect(atEnd.costUSD).toBeCloseTo(before.costUSD, 12)
  })

  it('applies validFrom/validUntil before evaluating a recurring condition', () => {
    const first = record({
      priceRecordId: 'provider-a:kimi-k3:standard:first',
      validFrom: { basis: 'reviewed-effective', at: '2026-08-01T00:00:00Z' },
      validUntil: '2026-08-15T00:00:00Z',
      route: 'standard',
    })
    const second = record({
      priceRecordId: 'provider-a:kimi-k3:standard:second',
      validFrom: { basis: 'official-effective', at: '2026-08-15T00:00:00Z' },
      supersedes: first.priceRecordId,
      route: 'standard',
      rates: rates(2e-6, 4e-6),
      pricingPolicies: [{
        policyId: 'night',
        when: [{
          kind: 'time-window',
          window: { timeZone: 'UTC', startMinute: 22 * 60, endMinute: 23 * 60 },
        }],
        rates: rates(1e-6, 2e-6),
      }],
    })
    const reviewed = book([first, second])

    expect(resolveHistoricalPriceRecordV1(reviewed, lookup({ timestamp: '2026-08-14T23:00:00Z' }))?.priceRecordId)
      .toBe(first.priceRecordId)
    expect(resolveHistoricalPriceRecordV1(reviewed, lookup({ timestamp: '2026-08-15T00:00:00Z' }))?.priceRecordId)
      .toBe(second.priceRecordId)
    const atNewInterval = calculateHistoricalCostV1(second, usage({ timestamp: '2026-08-15T22:00:00Z' }))
    expect(atNewInterval.kind).toBe('calculated')
    if (atNewInterval.kind === 'calculated') {
      expect(atNewInterval.rateSelection).toMatchObject({ kind: 'pricing-policy', policyId: 'night' })
    }
  })

  it('uses provider-declared timezone semantics deterministically', () => {
    const pacific = record({
      pricingPolicies: [{
        policyId: 'pacific-business-hour',
        when: [{
          kind: 'time-window',
          window: {
            timeZone: 'America/Los_Angeles',
            startMinute: 9 * 60,
            endMinute: 10 * 60,
            daysOfWeek: [1],
          },
        }],
        rates: rates(0.5e-6, 1e-6),
      }],
    })
    const inside = calculateHistoricalCostV1(pacific, usage({ timestamp: '2026-08-10T16:59:00Z' }))
    const outside = calculateHistoricalCostV1(pacific, usage({ timestamp: '2026-08-10T17:00:00Z' }))

    expect(inside.kind).toBe('calculated')
    expect(outside.kind).toBe('calculated')
    if (inside.kind === 'calculated' && outside.kind === 'calculated') {
      expect(inside.costUSD).toBeCloseTo(outside.costUSD / 2, 12)
    }
  })

  it('does not fabricate dynamic pricing without required request evidence', () => {
    const dynamic = record({
      pricingMode: { kind: 'dynamic', requiredEvidence: 'provider-reported-multiplier' },
    })
    const unavailable = calculateHistoricalCostV1(dynamic, usage())
    expect(unavailable).toMatchObject({ kind: 'unavailable', reason: 'missing-pricing-evidence' })

    const evidenced = calculateHistoricalCostV1(dynamic, usage({
      pricingEvidence: [{
        kind: 'provider-reported-multiplier',
        multiplier: 2,
        source: 'provider',
        observedAt: '2026-08-10T12:00:00Z',
      }],
    }))
    expect(evidenced.kind).toBe('calculated')
    if (evidenced.kind === 'calculated') expect(evidenced.costUSD).toBeCloseTo(0.0024, 12)
  })

  it('uses provider-reported tier evidence to choose a typed policy', () => {
    const tiered = record({
      pricingMode: { kind: 'dynamic', requiredEvidence: 'provider-reported-tier' },
      pricingPolicies: [{
        policyId: 'priority-tier',
        when: [{ kind: 'provider-reported-tier-is', tier: 'priority' }],
        rates: rates(3e-6, 4e-6),
      }],
    })
    expect(calculateHistoricalCostV1(tiered, usage())).toMatchObject({
      kind: 'unavailable',
      reason: 'missing-pricing-evidence',
    })
    const selected = calculateHistoricalCostV1(tiered, usage({
      pricingEvidence: [{
        kind: 'provider-reported-tier',
        tier: 'priority',
        source: 'gateway',
        observedAt: '2026-08-10T12:00:00Z',
      }],
    }))
    expect(selected.kind).toBe('calculated')
    if (selected.kind === 'calculated') {
      expect(selected.rateSelection).toMatchObject({ kind: 'pricing-policy', policyId: 'priority-tier' })
      expect(selected.selectedRates.inputPerToken).toBe(3e-6)
    }
  })

  it('fails closed for ambiguous equal-specificity policy matches', () => {
    const overlapping = record({
      pricingPolicies: [
        {
          policyId: 'window-a',
          when: [{ kind: 'time-window', window: { timeZone: 'UTC', startMinute: 9 * 60, endMinute: 12 * 60 } }],
          rates: rates(2e-6, 3e-6),
        },
        {
          policyId: 'window-b',
          when: [{ kind: 'time-window', window: { timeZone: 'UTC', startMinute: 11 * 60, endMinute: 14 * 60 } }],
          rates: rates(3e-6, 4e-6),
        },
      ],
    })
    expect(calculateHistoricalCostV1(overlapping, usage({ timestamp: '2026-08-10T11:30:00Z' }))).toMatchObject({
      kind: 'unavailable',
      reason: 'ambiguous-pricing-policy',
    })

    expect(() => book([record({
      pricingPolicies: [
        { policyId: 'same-a', when: [{ kind: 'speed-is', speed: 'fast' }], rates: rates(2e-6, 3e-6) },
        { policyId: 'same-b', when: [{ kind: 'speed-is', speed: 'fast' }], rates: rates(3e-6, 4e-6) },
      ],
    })])).toThrow(/duplicate pricing policy conditions/)
  })

  it('keeps metered cost stronger than reconstructed API-equivalent pricing', () => {
    const result = assignRuntimeCostV1({
      provider: 'codex',
      model: 'openai/gpt-5.6-luna',
      modelProvider: 'openai',
      timestamp: '2026-07-31T00:00:00Z',
      speed: 'standard',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        reasoningTokens: 0,
        webSearchRequests: 0,
      },
      legacyCostUSD: 99,
      meteredCost: { amountUSD: 0.123456, source: 'provider' },
    })
    expect(result.storedCostUSD).toBe(0.123456)
    expect(result.storedAssignment).toMatchObject({ kind: 'metered', source: 'provider' })
  })

  it('supports bounded request charge components without collapsing them into token rates', () => {
    const charged = record({
      rates: {
        ...rates(),
        requestCharges: { gatewayServicePerRequest: 0.05, toolRequestPerRequest: 0.01 },
      },
    })
    const result = calculateHistoricalCostV1(charged, usage({ gatewayRequests: 2, toolRequests: 3 }))
    expect(result.kind).toBe('calculated')
    if (result.kind === 'calculated') expect(result.costUSD).toBeCloseTo(0.1312, 12)
    expect(calculateHistoricalCostV1(charged, usage())).toMatchObject({
      kind: 'unavailable',
      reason: 'missing-request-charge-rate',
    })
  })

  it('keeps extended assignment provenance available without exposing source payloads', () => {
    const extended = record({
      modelIdentity: 'kimi-k3-family',
      modelOwner: 'moonshot',
      inferenceProvider: 'provider-a',
      gateway: 'router-a',
      region: 'eu-west',
      pricingPolicies: [],
    })
    const settled = settleHistoricalCostV1(extended, 'reviewed-book', usage())
    expect(settled.assignment).toMatchObject({
      kind: 'token-price',
      pricingProvenance: {
        pricingAuthority: 'provider-a',
        modelIdentity: 'kimi-k3-family',
        modelOwner: 'moonshot',
        inferenceProvider: 'provider-a',
        gateway: 'router-a',
        region: 'eu-west',
        sourceKind: 'manual-reviewed',
      },
    })
    expect(JSON.stringify(settled.assignment)).not.toContain('synthetic policy fixture')
  })

  it('keeps existing catalog V1 data readable and generated rendering deterministic', () => {
    const parsed = parseHistoricalPriceBookV1(catalogData)
    expect(parsed.schemaVersion).toBe(1)
    expect(renderHistoricalPriceBookMarkdownV1(parsed)).toBe(renderHistoricalPriceBookMarkdownV1(parsed))
  })
})
