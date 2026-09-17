import { describe, expect, it } from 'vitest'

import { buildModelAccounting } from '../src/model-accounting.js'
import type { ModelAccountingRow } from '../src/model-accounting-types.js'
import { buildModelPresentation } from '../src/model-presentation.js'
import type { ModelAccounting } from '../src/menubar-json.js'
import { findUnpricedModels, getShortModelName, isExpectedFreeModel } from '../src/models.js'
import { enrichModelsWithObservedPerformance } from '../src/model-performance.js'
import type { ProjectSummary } from '../src/types.js'

function accountingRow(overrides: Partial<ModelAccountingRow> & Pick<ModelAccountingRow, 'name'>): ModelAccountingRow {
  const { name, ...rest } = overrides
  return {
    name,
    cost: 1,
    savingsUSD: 0,
    calls: 1,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 0,
    tokenDetail: true,
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

describe('factual consistency: canonical model display identity', () => {
  it('keeps a bare -thinking reasoning variant out of the base model display name', () => {
    // Reproduced from the live corpus: `claude-opus-4-6-thinking`
    // (Antigravity route) and `claude-opus-4-6` (Copilot route) are distinct
    // canonical identities that both rendered as "Opus 4.6".
    expect(getShortModelName('claude-opus-4-6-thinking')).toBe('Opus 4.6 Thinking')
    expect(getShortModelName('claude-opus-4-6')).toBe('Opus 4.6')
    expect(getShortModelName('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    // Variants the accounting layer already disambiguates in parentheses keep
    // their existing display form.
    expect(getShortModelName('claude-opus-4-6-20260205')).toBe('Opus 4.6')
  })

  it('gives a preview family row an unambiguous name instead of reusing the settled one', () => {
    // Reproduced from the live corpus: a settled Gemini 3.1 Pro aggregate and
    // a single-call `gemini-3.1-pro-preview` Copilot row shared the family key
    // shape but split on paid/preview economics while both printing
    // "Gemini 3.1 Pro".
    const rows = [
      accountingRow({
        name: 'Gemini 3.1 Pro (high)',
        provider: 'api_provider_google_gemini',
        sourceProviders: ['antigravity'],
        canonicalIdentity: 'gemini-3.1-pro-preview',
        semanticVariant: 'high',
        rawModels: ['gemini-3.1-pro-high'],
        calls: 1266,
        cost: 76,
      }),
      accountingRow({
        name: 'Gemini 3.1 Pro (preview)',
        sourceProviders: ['copilot'],
        canonicalIdentity: 'gemini-3.1-pro-preview',
        semanticVariant: 'preview',
        rawModels: ['gemini-3.1-pro-preview'],
        calls: 1,
        cost: 0,
      }),
    ]
    const projection = buildModelPresentation(accounting(rows))
    expect(projection.rows).toHaveLength(2)
    const names = projection.rows.map(row => row.name).sort()
    expect(names).toEqual(['Gemini 3.1 Pro', 'Gemini 3.1 Pro Preview'])
    const preview = projection.rows.find(row => row.name === 'Gemini 3.1 Pro Preview')!
    expect(preview.calls).toBe(1)
    expect(preview.sourceProviders).toEqual(['copilot'])
  })

  it('groups multi-route same-model deliveries into one row without merging variants', () => {
    const rows = [
      accountingRow({
        name: 'GPT-5.4',
        provider: 'openai',
        sourceProviders: ['codex'],
        canonicalIdentity: 'gpt-5.4',
        rawModels: ['gpt-5.4'],
        calls: 100,
        cost: 10,
      }),
      accountingRow({
        name: 'GPT-5.4',
        sourceProviders: ['copilot'],
        canonicalIdentity: 'gpt-5.4',
        rawModels: ['gpt-5.4', 'gpt-5.4-2026-03-05'],
        calls: 7,
        cost: 3,
      }),
    ]
    const projection = buildModelPresentation(accounting(rows))
    expect(projection.rows).toHaveLength(1)
    expect(projection.rows[0]).toMatchObject({
      name: 'GPT-5.4',
      calls: 107,
      cost: 13,
      deliveryStatus: 'partial',
    })
    expect(projection.rows[0]!.deliveryRows).toHaveLength(2)
  })

  it('never merges a thinking variant into its base model presentation row', () => {
    const rows = [
      accountingRow({
        name: 'Opus 4.6 Thinking',
        provider: 'api_provider_anthropic_vertex',
        sourceProviders: ['antigravity'],
        canonicalIdentity: 'claude-opus-4-6-thinking',
        rawModels: ['claude-opus-4-6-thinking'],
        calls: 940,
        cost: 120,
      }),
      accountingRow({
        name: 'Opus 4.6',
        sourceProviders: ['copilot'],
        canonicalIdentity: 'claude-opus-4-6',
        rawModels: ['claude-opus-4-6'],
        calls: 73,
        cost: 28,
      }),
    ]
    const projection = buildModelPresentation(accounting(rows))
    expect(projection.rows).toHaveLength(2)
    expect(projection.rows.map(row => row.name).sort()).toEqual(['Opus 4.6', 'Opus 4.6 Thinking'])
  })
})

describe('factual consistency: Bedrock versions are not local tags', () => {
  it('does not class a Bedrock -vN:M version as local inference', () => {
    // A Bedrock foundation-model version colon is not an Ollama :tag. Before
    // the exemption these ids read as free local inference: dropped from
    // unpriced detection and the pricing-coverage denominator at $0.
    expect(isExpectedFreeModel('anthropic.claude-opus-4-6-v1:0')).toBe(false)
    expect(isExpectedFreeModel('openai.gpt-oss-120b-1:0')).toBe(false)
    expect(findUnpricedModels([
      { model: 'anthropic.claude-opus-4-6-v1:0', calls: 5, cost: 0, tokens: 100 },
    ])).toHaveLength(1)
  })

  it('still recognizes genuine local tags and quant fingerprints', () => {
    expect(isExpectedFreeModel('qwen3.6:35b-a3b-bf16')).toBe(true)
    expect(isExpectedFreeModel('llama3.1:8b')).toBe(true)
    expect(isExpectedFreeModel('some-model-q8_0')).toBe(true)
  })
})

describe('factual consistency: Sessions/Models additive invariant', () => {
  it('preserves additive totals from accounting rows through presentation grouping', () => {
    // A model distributed across two provider routes must reconcile exactly:
    // presentation grouping is a re-bucketing, never a lossy projection.
    const accounted = buildModelAccounting(
      [
        {
          name: 'gpt-5.6-luna', cost: 400, savingsUSD: 0, calls: 100000,
          inputTokens: 360000000, outputTokens: 47000000,
          cacheReadTokens: 0, cacheWriteTokens: 0,
          modelProvider: 'openai', sourceProviders: ['codex'],
        },
        {
          name: 'gpt-5.6-luna', cost: 1, savingsUSD: 0, calls: 5,
          inputTokens: 188841, outputTokens: 47257,
          cacheReadTokens: 0, cacheWriteTokens: 0,
          modelProvider: 'zed.dev', sourceProviders: ['zed'],
        },
      ],
      401,
      100005,
    )
    expect(accounted.gap).toMatchObject({ cost: 0, calls: 0 })
    const projection = buildModelPresentation(accounted)
    const sum = (pick: (row: { calls: number; cost: number; inputTokens: number; outputTokens: number }) => number) =>
      projection.rows.reduce((total, row) => total + pick(row), 0)
    expect(sum(row => row.calls)).toBe(100005)
    expect(sum(row => row.cost)).toBeCloseTo(401, 9)
    expect(sum(row => row.inputTokens)).toBe(360188841)
    expect(sum(row => row.outputTokens)).toBe(47047257)
  })
})

describe('factual consistency: timing sample count', () => {
  function projects(): ProjectSummary[] {
    const call = (overrides: Record<string, unknown>) => ({
      provider: 'codex',
      model: 'GPT-5.6 Luna',
      modelProvider: 'openai',
      usage: { inputTokens: 10, outputTokens: 90, reasoningTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cachedInputTokens: 0 },
      costUSD: 0.01,
      ...overrides,
    })
    return [{
      project: 'p',
      projectPath: '/p',
      sessions: [{
        sessionId: 's',
        project: 'p',
        provider: 'codex',
        turns: [{ category: 'general', timestamp: '2026-09-01T00:00:00Z', sessionId: 's', userMessage: '', assistantCalls: [
          { ...call({ activeDurationMs: 1000, activeGeneratedTokens: 100 }) },
          { ...call({ activeDurationMs: 2000, activeGeneratedTokens: 200 }) },
        ] }],
        totalCostUSD: 0.02,
        totalSavingsUSD: 0,
        apiCalls: 2,
        totalApiCalls: 2,
        totalProxiedCostUSD: 0,
        modelBreakdown: {},
        categoryBreakdown: {},
        skillBreakdown: {},
        subagentBreakdown: {},
      }],
      totalCostUSD: 0.02,
      totalSavingsUSD: 0,
      totalApiCalls: 2,
      totalProxiedCostUSD: 0,
    } as unknown as ProjectSummary]
  }

  it('carries the timed-call sample count alongside observed timing', () => {
    const rows = enrichModelsWithObservedPerformance(
      [{ name: 'GPT-5.6 Luna', modelProvider: 'openai', sourceProviders: ['codex'] }],
      projects(),
    )
    expect(rows[0]).toMatchObject({
      activeDurationMs: 3000,
      activeGeneratedTokens: 300,
      timingCalls: 2,
      timingCoverage: 'observed',
    })
    const accounted = buildModelAccounting(
      [{
        name: 'gpt-5.6-luna', cost: 1, savingsUSD: 0, calls: 10,
        inputTokens: 100, outputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0,
        modelProvider: 'openai', sourceProviders: ['codex'],
        activeDurationMs: 3000, activeGeneratedTokens: 300, timingCalls: 2, timingCoverage: 'observed',
      }],
      1,
      10,
    )
    expect(accounted.rows[0]).toMatchObject({ timingCalls: 2 })
    const projection = buildModelPresentation(accounted)
    expect(projection.rows[0]).toMatchObject({ timingCalls: 2, timingCoverage: 'observed' })
  })

  it('never invents a sample count where timing was not observed', () => {
    const accounted = buildModelAccounting(
      [{
        name: 'Some Model', cost: 1, savingsUSD: 0, calls: 4,
        inputTokens: 100, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0,
      }],
      1,
      4,
    )
    expect(accounted.rows[0]).not.toHaveProperty('timingCalls')
  })
})
