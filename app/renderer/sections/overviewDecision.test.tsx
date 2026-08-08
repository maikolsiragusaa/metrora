// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { OverviewHomeSummary } from './OverviewHomeSummary'
import { deriveOverviewDecision } from './overviewDecision'
import type { SignalGroups } from './overviewTrends'

vi.mock('../lib/motion', () => ({ motionEnabled: () => false }))

const noSignals: SignalGroups = { wins: [], improvements: [], risks: [] }

function payload(overrides: Partial<MenubarPayload['current']> = {}): MenubarPayload {
  return {
    generated: '2026-08-04T10:00:00.000Z',
    current: {
      label: 'Last 30 days',
      cost: 100,
      calls: 40,
      sessions: 8,
      oneShotRate: 0.7,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitPercent: 70,
      codexCredits: 0,
      topActivities: [{ name: 'debugging', cost: 55, savingsUSD: 0, turns: 10, oneShotRate: 0.5 }],
      topModels: [{ name: 'model-a', cost: 35, savingsUSD: 0, savingsBaselineModel: '', calls: 20 }],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      topProjects: [{ name: 'project-a', cost: 45, savingsUSD: 0, sessions: 2, avgCostPerSession: 22.5, sessionDetails: [] }],
      modelEfficiency: [],
      topSessions: [],
      pricingCoverage: 1,
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [], skills: [], subagents: [], mcpServers: [],
      ...overrides,
    },
    optimize: { findingCount: 1, savingsUSD: 12, topFindings: [] },
    history: {
      daily: Array.from({ length: 14 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, '0')}`,
        cost: index < 7 ? 5 : 10,
        savingsUSD: 0,
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        topModels: [],
      })),
    },
  } as MenubarPayload
}

describe('decision-led Home', () => {
  it('suppresses automatic comparison for a custom range', () => {
    const decision = deriveOverviewDecision(payload(), noSignals, true)
    expect(decision.comparison.value).toBe('Custom range')
    expect(decision.comparison.detail).toContain('suppressed')
  })

  it('selects the largest canonical driver without recomputing rankings', () => {
    const decision = deriveOverviewDecision(payload(), noSignals, false)
    expect(decision.driver.value).toBe('debugging')
    expect(decision.driver.detail).toContain('Activity · $55.00 · 55% of spend')
    expect(decision.driver.target).toBe('sessions')
  })

  it('keeps missing and partial pricing coverage explicit', () => {
    expect(deriveOverviewDecision(payload({ pricingCoverage: undefined }), noSignals, false).quality.value).toBe('Coverage unknown')
    expect(deriveOverviewDecision(payload({ pricingCoverage: 0.84 }), noSignals, false).warning.value).toBe('84% priced')
  })

  it('prioritizes an existing optimization report as the safe action', () => {
    const decision = deriveOverviewDecision(payload(), noSignals, false)
    expect(decision.nextAction.value).toBe('Review recoverable spend')
    expect(decision.nextAction.target).toBe('optimize')
  })

  it('renders one decision summary and routes driver and primary action explicitly', () => {
    const data = payload()
    const decision = deriveOverviewDecision(data, noSignals, false)
    const onNavigate = vi.fn()
    render(
      <div className="ov-home-shell">
        <OverviewHomeSummary
          current={data.current}
          decision={decision}
          streak={4}
          saved={6}
          applied={2}
          localSaved={0}
          animateKey="30days|all"
          onNavigate={onNavigate}
        />
      </div>,
    )

    expect(screen.getByLabelText('What changed and what matters next')).toBeInTheDocument()
    expect(screen.getByText('100% higher')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Top driver: debugging/i }))
    expect(onNavigate).toHaveBeenLastCalledWith('sessions')
    fireEvent.click(screen.getByRole('button', { name: 'Open report →' }))
    expect(onNavigate).toHaveBeenLastCalledWith('optimize')
  })
})
