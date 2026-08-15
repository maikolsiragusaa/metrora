import { describe, expect, it } from 'vitest'

import {
  COMPANION_USAGE_KIND,
  COMPANION_USAGE_VERSION,
  toCompanionUsageV1,
} from './companion-contract.js'

describe('CompanionUsageV1', () => {
  it('maps the internal desktop payload into a stable content-minimal DTO', () => {
    const payload = toCompanionUsageV1({
      generated: '2026-07-31T10:30:00.000Z',
      current: {
        label: 'This month',
        cost: 1.2345674,
        estimatedCostUSD: 0.12,
        calls: 12,
        sessions: 4,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 25,
        cacheWriteTokens: 5,
        cacheHitPercent: 20.5,
        pricingCoverage: 0.875,
        topModels: [
          { name: 'Model A', calls: 8, cost: 1.1, estimatedCostUSD: 0.1 },
          { name: 'Model B', calls: 4, cost: 0.1345674 },
        ],
        // Internal/private report fields must not leak into the companion DTO.
        topProjects: [{ name: 'secret-project' }],
        topSessions: [{ project: 'secret-project' }],
      },
      optimize: { topFindings: [{ title: 'internal finding' }] },
    })

    expect(payload).toEqual({
      kind: COMPANION_USAGE_KIND,
      version: COMPANION_USAGE_VERSION,
      generatedAt: '2026-07-31T10:30:00.000Z',
      period: { label: 'This month' },
      totals: {
        costMicrosUsd: 1_234_567,
        estimatedCostMicrosUsd: 120_000,
        calls: 12,
        sessions: 4,
        tokens: {
          input: 100,
          output: 50,
          cacheRead: 25,
          cacheWrite: 5,
          total: 180,
        },
        cacheHitPercent: 20.5,
      },
      topModels: [
        { name: 'Model A', calls: 8, costMicrosUsd: 1_100_000, estimatedCostMicrosUsd: 100_000 },
        { name: 'Model B', calls: 4, costMicrosUsd: 134_567, estimatedCostMicrosUsd: null },
      ],
      quality: { pricingCoverage: 0.875 },
    })
    expect(JSON.stringify(payload)).not.toContain('secret-project')
    expect(JSON.stringify(payload)).not.toContain('internal finding')
  })

  it('keeps unknown quality explicit and normalizes unsafe numeric input', () => {
    const payload = toCompanionUsageV1({
      generated: 'not-a-date',
      current: {
        label: '',
        cost: -5,
        calls: -2,
        sessions: Number.NaN,
        inputTokens: 3.9,
        outputTokens: 2,
        cacheReadTokens: -1,
        cacheWriteTokens: 1,
        cacheHitPercent: 140,
        topModels: [{ name: '', calls: 10, cost: 20 }],
      },
    })

    expect(payload.period.label).toBe('Selected period')
    expect(payload.totals.costMicrosUsd).toBe(0)
    expect(payload.totals.calls).toBe(0)
    expect(payload.totals.sessions).toBe(0)
    expect(payload.totals.tokens).toEqual({ input: 3, output: 2, cacheRead: 0, cacheWrite: 1, total: 6 })
    expect(payload.totals.cacheHitPercent).toBe(100)
    expect(payload.topModels).toEqual([])
    expect(payload.quality.pricingCoverage).toBeNull()
    expect(Number.isFinite(Date.parse(payload.generatedAt))).toBe(true)
  })

  it('rejects a payload without a current-period object', () => {
    expect(() => toCompanionUsageV1({ generated: new Date().toISOString() })).toThrow('invalid usage payload current period')
  })

  it('exposes a bounded period-aware daily trend only when Desktop history is available', () => {
    const start = new Date('2026-06-25T00:00:00.000Z')
    const daily = Array.from({ length: 40 }, (_, index) => {
      const date = new Date(start)
      date.setUTCDate(date.getUTCDate() + index)
      return {
        date: date.toISOString().slice(0, 10),
        cost: index / 100,
        savingsUSD: 0,
        calls: index,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        topModels: [],
      }
    })

    const payload = toCompanionUsageV1(
      {
        generated: '2026-07-31T10:30:00.000Z',
        current: { label: '30 days', cost: 2, topModels: [] },
        history: { daily },
      },
      { period: '30days' },
    )

    expect(payload.trend).toEqual({
      granularity: 'day',
      periodLabel: '30 days',
      buckets: expect.arrayContaining([
        { date: '2026-07-02', costMicrosUsd: 70000 },
        { date: '2026-07-31', costMicrosUsd: 360000 },
      ]),
    })
    expect(payload.trend?.buckets).toHaveLength(30)
    expect(payload.trend?.buckets.map(bucket => bucket.date)).toEqual(
      [...(payload.trend?.buckets ?? [])].map(bucket => bucket.date).sort(),
    )

    const legacyPayload = toCompanionUsageV1({
      generated: '2026-07-31T10:30:00.000Z',
      current: { label: 'This month', cost: 2, topModels: [] },
    })
    expect(legacyPayload.trend).toBeUndefined()
  })

  it('aggregates the complete selected range at a bounded period-appropriate granularity', () => {
    const allDaily = Array.from({ length: 179 }, (_, index) => {
      const date = new Date('2026-02-18T00:00:00.000Z')
      date.setUTCDate(date.getUTCDate() + index)
      return { date: date.toISOString().slice(0, 10), cost: 0.01, topModels: [] }
    })
    const all = toCompanionUsageV1(
      {
        generated: '2026-08-15T10:30:00.000Z',
        current: { label: 'Last 6 months', cost: 2.2, topModels: [] },
        history: { periodDaily: allDaily, daily: allDaily.slice(-31) },
      },
      { period: 'all' },
    )

    expect(all.trend?.granularity).toBe('week')
    expect(all.trend?.buckets[0]?.date).toBe('2026-02-16')
    expect(all.trend?.buckets.at(-1)?.date).toBe('2026-08-10')
    expect(all.trend?.buckets.reduce((sum, bucket) => sum + bucket.costMicrosUsd, 0)).toBe(1_790_000)

    const lifetimeDaily = Array.from({ length: 220 }, (_, index) => {
      const date = new Date('2026-01-01T00:00:00.000Z')
      date.setUTCDate(date.getUTCDate() + index)
      return { date: date.toISOString().slice(0, 10), cost: 0.01, topModels: [] }
    })

    const lifetime = toCompanionUsageV1(
      {
        generated: '2026-08-15T10:30:00.000Z',
        current: { label: 'Lifetime', cost: 4, topModels: [] },
        history: { periodDaily: lifetimeDaily },
      },
      { period: 'lifetime' },
    )
    expect(lifetime.trend?.granularity).toBe('month')
    expect(lifetime.trend?.buckets[0]).toEqual({ date: '2026-01-01', costMicrosUsd: 310_000 })
    expect(lifetime.trend?.buckets.at(-1)).toEqual({ date: '2026-08-01', costMicrosUsd: 80_000 })
  })

  it('honors an explicitly requested supported trend granularity', () => {
    const payload = toCompanionUsageV1(
      {
        generated: '2026-08-15T10:30:00.000Z',
        current: { label: 'This month', cost: 1, topModels: [] },
        history: {
          periodDaily: [
            { date: '2026-08-01', cost: 0.25, topModels: [] },
            { date: '2026-08-02', cost: 0.75, topModels: [] },
          ],
        },
      },
      { period: 'month', granularity: 'week' },
    )

    expect(payload.trend).toEqual({
      granularity: 'week',
      periodLabel: 'This month',
      buckets: [{ date: '2026-07-27', costMicrosUsd: 1_000_000 }],
    })
  })

  it('carries factual provider identity and a bounded full model breakdown', () => {
    const payload = toCompanionUsageV1({
      generated: '2026-08-15T10:30:00.000Z',
      current: {
        label: 'This month',
        topModels: [{ name: 'GPT-5.6 Sol', providerId: 'provider-a', calls: 2, cost: 1 }],
        modelAccounting: {
          rows: [
            { name: 'GPT-5.6 Sol', provider: 'provider-a', calls: 2, cost: 1 },
            { name: 'GPT-5.6 Sol', provider: 'provider-b', calls: 1, cost: 0.5 },
          ],
        },
      },
    })

    expect(payload.topModels[0]?.providerId).toBe('provider-a')
    expect(payload.models?.map(model => model.providerId)).toEqual(['provider-a', 'provider-b'])
  })

  it('keeps route provenance separate from canonical model branding', () => {
    const payload = toCompanionUsageV1({
      generated: '2026-08-15T10:30:00.000Z',
      current: {
        label: 'This month',
        topModels: [
          { name: 'GPT-5.4', providerId: 'openai', brandId: 'openai', calls: 1, cost: 1 },
          { name: 'Claude Sonnet 4.6', providerId: 'amazon-bedrock', brandId: 'anthropic', calls: 1, cost: 1 },
          { name: 'DeepSeek V4 Flash', providerId: 'deepseek', brandId: 'deepseek', calls: 1, cost: 1 },
          { name: 'Qwen 3.7 Plus', providerId: 'qwen', brandId: 'qwen', calls: 1, cost: 1 },
          { name: 'Kimi K2.6', providerId: 'moonshotai', brandId: 'moonshot', calls: 1, cost: 1 },
        ],
      },
    })

    expect(payload.topModels[0]).toMatchObject({ providerId: 'openai', brandId: 'openai' })
    expect(payload.topModels[1]).toMatchObject({ providerId: 'amazon-bedrock', brandId: 'anthropic' })
    expect(payload.topModels[2]).toMatchObject({ providerId: 'deepseek', brandId: 'deepseek' })
    expect(payload.topModels[3]).toMatchObject({ providerId: 'qwen', brandId: 'qwen' })
    expect(payload.topModels[4]).toMatchObject({ providerId: 'moonshotai', brandId: 'moonshot' })

    const invalidBrand = toCompanionUsageV1({
      generated: '2026-08-15T10:30:00.000Z',
      current: {
        label: 'This month',
        topModels: [{ name: 'Unknown', providerId: 'openai', brandId: 'codex', calls: 1, cost: 1 }],
      },
    })
    expect(invalidBrand.topModels[0]).toMatchObject({ providerId: 'openai' })
    expect(invalidBrand.topModels[0]).not.toHaveProperty('brandId')
  })
})
