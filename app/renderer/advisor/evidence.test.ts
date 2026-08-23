import { describe, expect, it } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import type { QuotaProvider } from '../../electron/quota/types'
import { buildModelEfficiencyEvidence, buildQuotaEvidence, buildSpendEvidence } from './evidence'
import type { AdvisorScope } from './types'

const scope: AdvisorScope = { period: 'week', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null }
const emptyOverview = {
  current: {
    cost: undefined,
    calls: undefined,
    sessions: undefined,
    pricingCoverage: undefined,
    topModels: [],
    topProjects: [],
    topSessions: [],
  },
  history: { daily: [] },
} as unknown as MenubarPayload

function quota(provider: 'claude' | 'codex', freshness: 'fresh' | 'stale' | 'unavailable', availability: 'available' | 'unavailable'): QuotaProvider {
  return {
    schemaVersion: 1,
    provider,
    authority: 'provider-reported',
    availability,
    connection: freshness === 'stale' ? 'stale' : availability === 'available' ? 'connected' : 'terminalFailure',
    freshness,
    observedAt: '2026-08-23T12:00:00Z',
    planLabel: 'Pro',
    windows: [{ id: 'window', label: '5-hour window', usedFraction: 0.2, resetsAt: '2026-08-23T15:00:00Z', windowSeconds: 18_000 }],
    credits: { balance: 0, currency: 'USD' },
    rateLimit: { state: 'clear', retryAt: null },
  }
}

describe('Advisor evidence truth contract', () => {
  it('keeps missing spend totals unavailable instead of inventing zeroes', () => {
    const evidence = buildSpendEvidence('missing totals', scope, emptyOverview)
    expect(evidence.coverage.level).toBe('unavailable')
    expect(evidence.spend?.measuredCostUSD).toBeNull()
    expect(evidence.spend?.calls).toBeNull()
    expect(evidence.spend?.sessions).toBeNull()
  })

  it('marks mixed provider freshness partial even when one provider is fresh', () => {
    const evidence = buildQuotaEvidence('quota', scope, null, [
      quota('claude', 'fresh', 'available'),
      quota('codex', 'stale', 'unavailable'),
    ])
    expect(evidence.coverage.level).toBe('partial')
    expect(evidence.coverage.label).toBe('Mixed provider quota freshness')
    expect(evidence.quota?.providers[1]?.windows).toHaveLength(1)
    expect(evidence.quota?.providers[1]?.creditsUSD).toBe(0)
  })

  it('hides plan, windows, and credits when provider availability is unavailable', () => {
    const evidence = buildQuotaEvidence('quota', scope, null, [quota('codex', 'fresh', 'unavailable')])
    expect(evidence.coverage.level).toBe('unavailable')
    expect(evidence.quota?.providers[0]).toMatchObject({ planLabel: null, windows: [], creditsUSD: null })
  })

  it('does not retain stale facts when availability contradicts the canonical stale state', () => {
    const evidence = buildQuotaEvidence('quota', scope, null, [quota('codex', 'stale', 'available')])
    expect(evidence.coverage.level).toBe('unavailable')
    expect(evidence.quota?.providers[0]).toMatchObject({ planLabel: null, windows: [], creditsUSD: null })
  })

  it.each(['degraded', 'targeted'] as const)('downgrades otherwise-high spend coverage for %s source reconciliation', reconciliation => {
    const payload = {
      ...emptyOverview,
      freshness: { readMode: 'snapshot', reconciliation, durableThrough: '2026-08-22' },
      current: { ...emptyOverview.current, cost: 12, calls: 3, sessions: 2, pricingCoverage: 1 },
    } as unknown as MenubarPayload
    const evidence = buildSpendEvidence('spend', scope, payload)
    expect(evidence.coverage.level).toBe('partial')
    expect(evidence.coverage.label.toLowerCase()).toContain(reconciliation)
    expect(evidence.unknown.some(item => item.toLowerCase().includes('reconciliation'))).toBe(true)
  })

  it('does not publish fallback Overview cost-per-call as authoritative model efficiency', () => {
    const payload = {
      ...emptyOverview,
      current: { ...emptyOverview.current, cost: 12, calls: 3, sessions: 2, pricingCoverage: 1, topModels: [{ name: 'fallback-model', cost: 12, calls: 3 }] },
    } as unknown as MenubarPayload
    const evidence = buildModelEfficiencyEvidence('model efficiency', scope, payload, [])
    expect(evidence.coverage.level).toBe('partial')
    expect(evidence.modelEfficiency?.rows[0]).toMatchObject({ model: 'fallback-model', pricingState: 'unknown', costPerCallUSD: null })
  })

  it('preserves provider observation timestamps instead of synthesizing newer freshness', () => {
    const older = quota('codex', 'stale', 'unavailable')
    older.observedAt = '2026-08-22T08:00:00Z'
    const newer = quota('claude', 'fresh', 'available')
    newer.observedAt = '2026-08-23T12:00:00Z'
    const evidence = buildQuotaEvidence('quota', scope, null, [older, newer])
    expect(evidence.quota?.providers.map(item => item.observedAt)).toEqual(['2026-08-22T08:00:00Z', '2026-08-23T12:00:00Z'])
  })
})
