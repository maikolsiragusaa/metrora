import { describe, expect, it } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { meteredTokenKpi } from './spendUsage'

function makeCurrent(overrides: Partial<MenubarPayload['current']> = {}): MenubarPayload['current'] {
  return {
    label: 'Last 7 days',
    cost: 32,
    calls: 40,
    sessions: 8,
    oneShotRate: null,
    inputTokens: 500,
    outputTokens: 250,
    cacheReadTokens: 50,
    cacheWriteTokens: 25,
    cacheHitPercent: 10,
    codexCredits: 0,
    topActivities: [],
    topModels: [],
    localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
    providers: {},
    topProjects: [],
    modelEfficiency: [],
    topSessions: [],
    retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
    routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
    tools: [],
    skills: [],
    subagents: [],
    mcpServers: [],
    ...overrides,
  }
}

describe('meteredTokenKpi', () => {
  it('keeps the legacy reading for payloads without usageEvidence', () => {
    const kpi = meteredTokenKpi(makeCurrent(), 'Input, output & cache')
    expect(kpi).toEqual({ value: '825', detail: 'Input, output & cache', state: 'available' })
  })

  it('treats a reported zero as complete evidence', () => {
    const current = makeCurrent({ usageEvidence: 'complete', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const kpi = meteredTokenKpi(current, 'Observed volume')
    expect(kpi).toEqual({ value: '0', detail: 'Observed volume', state: 'available' })
  })

  it('shows known quantities with an incompleteness note when evidence is partial', () => {
    const kpi = meteredTokenKpi(makeCurrent({ usageEvidence: 'partial' }), 'Input, output & cache')
    expect(kpi.value).toBe('825')
    expect(kpi.state).toBe('partial')
    expect(kpi.detail).toContain('Incomplete token data')
  })

  it('never renders a false zero when no token evidence was reported', () => {
    const current = makeCurrent({ usageEvidence: 'unavailable', calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const kpi = meteredTokenKpi(current, 'Input, output & cache')
    expect(kpi.value).toBe('—')
    expect(kpi.value).not.toBe('0')
    expect(kpi.state).toBe('unavailable')
    expect(kpi.detail).toContain('No token evidence reported')
  })

  it('keeps known counts when complete and unevidenced records mix', () => {
    const current = makeCurrent({ usageEvidence: 'unavailable', inputTokens: 1200, outputTokens: 500, cacheReadTokens: 300, cacheWriteTokens: 0 })
    const kpi = meteredTokenKpi(current, 'Observed volume')
    expect(kpi.value).toBe('2K')
    expect(kpi.state).toBe('partial')
    expect(kpi.detail).toContain('Incomplete token data')
    expect(kpi.detail).not.toContain('No token evidence reported')
  })

  it('never renders a false zero for metered calls without token counters', () => {
    const current = makeCurrent({ calls: 12, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const kpi = meteredTokenKpi(current, 'Input, output & cache')
    expect(kpi.value).toBe('—')
    expect(kpi.value).not.toBe('0')
    expect(kpi.state).toBe('unavailable')
  })

  it('keeps a factual zero for an idle legacy scope without calls', () => {
    const current = makeCurrent({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const kpi = meteredTokenKpi(current, 'Input, output & cache')
    expect(kpi).toEqual({ value: '0', detail: 'Input, output & cache', state: 'available' })
  })

  it('keeps the same reading across a cache round-trip', () => {
    const current = makeCurrent({ usageEvidence: 'partial' })
    const cached = JSON.parse(JSON.stringify(current)) as MenubarPayload['current']
    expect(meteredTokenKpi(cached, 'Input, output & cache')).toEqual(meteredTokenKpi(current, 'Input, output & cache'))
  })
})
