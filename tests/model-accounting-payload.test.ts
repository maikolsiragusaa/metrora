import { describe, expect, it } from 'vitest'

import { buildPeriodDataFromDays } from '../src/day-aggregator.js'
import { buildMenubarPayload, type PeriodData } from '../src/menubar-json.js'
import { buildModelAccounting } from '../src/model-accounting.js'
import { buildModelPresentation } from '../src/model-presentation.js'

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
        timingCoverage: 'observed',
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

  it('preserves free routes, economic variants, and source-recorded routes', () => {
    const models = [
      {
        name: 'deepseek-v4-flash',
        modelProvider: 'opencode-go',
        sourceProviders: ['opencode'],
        cost: 2,
        savingsUSD: 0,
        calls: 10,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 300,
        cacheWriteTokens: 0,
      },
      {
        name: 'deepseek-v4-flash-free',
        modelProvider: 'opencode',
        sourceProviders: ['opencode'],
        cost: 0,
        savingsUSD: 0,
        calls: 4,
        inputTokens: 40,
        outputTokens: 8,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
      },
      {
        name: 'gemini-3.1-pro-high',
        modelProvider: 'google',
        sourceProviders: ['antigravity'],
        cost: 3,
        savingsUSD: 0,
        calls: 5,
        inputTokens: 50,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      {
        name: 'gemini-3.1-pro-low',
        modelProvider: 'google',
        sourceProviders: ['antigravity'],
        cost: 1,
        savingsUSD: 0,
        calls: 2,
        inputTokens: 20,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]
    const payload = buildMenubarPayload(period(models, 6, 21), [], null)
    const rows = payload.current.modelAccounting?.rows ?? []

    expect(rows.map(row => row.name)).toEqual(expect.arrayContaining([
      'DeepSeek v4 Flash',
      'DeepSeek v4 Flash (free)',
      'Gemini 3.1 Pro (high)',
      'Gemini 3.1 Pro (low)',
    ]))
    expect(rows.find(row => row.name === 'DeepSeek v4 Flash (free)')).toMatchObject({
      provider: 'opencode',
      calls: 4,
      cost: 0,
      rawModels: ['deepseek-v4-flash-free'],
      semanticVariant: 'free',
    })
    expect(payload.current.modelAccounting?.gap).toEqual({ cost: 0, savingsUSD: 0, calls: 0 })
    expect(payload.current.modelAccounting?.coverage).toEqual({ cost: 1, calls: 1 })
  })

  it('emits canonical model brands separately from factual delivery routes', () => {
    const payload = buildMenubarPayload(period([
      {
        name: 'gpt-5.4',
        modelProvider: 'openai',
        sourceProviders: ['codex'],
        cost: 4,
        savingsUSD: 0,
        calls: 4,
      },
      {
        name: 'claude-sonnet-4-6',
        modelProvider: 'amazon-bedrock',
        sourceProviders: ['opencode'],
        cost: 3,
        savingsUSD: 0,
        calls: 3,
      },
      {
        name: 'claude-sonnet-4-6',
        modelProvider: 'api_provider_anthropic',
        sourceProviders: ['claude'],
        cost: 2,
        savingsUSD: 0,
        calls: 2,
      },
      {
        name: 'ambiguous-model',
        modelProvider: 'openai',
        sourceProviders: ['codex'],
        cost: 1,
        savingsUSD: 0,
        calls: 1,
      },
    ], 10, 10), [], null)

    const rows = payload.current.modelAccounting?.rows ?? []
    expect(rows.find(row => row.provider === 'openai' && row.name === 'GPT-5.4')).toMatchObject({
      provider: 'openai',
      brandId: 'openai',
    })
    expect(rows.find(row => row.provider === 'amazon-bedrock')).toMatchObject({
      provider: 'amazon-bedrock',
      brandId: 'anthropic',
    })
    expect(rows.find(row => row.provider === 'api_provider_anthropic')).toMatchObject({
      provider: 'api_provider_anthropic',
      brandId: 'anthropic',
    })
    expect(rows.find(row => row.provider === 'openai' && row.calls === 1)).not.toHaveProperty('brandId')

    expect(payload.current.topModels.find(model => model.providerId === 'openai')).toMatchObject({ brandId: 'openai' })
    expect(payload.current.topModels.find(model => model.providerId === 'amazon-bedrock')).toMatchObject({ brandId: 'anthropic' })
  })

  it('emits observed DeepSeek, Qwen and Moonshot brands from canonical identities', () => {
    const payload = buildMenubarPayload(period([
      {
        name: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        sourceProviders: ['opencode'],
        cost: 3,
        savingsUSD: 0,
        calls: 3,
      },
      {
        name: 'qwen3.7-plus',
        modelProvider: 'qwen',
        sourceProviders: ['qwen'],
        cost: 2,
        savingsUSD: 0,
        calls: 2,
      },
      {
        name: 'moonshotai/kimi-k2.6',
        modelProvider: 'moonshotai',
        sourceProviders: ['kimi'],
        cost: 1,
        savingsUSD: 0,
        calls: 1,
      },
    ], 6, 6), [], null)

    expect(payload.current.modelAccounting?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'DeepSeek v4 Flash', provider: 'deepseek', brandId: 'deepseek' }),
      expect.objectContaining({ name: 'qwen3.7-plus', provider: 'qwen', brandId: 'qwen' }),
      expect.objectContaining({ name: 'Kimi K2.6', provider: 'moonshotai', brandId: 'moonshot' }),
    ]))
  })

  it('preserves duplicate display rows when one route is unavailable', () => {
    const payload = buildMenubarPayload(period([
      {
        name: 'claude-opus-4-6',
        modelProvider: 'anthropic',
        sourceProviders: ['claude'],
        cost: 3,
        savingsUSD: 0,
        calls: 3,
      },
      {
        name: 'claude-opus-4-6',
        sourceProviders: ['other-collector'],
        cost: 2,
        savingsUSD: 0,
        calls: 2,
      },
    ], 5, 5), [], null)

    const rows = payload.current.modelAccounting?.rows ?? []
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.name)).toEqual(['Opus 4.6', 'Opus 4.6'])
    expect(rows.map(row => row.provider)).toEqual(['anthropic', undefined])
    expect(rows.map(row => row.brandId)).toEqual(['anthropic', 'anthropic'])
  })

  it('does not treat an unclassified reasoning field as separately reported', () => {
    const payload = buildMenubarPayload(period([{
      name: 'gpt-5.4',
      modelProvider: 'zed.dev',
      sourceProviders: ['zed'],
      cost: 1,
      savingsUSD: 0,
      calls: 1,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 99,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }], 1, 1), [], null)

    const row = payload.current.modelAccounting?.rows[0]!
    expect(row).not.toHaveProperty('reasoningTokens')
    expect(row).not.toHaveProperty('reasoningSemantics')
    expect(payload.current.modelPresentation?.rows[0]).toMatchObject({ reasoningSemantics: 'unavailable' })
  })

  it('retains exact reasoning evidence from a carried mixed-source durable row once, without a schema change', () => {
    const day = {
      date: '2026-08-01',
      carried: true,
      cost: 12,
      savingsUSD: 0,
      calls: 2,
      sessions: 1,
      inputTokens: 1_000,
      outputTokens: 2_000,
      reasoningTokens: 57_133,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: {
        'Sonnet 4.6': {
          calls: 2,
          cost: 12,
          savingsUSD: 0,
          inputTokens: 1_000,
          outputTokens: 2_000,
          reasoningTokens: 57_133,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          sourceProviders: ['antigravity', 'claude'],
        },
      },
      categories: {},
      providers: {},
    } satisfies Parameters<typeof buildPeriodDataFromDays>[0][number]

    const period = buildPeriodDataFromDays([day], 'carried')
    const accounting = buildModelAccounting(period.models, period.cost, period.calls)
    const presentation = buildModelPresentation(accounting)

    expect(period.models[0]).toMatchObject({ reasoningTokens: 57_133, sourceProviders: ['antigravity', 'claude'] })
    expect(accounting.rows).toHaveLength(1)
    expect(accounting.rows[0]).toMatchObject({
      reasoningTokens: 57_133,
      additiveReasoningTokens: 0,
      reasoningSemantics: 'mixed',
    })
    expect(presentation.rows).toHaveLength(1)
    expect(presentation.rows[0]).toMatchObject({
      reasoningTokens: 57_133,
      additiveReasoningTokens: 0,
      reasoningSemantics: 'mixed',
      deliveryRows: [accounting.rows[0]],
    })
    expect(presentation.rows.reduce((sum, row) => sum + (row.reasoningTokens ?? 0), 0)).toBe(57_133)
  })

  it('folds provenance-poor legacy aliases into one unambiguous route but keeps true provider variants apart', () => {
    const payload = buildMenubarPayload(period([
      {
        name: 'gpt-5.4',
        cost: 4,
        savingsUSD: 0,
        calls: 1,
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 30,
        cacheWriteTokens: 0,
      },
      {
        name: 'gpt-5.4',
        modelProvider: 'openai',
        sourceProviders: ['codex'],
        cost: 6,
        savingsUSD: 0,
        calls: 2,
        inputTokens: 20,
        outputTokens: 4,
        reasoningTokens: 5,
        cacheReadTokens: 60,
        cacheWriteTokens: 0,
      },
      {
        name: 'deepseek-v4-flash',
        modelProvider: 'opencode-go',
        cost: 2,
        savingsUSD: 0,
        calls: 3,
        inputTokens: 30,
        outputTokens: 6,
        cacheReadTokens: 90,
        cacheWriteTokens: 0,
      },
      {
        name: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        cost: 1,
        savingsUSD: 0,
        calls: 4,
        inputTokens: 40,
        outputTokens: 8,
        cacheReadTokens: 120,
        cacheWriteTokens: 0,
      },
    ], 13, 10), [], null)
    const rows = payload.current.modelAccounting?.rows ?? []

    expect(rows.filter(row => row.name === 'GPT-5.4')).toHaveLength(1)
    expect(rows.find(row => row.name === 'GPT-5.4')).toMatchObject({
      provider: 'openai',
      calls: 3,
      cost: 10,
      rawModels: ['gpt-5.4'],
      reasoningTokens: 5,
    })
    expect(rows.filter(row => row.name === 'DeepSeek v4 Flash')).toHaveLength(2)
    expect(rows.filter(row => row.name === 'DeepSeek v4 Flash').map(row => row.provider).sort()).toEqual([
      'deepseek',
      'opencode-go',
    ])
  })
})
