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
})
