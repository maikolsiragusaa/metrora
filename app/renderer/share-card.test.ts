import { describe, expect, it } from 'vitest'

import type { MenubarPayload } from './lib/types'
import { buildShareCardV1, renderShareCardSvg, shareCardPeriodLabel } from './share-card'

function payload(overrides: Partial<MenubarPayload['current']> = {}, reconciliation: 'complete' | 'degraded' = 'complete'): MenubarPayload {
  return {
    freshness: { readMode: 'snapshot', reconciliation, durableThrough: null },
    current: {
      calls: 1_234,
      sessions: 48,
      cost: 67.89,
      topModels: [{ name: 'gpt-5.6-sol', calls: 812, cost: 50, savingsUSD: 0, savingsBaselineModel: '' }],
      pricingCoverage: 0.82,
      ...overrides,
    },
  } as unknown as MenubarPayload
}

describe('ShareCardV1 projection', () => {
  it('keeps exact cost and Project name private by default', () => {
    const card = buildShareCardV1({
      payload: payload(),
      period: '30days',
      providerLabel: 'All providers',
      projectScopeActive: true,
      projectScopeName: 'Secret launch repo',
    })

    expect(card.schemaVersion).toBe('metrora.share-card.v1')
    expect(card.metrics.costUSD).toBeNull()
    expect(card.pricingCoverage).toBeNull()
    expect(card.projectScope).toEqual({ active: true, name: null })
    expect(card.metrics.calls).toBe(1234)
    expect(card.metrics.sessions).toBe(48)
    expect(card.topModel).toEqual({ name: 'gpt-5.6-sol', calls: 812 })
  })

  it('discloses optional sensitive aggregates only after explicit selection', () => {
    const card = buildShareCardV1({
      payload: payload(),
      period: 'week',
      providerLabel: 'Codex',
      projectScopeActive: true,
      projectScopeName: 'Launch & growth',
      includeProjectName: true,
      includeCost: true,
    })

    expect(card.metrics.costUSD).toBe(67.89)
    expect(card.pricingCoverage).toBe(0.82)
    expect(card.projectScope.name).toBe('Launch & growth')
  })

  it('keeps custom ranges explicit and marks degraded evidence', () => {
    const card = buildShareCardV1({
      payload: payload({}, 'degraded'),
      period: '30days',
      range: { from: '2026-08-01', to: '2026-08-25' },
      providerLabel: 'All providers',
    })

    expect(card.periodLabel).toBe('2026-08-01 – 2026-08-25')
    expect(card.dataState).toBe('partial')
    expect(shareCardPeriodLabel('week')).toBe('Last 7 days')
  })

  it('fails closed instead of exporting non-finite or negative evidence', () => {
    expect(() => buildShareCardV1({
      payload: payload({ calls: Number.NaN }),
      period: 'week',
      providerLabel: 'All providers',
    })).toThrow(/call-count evidence is invalid/u)

    expect(() => buildShareCardV1({
      payload: payload({ cost: Number.POSITIVE_INFINITY }),
      period: 'week',
      providerLabel: 'All providers',
      includeCost: true,
    })).toThrow(/cost evidence is invalid/u)

    expect(() => buildShareCardV1({
      payload: payload({ sessions: -1 }),
      period: 'week',
      providerLabel: 'All providers',
    })).toThrow(/session-count evidence is invalid/u)
  })
})

describe('ShareCardV1 SVG renderer', () => {
  it('escapes user-controlled labels and carries stable Metrora attribution', () => {
    const card = buildShareCardV1({
      payload: payload({ topModels: [{ name: '<model>&"', calls: 4, cost: 1, savingsUSD: 0, savingsBaselineModel: '' }] }),
      period: 'week',
      providerLabel: 'Provider <unsafe>',
      projectScopeActive: true,
      projectScopeName: 'Project & <private>',
      includeProjectName: true,
      includeCost: true,
    })
    const svg = renderShareCardSvg(card)

    expect(svg).toContain('Provider &lt;unsafe&gt;')
    expect(svg).toContain('Project: Project &amp; &lt;private&gt;')
    expect(svg).toContain('&lt;model&gt;&amp;&quot;')
    expect(svg).not.toContain('<unsafe>')
    expect(svg).toContain('Metrora · metrora.eu')
    expect(svg).toContain('Spend (USD)')
    expect(svg).toContain('82% of cost-bearing calls priced')
  })
})
