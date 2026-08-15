import { describe, expect, it } from 'vitest'

import { withProjectDetailCoverage } from '../src/project-coverage.js'
import type { DailyEntry } from '../src/daily-cache.js'
import type { PeriodData } from '../src/menubar-json.js'

function day(date: string, detailed: boolean): DailyEntry {
  return {
    date,
    cost: 10,
    savingsUSD: 0,
    calls: 4,
    sessions: 1,
    inputTokens: detailed ? 100 : 0,
    outputTokens: detailed ? 50 : 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: detailed ? { 'claude-opus-4-6': { calls: 4, cost: 10, savingsUSD: 0, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } } : {},
    categories: detailed ? { build: { turns: 4, cost: 10, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 } } : {},
    providers: {},
    projects: { metrora: { cost: 10, calls: 4, sessions: 1, savingsUSD: 0, path: '/work/metrora' } },
  }
}

const period = { label: 'This month', cost: 10, calls: 4, sessions: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, categories: {}, models: [], topModels: [] } as unknown as PeriodData

describe('Project historical detail coverage', () => {
  it('reports partial coverage when live detail exists but historical detail is absent', () => {
    const result = withProjectDetailCoverage(period, [day('2026-08-13', false), day('2026-08-14', true)], true, '2026-08-14')

    expect(result.cost).toBe(10)
    expect(result.calls).toBe(4)
    expect(result.projectDetailCoverage).toEqual({ models: 'partial', tokens: 'partial', categories: 'partial', historical: true })
  })

  it('reports unavailable rather than factual zero or full coverage when all durable detail is missing', () => {
    const result = withProjectDetailCoverage(period, [day('2026-08-13', false)], true, '2026-08-14')

    expect(result.cost).toBe(10)
    expect(result.projectDetailCoverage).toEqual({ models: 'unavailable', tokens: 'unavailable', categories: 'unavailable', historical: true })
  })
})
