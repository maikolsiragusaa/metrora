import { describe, expect, it } from 'vitest'

import type { DailyHistoryEntry, MenubarPayload, YieldJsonReport } from '../lib/types'
import { deriveEfficiency } from './overviewEfficiency'
import { aggregateModels, buildModelIndex, modelAccountingToAggregated, OTHER_MODELS_HISTORY_GAP, sessionModelKey, topModelsToAggregated } from './overviewModels'
import { deriveCostPerOutcome } from './overviewOutcome'
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

  it('keeps outcome costs tied to the yield report without inventing zero denominators', () => {
    const report = {
      summary: {
        productive: { costUSD: 120, sessions: 3, costPercent: 80, sessionPercent: 60 },
        reverted: { costUSD: 20, sessions: 1, costPercent: 13, sessionPercent: 20 },
        abandoned: { costUSD: 10, sessions: 1, costPercent: 7, sessionPercent: 20 },
        total: { costUSD: 150, sessions: 5 },
        productiveToRevertedCostRatio: 6,
      },
      details: [
        { sessionId: 's1', project: 'one', category: 'productive', commitCount: 4, costUSD: 80 },
        { sessionId: 's2', project: 'two', category: 'productive', commitCount: 2, costUSD: 40 },
      ],
    } as YieldJsonReport

    expect(deriveCostPerOutcome(report)).toEqual({
      costPerCommit: 25,
      costPerProductiveSession: 40,
      productivePercent: 80,
      revertedPercent: 13,
      abandonedPercent: 7,
    })
    report.details = []
    report.summary.productive.sessions = 0
    expect(deriveCostPerOutcome(report).costPerCommit).toBeNull()
    expect(deriveCostPerOutcome(report).costPerProductiveSession).toBeNull()
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

  it('prefers the complete current model accounting over presentation-sized top models', () => {
    const value = current({
      cost: 12,
      calls: 12,
      topModels: [{ name: 'model-a', cost: 10, savingsUSD: 0, savingsBaselineModel: '', calls: 10 }],
    })
    ;(value as MenubarPayload['current'] & { modelAccounting: unknown }).modelAccounting = {
      rows: [
        { name: 'model-a', cost: 10, savingsUSD: 0, calls: 10 },
        { name: 'model-b', cost: 1.5, savingsUSD: 0, calls: 1 },
      ],
      gap: { cost: 0.5, savingsUSD: 0, calls: 1 },
      coverage: { cost: 0.958333, calls: 0.916667 },
    }

    const rows = modelAccountingToAggregated(value)
    expect(rows).toEqual([
      { name: 'model-a', cost: 10, calls: 10 },
      { name: 'model-b', cost: 1.5, calls: 1 },
      { name: OTHER_MODELS_HISTORY_GAP, cost: 0.5, calls: 1 },
    ])
    expect(rows?.reduce((sum, row) => sum + row.cost, 0)).toBe(12)
    expect(rows?.reduce((sum, row) => sum + row.calls, 0)).toBe(12)
  })

  it('never lets daily top-N truncation silently reduce model accounting', () => {
    const truncated: DailyHistoryEntry = {
      date: '2026-08-01',
      cost: 12,
      savingsUSD: 0,
      calls: 12,
      inputTokens: 120,
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      topModels: [
        { name: 'model-a', cost: 10, savingsUSD: 0, calls: 10, inputTokens: 100, outputTokens: 50 },
      ],
    }

    const rows = aggregateModels([truncated])
    expect(rows).toEqual([
      { name: 'model-a', cost: 10, calls: 10, inputTokens: 100, outputTokens: 50 },
      { name: OTHER_MODELS_HISTORY_GAP, cost: 2, calls: 2, inputTokens: 20, outputTokens: 10 },
    ])
    expect(rows.reduce((sum, row) => sum + row.cost, 0)).toBe(12)
    expect(rows.reduce((sum, row) => sum + row.calls, 0)).toBe(12)
  })
})
