import { describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { createAdvisorToolRegistry } from './tools'
import type { AdvisorDataSource, AdvisorScope } from './types'

const scope: AdvisorScope = { period: 'week', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null }
function overview(cost: number, model?: string): MenubarPayload {
  return {
    current: {
      cost, calls: cost, sessions: 1, pricingCoverage: 1, topModels: [], topProjects: [], topSessions: [],
      ...(model ? { modelAccounting: { rows: [{ name: model, cost, calls: cost }], gap: { cost: 0, savingsUSD: 0, calls: 0 }, coverage: { cost: 1, calls: 1 } } } : {}),
    },
    history: { daily: [] },
  } as unknown as MenubarPayload
}

describe('Advisor tool scope isolation', () => {
  it('refetches measured spend when a model overrides the supplied Overview scope', async () => {
    const getOverview = vi.fn(async () => overview(4, 'gpt-safe'))
    const source = { getOverview, getModels: vi.fn(async () => []), getQuota: vi.fn(async () => []) } satisfies AdvisorDataSource
    const result = await createAdvisorToolRegistry(source, scope, overview(99)).execute('get_spend_snapshot', { model: 'gpt-safe' })

    expect(getOverview).toHaveBeenCalledWith({ ...scope, model: 'gpt-safe' })
    expect(result.evidence.scope.model).toBe('gpt-safe')
    expect(result.evidence.spend?.measuredCostUSD).toBe(4)
  })

  it('refetches measured usage context when quota provider overrides the supplied scope', async () => {
    const getOverview = vi.fn(async () => overview(6))
    const source = { getOverview, getModels: vi.fn(async () => []), getQuota: vi.fn(async () => []) } satisfies AdvisorDataSource
    const result = await createAdvisorToolRegistry(source, scope, overview(99)).execute('get_quota_snapshot', { provider: 'codex' })

    expect(getOverview).toHaveBeenCalledWith({ ...scope, provider: 'codex' })
    expect(result.evidence.scope.provider).toBe('codex')
    expect(result.evidence.quota?.measuredSpendUSD).toBe(6)
  })
})
