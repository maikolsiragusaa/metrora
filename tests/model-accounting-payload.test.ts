import { describe, expect, it } from 'vitest'

import { buildMenubarPayload, type PeriodData } from '../src/menubar-json.js'

function period(models: PeriodData['models'], cost: number, calls: number): PeriodData {
  return {
    label: 'Lifetime',
    cost,
    savingsUSD: 0,
    calls,
    sessions: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    categories: [],
    models,
  }
}

describe('model accounting payload', () => {
  it('keeps the presentation top-20 bounded while exposing every attributable model', () => {
    const models = Array.from({ length: 30 }, (_, index) => ({
      name: `model-${index}`,
      cost: 30 - index,
      savingsUSD: 0,
      calls: index + 1,
    }))
    const totalCost = models.reduce((sum, model) => sum + model.cost, 0)
    const totalCalls = models.reduce((sum, model) => sum + model.calls, 0)

    const payload = buildMenubarPayload(period(models, totalCost, totalCalls), [], null)

    expect(payload.current.topModels).toHaveLength(20)
    expect(payload.current.modelAccounting?.rows).toHaveLength(30)
    expect(payload.current.modelAccounting?.gap).toEqual({ cost: 0, savingsUSD: 0, calls: 0 })
    expect(payload.current.modelAccounting?.coverage).toEqual({ cost: 1, calls: 1 })
    expect(payload.current.modelAccounting?.tokenCoverage).toEqual({ cost: 0, calls: 0 })
    expect(payload.current.modelAccounting?.rows.every(row => row.tokenDetail === false)).toBe(true)
  })

  it('turns durable usage without a provable model id into an explicit gap', () => {
    const payload = buildMenubarPayload(period([
      { name: 'gpt-5.4', cost: 40, savingsUSD: 0, calls: 4 },
      { name: '<synthetic>', cost: 10, savingsUSD: 0, calls: 2 },
    ], 50, 6), [], null)

    expect(payload.current.modelAccounting?.rows).toEqual([
      {
        name: 'GPT-5.4',
        cost: 40,
        savingsUSD: 0,
        calls: 4,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        tokenDetail: false,
      },
    ])
    expect(payload.current.modelAccounting?.gap).toEqual({ cost: 10, savingsUSD: 0, calls: 2 })
    expect(payload.current.modelAccounting?.coverage.cost).toBeCloseTo(0.8)
    expect(payload.current.modelAccounting?.coverage.calls).toBeCloseTo(4 / 6)
  })

  it('uses the same display-name merging rules for full accounting and top models', () => {
    const payload = buildMenubarPayload(period([
      { name: 'k3', cost: 2.5, savingsUSD: 0, calls: 78 },
      { name: 'kimi-k3', cost: 0.5, savingsUSD: 0, calls: 2 },
      { name: 'k3-agent', cost: 1.2, savingsUSD: 0, calls: 40 },
    ], 4.2, 120), [], null)

    expect(payload.current.modelAccounting?.rows).toEqual([
      {
        name: 'Kimi K3',
        cost: 4.2,
        savingsUSD: 0,
        calls: 120,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        tokenDetail: false,
      },
    ])
    expect(payload.current.modelAccounting?.gap.cost).toBe(0)
  })

  it('preserves and merges durable token detail plus observed timing when the period authority carries it', () => {
    const payload = buildMenubarPayload(period([
      {
        name: 'gpt-5.4',
        cost: 10,
        savingsUSD: 0,
        calls: 2,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
        activeDurationMs: 1000,
        activeGeneratedTokens: 2000,
      },
      {
        name: 'gpt-5.4',
        cost: 5,
        savingsUSD: 0,
        calls: 1,
        inputTokens: 50,
        outputTokens: 10,
        cacheReadTokens: 450,
        cacheWriteTokens: 25,
        activeDurationMs: 500,
        activeGeneratedTokens: 1000,
      },
    ], 15, 3), [], null)

    expect(payload.current.modelAccounting?.rows).toEqual([
      {
        name: 'GPT-5.4',
        cost: 15,
        savingsUSD: 0,
        calls: 3,
        inputTokens: 150,
        outputTokens: 30,
        cacheReadTokens: 1350,
        cacheWriteTokens: 75,
        tokenDetail: true,
        activeDurationMs: 1500,
        activeGeneratedTokens: 3000,
      },
    ])
    expect(payload.current.modelAccounting?.tokenCoverage).toEqual({ cost: 1, calls: 1 })
  })

  it('omits timing fields rather than fabricating zero-speed evidence', () => {
    const payload = buildMenubarPayload(period([
      {
        name: 'gpt-5.4',
        cost: 10,
        savingsUSD: 0,
        calls: 2,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
      },
    ], 10, 2), [], null)

    expect(payload.current.modelAccounting?.rows[0]).not.toHaveProperty('activeDurationMs')
    expect(payload.current.modelAccounting?.rows[0]).not.toHaveProperty('activeGeneratedTokens')
  })

  it('marks merged token detail unavailable when any contributing row lacks its split', () => {
    const payload = buildMenubarPayload(period([
      {
        name: 'gpt-5.4',
        cost: 10,
        savingsUSD: 0,
        calls: 2,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
      },
      { name: 'gpt-5.4', cost: 5, savingsUSD: 0, calls: 1 },
    ], 15, 3), [], null)

    expect(payload.current.modelAccounting?.rows[0]?.tokenDetail).toBe(false)
    expect(payload.current.modelAccounting?.tokenCoverage).toEqual({ cost: 0, calls: 0 })
  })
})