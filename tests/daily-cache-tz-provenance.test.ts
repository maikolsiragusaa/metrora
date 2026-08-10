import { describe, expect, it } from 'vitest'

import { mergeTimezoneRebucketedDays } from '../src/daily-cache-tz-reconcile.js'
import type { DailyEntry, ModelDayStats, ProviderDaySlice } from '../src/daily-cache.js'

const MODEL = 'shared-model'

function model(provider: string, cost: number, input: number): ModelDayStats {
  return {
    calls: 1,
    cost,
    savingsUSD: 0,
    inputTokens: input,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sourceProviders: [provider],
  }
}

function slice(provider: string, cost: number, input: number): ProviderDaySlice {
  return {
    calls: 1,
    cost,
    savingsUSD: 0,
    sessions: 1,
    inputTokens: input,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: { [MODEL]: model(provider, cost, input) },
    categories: {},
  }
}

function singleProviderDay(date: string, provider: string, providerSlice: ProviderDaySlice): DailyEntry {
  return {
    date,
    cost: providerSlice.cost,
    savingsUSD: 0,
    calls: providerSlice.calls,
    sessions: providerSlice.sessions ?? 0,
    inputTokens: providerSlice.inputTokens ?? 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: structuredClone(providerSlice.models ?? {}),
    categories: {},
    providers: { [provider]: structuredClone(providerSlice) },
  }
}

describe('timezone carry model provenance', () => {
  it('removes a source provider when its whole model contribution rebuckets away', () => {
    const copilot = slice('copilot', 10, 40)
    const codex = slice('codex', 20, 60)
    const baseline: DailyEntry = {
      date: '2026-08-10',
      cost: 30,
      savingsUSD: 0,
      calls: 2,
      sessions: 2,
      inputTokens: 100,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: {
        [MODEL]: {
          calls: 2,
          cost: 30,
          savingsUSD: 0,
          inputTokens: 100,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          sourceProviders: ['codex', 'copilot'],
        },
      },
      categories: {},
      providers: {
        copilot: structuredClone(copilot),
        codex: structuredClone(codex),
      },
      carried: true,
    }

    const result = mergeTimezoneRebucketedDays(
      [singleProviderDay('2026-08-11', 'copilot', copilot)],
      [baseline],
      [singleProviderDay('2026-08-10', 'copilot', copilot)],
    )

    const oldDay = result.find(day => day.date === '2026-08-10')!
    expect(oldDay.models[MODEL]?.sourceProviders).toEqual(['codex'])
    expect(oldDay.models[MODEL]).toMatchObject({ calls: 1, cost: 20, inputTokens: 60 })
    expect(oldDay.providers.copilot).toBeUndefined()
    expect(oldDay.providers.codex?.calls).toBe(1)
  })
})
