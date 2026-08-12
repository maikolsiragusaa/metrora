import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  CostAssignmentV1Schema,
  assertCostAssignmentMatchesUsdV1,
  costAssignmentMatchesUsdV1,
  costUsdToMicrosV1,
  settledCostMicrosV1,
  settledCostUsdV1,
} from './cost-assignment.js'

const oldNonNegativeSafeMicrosSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const oldIdentifierSchema = z.string().trim().min(1).max(240)
const oldOriginSchema = z.enum(['reviewed-book', 'local-observation'])
const oldRateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('base') }),
  z.strictObject({ kind: z.literal('prompt-input-tokens-above'), tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
])
const oldSequentialSchema = z.union([
  z.strictObject({ version: z.literal(1), kind: z.literal('metered'), amountMicrosUsd: oldNonNegativeSafeMicrosSchema, source: z.enum(['provider', 'client', 'billing-export']) }),
  z.strictObject({ version: z.literal(1), kind: z.literal('token-price'), amountMicrosUsd: oldNonNegativeSafeMicrosSchema, priceRecordId: oldIdentifierSchema, priceOrigin: oldOriginSchema, rateSelection: oldRateSchema }),
  z.strictObject({ version: z.literal(1), kind: z.literal('explicit-zero'), amountMicrosUsd: z.literal(0), reason: z.enum(['free-route', 'free-model', 'local-inference', 'manual-reviewed']), priceRecordId: oldIdentifierSchema.optional(), priceOrigin: oldOriginSchema.optional() }),
  z.strictObject({ version: z.literal(1), kind: z.literal('legacy-frozen'), amountMicrosUsd: oldNonNegativeSafeMicrosSchema, reason: z.enum(['inherited-token-pricing', 'collector-estimate', 'unknown']) }),
  z.strictObject({ version: z.literal(1), kind: z.literal('unavailable'), reason: z.enum(['no-price-record', 'missing-required-rate', 'conflicting-evidence']) }),
]).superRefine((assignment, context) => {
  if (assignment.kind === 'explicit-zero'
    && ((assignment.priceRecordId === undefined) !== (assignment.priceOrigin === undefined))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'explicit-zero priceRecordId and priceOrigin must be present together',
    })
  }
})

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

  it('matches the old sequential validator across a generated compatibility corpus', () => {
    const valid = [
      { version: 1, kind: 'metered', amountMicrosUsd: 0, source: 'provider' },
      { version: 1, kind: 'metered', amountMicrosUsd: Number.MAX_SAFE_INTEGER, source: 'billing-export' },
      { version: 1, kind: 'token-price', amountMicrosUsd: 1, priceRecordId: '  record  ', priceOrigin: 'reviewed-book', rateSelection: { kind: 'base' } },
      { version: 1, kind: 'token-price', amountMicrosUsd: 2, priceRecordId: 'observed', priceOrigin: 'local-observation', rateSelection: { kind: 'prompt-input-tokens-above', tokens: Number.MAX_SAFE_INTEGER } },
      { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'free-route' },
      { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'manual-reviewed', priceRecordId: 'zero', priceOrigin: 'reviewed-book' },
      { version: 1, kind: 'legacy-frozen', amountMicrosUsd: 0, reason: 'collector-estimate' },
      { version: 1, kind: 'unavailable', reason: 'conflicting-evidence' },
    ]
    const mutationValues: unknown[] = [undefined, null, false, '', 'wrong', -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, [], {}]
    const corpus: unknown[] = [null, 1, 'assignment', [], {}, ...valid]
    for (const assignment of valid) {
      for (const key of Object.keys(assignment)) {
        const missing = { ...assignment } as Record<string, unknown>
        delete missing[key]
        corpus.push(missing)
        for (const value of mutationValues) corpus.push({ ...assignment, [key]: value })
      }
      corpus.push({ ...assignment, unknownKey: true })
    }
    corpus.push(
      { version: 1, kind: 'future-kind', amountMicrosUsd: 0 },
      { version: 2, kind: 'metered', amountMicrosUsd: 0, source: 'provider' },
      { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'free-route', priceRecordId: 'partial' },
    )

    expect(corpus.length).toBeGreaterThan(500)
    for (const candidate of corpus) {
      const oldResult = oldSequentialSchema.safeParse(candidate)
      const newResult = CostAssignmentV1Schema.safeParse(candidate)
      expect(newResult.success, JSON.stringify(candidate)).toBe(oldResult.success)
      if (oldResult.success && newResult.success) expect(newResult.data).toEqual(oldResult.data)
    }
  })
})
