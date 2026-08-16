import { describe, expect, it } from 'vitest'

import { mergeTimezoneRebucketedDays } from '../src/daily-cache-tz-reconcile.js'
import type {
  CategoryDayStats,
  DailyEntry,
  ModelDayStats,
  ProjectDayStats,
  ProviderDaySlice,
} from '../src/daily-cache.js'

const MODEL = 'model-a'
const CATEGORY = 'coding'
const PROJECT = 'metrora'

function model(
  calls: number,
  cost: number,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
): ModelDayStats {
  return {
    calls,
    cost,
    savingsUSD: 0,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelProvider: 'openai',
    sourceProviders: ['copilot'],
  }
}

function category(turns: number, cost: number): CategoryDayStats {
  return { turns, cost, savingsUSD: 0, editTurns: turns, oneShotTurns: turns }
}

function project(
  calls: number,
  cost: number,
  sessions: number,
  tokens: { inputTokens: number; outputTokens: number; reasoningTokens: number } = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
): ProjectDayStats {
  return {
    calls,
    cost,
    savingsUSD: 0,
    sessions,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    reasoningTokens: tokens.reasoningTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    path: 'C:/work/metrora',
  }
}

function slice(opts: {
  calls: number
  cost: number
  sessions: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  turns?: number
}): ProviderDaySlice {
  const turns = opts.turns ?? opts.calls
  return {
    calls: opts.calls,
    cost: opts.cost,
    savingsUSD: 0,
    sessions: opts.sessions,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    reasoningTokens: opts.reasoningTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: turns,
    oneShotTurns: turns,
    models: { [MODEL]: model(opts.calls, opts.cost, opts.inputTokens, opts.outputTokens, opts.reasoningTokens) },
    categories: { [CATEGORY]: category(turns, opts.cost) },
    projects: {
      [PROJECT]: project(opts.calls, opts.cost, opts.sessions, {
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        reasoningTokens: opts.reasoningTokens,
      }),
    },
  }
}

function day(date: string, providerSlice: ProviderDaySlice): DailyEntry {
  return {
    date,
    cost: providerSlice.cost,
    savingsUSD: providerSlice.savingsUSD,
    calls: providerSlice.calls,
    sessions: providerSlice.sessions ?? 0,
    inputTokens: providerSlice.inputTokens ?? 0,
    outputTokens: providerSlice.outputTokens ?? 0,
    reasoningTokens: providerSlice.reasoningTokens ?? 0,
    cacheReadTokens: providerSlice.cacheReadTokens ?? 0,
    cacheWriteTokens: providerSlice.cacheWriteTokens ?? 0,
    editTurns: providerSlice.editTurns ?? 0,
    oneShotTurns: providerSlice.oneShotTurns ?? 0,
    models: structuredClone(providerSlice.models ?? {}),
    categories: structuredClone(providerSlice.categories ?? {}),
    projects: structuredClone(providerSlice.projects ?? {}),
    providers: { copilot: structuredClone(providerSlice) },
  }
}

describe('timezone carry reconciliation', () => {
  it('drops an old-day slice fully explained by the same fresh evidence under the old timezone', () => {
    const moved = slice({
      calls: 1,
      cost: 10,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 7,
    })

    const result = mergeTimezoneRebucketedDays(
      [day('2026-08-11', moved)],
      [{ ...day('2026-08-10', moved), carried: true }],
      [day('2026-08-10', moved)],
    )

    expect(result.map(entry => entry.date)).toEqual(['2026-08-11'])
    expect(result[0]?.calls).toBe(1)
    expect(result[0]?.inputTokens).toBe(100)
    expect(result[0]?.reasoningTokens).toBe(7)
  })

  it('keeps only source-gone residual history and preserves Metrora model provenance', () => {
    const baseline = slice({
      calls: 2,
      cost: 30,
      sessions: 2,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 10,
      turns: 2,
    })
    const surviving = slice({
      calls: 1,
      cost: 10,
      sessions: 1,
      inputTokens: 40,
      outputTokens: 8,
      reasoningTokens: 4,
      turns: 1,
    })

    const result = mergeTimezoneRebucketedDays(
      [day('2026-08-11', surviving)],
      [{ ...day('2026-08-10', baseline), carried: true }],
      [day('2026-08-10', surviving)],
    )

    expect(result).toHaveLength(2)
    const residual = result.find(entry => entry.date === '2026-08-10')!
    const fresh = result.find(entry => entry.date === '2026-08-11')!

    expect(residual.calls).toBe(1)
    expect(residual.cost).toBe(20)
    expect(residual.inputTokens).toBe(60)
    expect(residual.outputTokens).toBe(12)
    expect(residual.reasoningTokens).toBe(6)
    expect(residual.providers.copilot?.reasoningTokens).toBe(6)
    expect(residual.models[MODEL]).toMatchObject({
      calls: 1,
      cost: 20,
      inputTokens: 60,
      outputTokens: 12,
      reasoningTokens: 6,
      modelProvider: 'openai',
      sourceProviders: ['copilot'],
    })
    expect(residual.projects?.[PROJECT]).toMatchObject({
      calls: 1,
      cost: 20,
      sessions: 1,
      inputTokens: 60,
      outputTokens: 12,
      reasoningTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      path: 'C:/work/metrora',
    })

    expect(residual.calls + fresh.calls).toBe(2)
    expect(residual.inputTokens + fresh.inputTokens).toBe(100)
    expect((residual.reasoningTokens ?? 0) + (fresh.reasoningTokens ?? 0)).toBe(10)
  })

  it('adds distinct residual sessions instead of max-clamping them against a fresh placeholder', () => {
    const baseline = slice({
      calls: 1,
      cost: 10,
      sessions: 2,
      inputTokens: 40,
      outputTokens: 8,
      reasoningTokens: 4,
      turns: 1,
    })
    const explained = slice({
      calls: 1,
      cost: 10,
      sessions: 1,
      inputTokens: 40,
      outputTokens: 8,
      reasoningTokens: 4,
      turns: 1,
    })
    const placeholder: ProviderDaySlice = {
      calls: 0,
      cost: 0,
      savingsUSD: 0,
      sessions: 1,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: {},
      categories: {},
      projects: { [PROJECT]: project(0, 0, 1) },
    }

    const result = mergeTimezoneRebucketedDays(
      [day('2026-08-10', placeholder)],
      [{ ...day('2026-08-10', baseline), carried: true }],
      [day('2026-08-10', explained)],
    )

    const merged = result[0]!
    expect(merged.calls).toBe(0)
    expect(merged.sessions).toBe(2)
    expect(merged.providers.copilot?.sessions).toBe(2)
    expect(merged.projects?.[PROJECT]?.sessions).toBe(2)
  })
})
