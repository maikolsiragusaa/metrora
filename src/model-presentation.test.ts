import { describe, expect, it } from 'vitest'

import { buildModelPresentation } from './model-presentation.js'
import type { ModelAccounting } from './menubar-json.js'
import type { ModelAccountingRow } from './model-accounting-types.js'

function row(overrides: Partial<ModelAccountingRow> & Pick<ModelAccountingRow, 'name' | 'provider'>): ModelAccountingRow {
  const name = overrides.name!
  const provider = overrides.provider!
  const { name: _ignoredName, provider: _ignoredProvider, ...rest } = overrides
  return {
    name,
    provider,
    cost: 1,
    savingsUSD: 0,
    calls: 1,
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 0,
    cacheReadTokens: 30,
    cacheWriteTokens: 0,
    tokenDetail: true,
    reasoningSemantics: 'separate',
    sourceProviders: [provider],
    rawModels: [name],
    ...rest,
  }
}

function accounting(rows: ModelAccountingRow[]): ModelAccounting {
  return {
    rows,
    gap: { cost: 0, savingsUSD: 0, calls: 0 },
    coverage: { cost: 1, calls: 1 },
    tokenCoverage: { cost: 1, calls: 1 },
  }
}

describe('model presentation projection', () => {
  it('preserves known reasoning evidence while distinguishing complete, mixed, and unavailable coverage', () => {
    const rows = [
      row({ name: 'Separate reasoning model', provider: 'codex', reasoningTokens: 9 }),
      row({
        name: 'Shared reasoning model',
        provider: 'codex',
        canonicalIdentity: 'shared-reasoning-model',
        sourceProviders: ['codex'],
        reasoningTokens: 17,
      }),
      row({
        name: 'Shared reasoning model',
        provider: 'zed',
        canonicalIdentity: 'shared-reasoning-model',
        sourceProviders: ['zed'],
        reasoningSemantics: 'unavailable',
        reasoningTokens: undefined,
      }),
      row({
        name: 'Mixed evidence model',
        provider: 'mixed-route',
        canonicalIdentity: 'mixed-evidence-model',
        sourceProviders: ['codex', 'zed'],
        reasoningSemantics: 'mixed',
        reasoningTokens: 11,
      }),
      row({
        name: 'Unavailable reasoning model',
        provider: 'zed',
        canonicalIdentity: 'unavailable-reasoning-model',
        sourceProviders: ['zed'],
        reasoningSemantics: 'unavailable',
        reasoningTokens: undefined,
      }),
    ]

    const projection = buildModelPresentation(accounting(rows))
    const separate = projection.rows.find(value => value.name === 'Separate reasoning model')!
    const shared = projection.rows.find(value => value.name === 'Shared reasoning model')!
    const mixed = projection.rows.find(value => value.name === 'Mixed evidence model')!
    const unavailable = projection.rows.find(value => value.name === 'Unavailable reasoning model')!

    expect(separate).toMatchObject({ reasoningSemantics: 'separate', reasoningTokens: 9, additiveReasoningTokens: 9 })
    expect(shared).toMatchObject({ reasoningSemantics: 'mixed', reasoningTokens: 17, additiveReasoningTokens: 17 })
    expect(mixed).toMatchObject({ reasoningSemantics: 'mixed', reasoningTokens: 11, additiveReasoningTokens: 0 })
    expect(unavailable.reasoningSemantics).toBe('unavailable')
    expect(unavailable).not.toHaveProperty('reasoningTokens')
    expect(projection.rows.reduce((sum, value) => sum + (value.reasoningTokens ?? 0), 0)).toBe(37)
    for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      expect(projection.rows.reduce((sum, value) => sum + value[key], 0)).toBe(rows.reduce((sum, value) => sum + value[key], 0))
    }
  })

  it('groups equivalent paid routes while preserving exact deliveries and free economics', () => {
    const rows = [
      row({ name: 'DeepSeek V4 Pro', provider: 'opencode-go', cost: 2, calls: 2, sourceProviders: ['opencode'] }),
      row({ name: 'DeepSeek V4 Pro', provider: 'deepseek', cost: 3, calls: 3, sourceProviders: ['deepseek'] }),
      row({ name: 'DeepSeek V4 Flash', provider: 'openrouter', cost: 4, calls: 4 }),
      row({ name: 'DeepSeek V4 Flash', provider: 'deepseek', cost: 5, calls: 5 }),
      row({ name: 'DeepSeek V4 Flash Free', provider: 'openrouter', cost: 0, calls: 6, semanticVariant: 'free' }),
    ]
    const projection = buildModelPresentation(accounting(rows))
    const paidPro = projection.rows.find(value => value.name === 'DeepSeek v4 Pro')!
    const paidFlash = projection.rows.find(value => value.name === 'DeepSeek v4 Flash' && value.economicVariants[0] !== 'free')!
    const freeFlash = projection.rows.find(value => value.economicVariants.includes('free'))!

    expect(paidPro).toMatchObject({ cost: 5, calls: 5, providers: ['deepseek', 'opencode-go'], deliveryStatus: 'exact' })
    expect(paidPro.deliveryRows).toHaveLength(2)
    expect(paidFlash).toMatchObject({ cost: 9, calls: 9 })
    expect(paidFlash.deliveryRows).toHaveLength(2)
    expect(freeFlash).toMatchObject({ name: 'DeepSeek v4 Flash Free', cost: 0, calls: 6, deliveryRows: [rows[4]] })
    expect(projection.accountingRowCount).toBe(rows.length)
    expect(projection.rows.reduce((sum, value) => sum + value.cost, 0)).toBe(rows.reduce((sum, value) => sum + value.cost, 0))
    expect(projection.rows.reduce((sum, value) => sum + value.calls, 0)).toBe(rows.reduce((sum, value) => sum + value.calls, 0))
    for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      expect(projection.rows.reduce((sum, value) => sum + (value[key] ?? 0), 0)).toBe(rows.reduce((sum, value) => sum + (value[key] ?? 0), 0))
    }
  })

  it('groups same-model delivery evidence for Luna and Gemini without erasing variants', () => {
    const rows = [
      row({ name: 'GPT-5.6 Luna', provider: 'openai', sourceProviders: ['codex'], calls: 7, activeDurationMs: 700, activeGeneratedTokens: 700 }),
      row({ name: 'GPT-5.6 Luna', provider: 'zed.dev', sourceProviders: ['zed'], calls: 5 }),
      row({ name: 'Gemini 3.1 Pro (high)', provider: 'google', sourceProviders: ['antigravity'], semanticVariant: 'high', calls: 2 }),
      row({ name: 'Gemini 3.1 Pro (low)', provider: 'google', sourceProviders: ['antigravity'], semanticVariant: 'low', calls: 3 }),
      row({ name: 'Mistral Medium 3.1', provider: 'mistral', calls: 1 }),
      row({ name: 'Mistral Medium 3.2', provider: 'mistral', calls: 1 }),
    ]
    const projection = buildModelPresentation(accounting(rows))
    const luna = projection.rows.find(value => value.name === 'GPT-5.6 Luna')!
    const gemini = projection.rows.find(value => value.name === 'Gemini 3.1 Pro')!

    expect(luna).toMatchObject({ calls: 12, activeDurationMs: 700, activeGeneratedTokens: 700, timingCoverage: 'partial' })
    expect(luna.deliveryRows.map(value => value.provider)).toEqual(['openai', 'zed.dev'])
    expect(luna.deliveryRows[1]).not.toHaveProperty('activeDurationMs')
    expect(gemini).toMatchObject({ calls: 5 })
    expect(gemini.economicVariants.sort()).toEqual(['high', 'low'])
    expect(gemini.deliveryRows).toHaveLength(2)
    expect(projection.rows.filter(value => value.name.startsWith('Mistral Medium')).length).toBe(2)
  })
})
