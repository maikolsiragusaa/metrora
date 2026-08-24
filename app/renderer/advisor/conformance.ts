import type { MenubarPayload, ModelReportRow, QuotaProvider } from '../lib/types'
import type { AdvisorDataSource, AdvisorScope } from './types'

export const ADVISOR_CONFORMANCE_SCOPE: AdvisorScope = Object.freeze({
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
})

export type AdvisorConformanceReads = {
  overviews: AdvisorScope[]
  models: AdvisorScope[]
  quotas: number
}

export type AdvisorConformanceFixture = {
  scope: AdvisorScope
  overview: MenubarPayload
  models: ModelReportRow[]
  quota: QuotaProvider[]
  reads: AdvisorConformanceReads
  source: AdvisorDataSource
}

function overview(): MenubarPayload {
  return {
    current: {
      cost: 12,
      calls: 3,
      sessions: 2,
      pricingCoverage: 1,
      topModels: [
        { name: 'gpt-safe', cost: 8, calls: 2 },
        { name: 'local-safe', cost: 4, calls: 1 },
      ],
      topProjects: [{ name: 'Project A', cost: 12, sessions: 2 }],
      topSessions: [{ project: 'Project A', cost: 8, calls: 1 }],
      modelAccounting: {
        rows: [{ name: 'gpt-safe', cost: 8, calls: 2 }],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
      },
    },
    history: { daily: [{ date: '2026-08-22', cost: 4 }, { date: '2026-08-23', cost: 8 }] },
  } as unknown as MenubarPayload
}

function modelRows(): ModelReportRow[] {
  const priced = { state: 'priced' as const, totalCalls: 2, coveredCalls: 2, pricedCalls: 2, explicitZeroCalls: 0, unavailableCalls: 0, unknownCalls: 0, missingPriceRecordCalls: 0 }
  return [
    { provider: 'codex', providerDisplayName: 'Codex', model: 'gpt-safe', modelDisplayName: 'GPT Safe', category: null, inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 30, costUSD: 8, savingsUSD: 0, savingsBaselineModel: '', calls: 2, pricing: priced, credits: null },
    { provider: 'codex', providerDisplayName: 'Codex', model: 'local-safe', modelDisplayName: 'Local Safe', category: null, inputTokens: 5, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 15, costUSD: 4, savingsUSD: 0, savingsBaselineModel: '', calls: 1, pricing: priced, credits: null },
  ]
}

function quotaSnapshot(provider: 'claude' | 'codex', freshness: 'fresh' | 'stale' | 'unavailable', availability: 'available' | 'unavailable'): QuotaProvider {
  const factual = freshness !== 'unavailable'
  return {
    schemaVersion: 1,
    provider,
    authority: 'provider-reported',
    availability,
    connection: freshness === 'stale' ? 'stale' : availability === 'available' ? 'connected' : 'terminalFailure',
    freshness,
    observedAt: factual ? '2026-08-23T12:00:00Z' : null,
    planLabel: factual ? 'Pro' : null,
    windows: factual ? [{ id: 'window', label: 'Five-hour window', usedFraction: 0.2, resetsAt: '2026-08-23T15:00:00Z', windowSeconds: 18_000 }] : [],
    credits: factual ? { balance: 0, currency: 'USD' } : null,
    rateLimit: { state: 'clear', retryAt: null },
  }
}

export function createAdvisorConformanceFixture(options: { quota?: QuotaProvider[]; overview?: MenubarPayload } = {}): AdvisorConformanceFixture {
  const reads: AdvisorConformanceReads = { overviews: [], models: [], quotas: 0 }
  const fixtureOverview = options.overview ?? overview()
  const fixtureModels = modelRows()
  const fixtureQuota = options.quota ?? [quotaSnapshot('claude', 'fresh', 'available'), quotaSnapshot('codex', 'stale', 'unavailable')]
  const source: AdvisorDataSource = {
    getOverview: async (scope, signal) => {
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      reads.overviews.push({ ...scope, range: scope.range ? { ...scope.range } : null })
      await Promise.resolve()
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      return fixtureOverview
    },
    getModels: async (scope, signal) => {
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      reads.models.push({ ...scope, range: scope.range ? { ...scope.range } : null })
      await Promise.resolve()
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      return fixtureModels
    },
    getQuota: async signal => {
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      reads.quotas += 1
      await Promise.resolve()
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      return fixtureQuota
    },
  }
  return { scope: ADVISOR_CONFORMANCE_SCOPE, overview: fixtureOverview, models: fixtureModels, quota: fixtureQuota, reads, source }
}

export function createAdvisorUnavailableConformanceFixture(): AdvisorConformanceFixture {
  return createAdvisorConformanceFixture({ quota: [quotaSnapshot('codex', 'unavailable', 'unavailable')] })
}

export function createAdvisorStaleConformanceFixture(): AdvisorConformanceFixture {
  return createAdvisorConformanceFixture({ quota: [quotaSnapshot('codex', 'stale', 'unavailable')] })
}
