import { describe, expect, it } from 'vitest'

import type { DailyHistoryEntry, MenubarPayload } from '../lib/types'
import { deriveEfficiency } from './overviewEfficiency'
import { aggregateModels, buildModelIndex, sessionModelKey, topModelsToAggregated } from './overviewModels'
import { deriveSignals, deriveStats } from './overviewTrends'
import { formatWorkflowDuration, workflowCoachingNote } from './overviewWorkflow'

function day(date: string, cost: number): DailyHistoryEntry {
  return { date, cost, savingsUSD: 0, calls: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, topModels: [] }
}

function current(overrides: Partial<MenubarPayload['current']> = {}): MenubarPayload['current'] {
  return {
    cost: 100,
    oneShotRate: 0.6,
    cacheHitPercent: 50,
    retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
    localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
    topProjects: [],
    topModels: [],
    ...overrides,
  } as MenubarPayload['current']
}

function payload(now: Date, daily: DailyHistoryEntry[], currentOverrides: Partial<MenubarPayload['current']> = {}): MenubarPayload {
  return {
    generated: now.toISOString(),
    current: current(currentOverrides),
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: { daily },
  } as MenubarPayload
}

describe('Overview derivations', () => {
  it('preserves the neutral one-shot efficiency assumption and grade thresholds', () => {
    const result = deriveEfficiency(current({ oneShotRate: null }))
    expect(result.oneShot).toBe(0.6)
    expect(result.score).toBeCloseTo(67)
    expect(result.grade).toBe('C')
    expect(result.gradeTone).toBe('grade-bc')
  })

  it('keeps workflow coaching priority and duration formatting deterministic', () => {
    expect(workflowCoachingNote({
      correctionRate: 0.2,
      corrections: 4,
      medianTimeToFirstEditMs: 600_000,
    }, { path: 'src/app.ts', sessions: 5, edits: 12 })).toContain('20% of prompts (4 times)')
    expect(formatWorkflowDuration(59_000)).toBe('59s')
    expect(formatWorkflowDuration(300_000)).toBe('5m')
  })

  it('derives month pace and projection from the same daily authority', () => {
    const now = new Date(2026, 7, 4)
    const data = payload(now, [
      day('2026-07-01', 1), day('2026-07-02', 3),
      day('2026-08-01', 2), day('2026-08-02', 4), day('2026-08-03', 6), day('2026-08-04', 8),
    ])
    const stats = deriveStats(data, now)
    expect(stats.mtd).toBe(20)
    expect(stats.projected).toBe(114.5)
    expect(stats.pacePct).toBe(150)
    expect(stats.prevMonthName).toBe('July')
  })

  it('suppresses prior-window signals for a custom range without changing standard periods', () => {
    const now = new Date(2026, 7, 14)
    const daily = Array.from({ length: 14 }, (_, index) => day(
      `2026-08-${String(index + 1).padStart(2, '0')}`,
      index < 7 ? 1 : 2,
    ))
    const data = payload(now, daily)
    expect(deriveSignals(data, now, false).risks.some(signal => signal.text.includes('Spend up 100%'))).toBe(true)
    expect(deriveSignals(data, now, true).risks.some(signal => signal.text.includes('Spend up 100%'))).toBe(false)
  })

  it('keeps model aggregation and session model lookup as pure projections', () => {
    const daily = [day('2026-08-01', 3), day('2026-08-02', 5)]
    daily[0].topModels = [{ name: 'model-a', cost: 3, savingsUSD: 0, calls: 2, inputTokens: 10, outputTokens: 4 }]
    daily[1].topModels = [{ name: 'model-a', cost: 5, savingsUSD: 0, calls: 3, inputTokens: 20, outputTokens: 6 }]
    expect(aggregateModels(daily)).toEqual([{ name: 'model-a', cost: 8, calls: 5, inputTokens: 30, outputTokens: 10 }])
    expect(topModelsToAggregated([{ name: 'model-b', cost: 7, savingsUSD: 0, savingsBaselineModel: '', calls: 4 }])).toEqual([
      { name: 'model-b', cost: 7, calls: 4 },
    ])

    const data = payload(new Date(2026, 7, 2), daily, {
      topProjects: [{
        name: 'project-a', cost: 7, savingsUSD: 0, sessions: 1, avgCostPerSession: 7,
        sessionDetails: [{
          date: '2026-08-02', calls: 4, cost: 7, savingsUSD: 0, inputTokens: 0, outputTokens: 0,
          models: [{ name: 'model-b', cost: 7, savingsUSD: 0 }],
        }],
      }],
    })
    expect(buildModelIndex(data).get(sessionModelKey('project-a', '2026-08-02', 4, 7))).toBe('model-b')
  })
})
