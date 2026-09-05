import { describe, expect, it } from 'vitest'

import { assertStrictBoundedMetroraToolContent } from '../src/tools/contract.js'
import { createMetroraToolRegistry } from '../src/tools/registry.js'
import type { MetroraModelReportRow, MetroraToolDataSource, MetroraToolModelEvidenceRow, MetroraToolScope } from '../src/tools/types.js'

const scope: MetroraToolScope = {
  period: 'all',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function modelEvidenceRow(provider: string): MetroraToolModelEvidenceRow {
  return {
    model: 'fixture-model',
    provider,
    calls: 3,
    costUSD: 12.5,
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    additiveReasoningTokens: null,
    costPerCallUSD: 12.5 / 3,
    pricingState: 'priced',
  }
}

function modelReportRow(provider: string): MetroraModelReportRow {
  return {
    model: 'fixture-model',
    provider,
    calls: 3,
    costUSD: 12.5,
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    pricing: { state: 'priced' },
  }
}

function source(row: MetroraModelReportRow): MetroraToolDataSource {
  return {
    getOverview: async () => ({ current: {}, history: { daily: [] } }),
    getModels: async () => [row],
    getQuota: async () => [],
  }
}

function contentWithProvider(provider: string): string {
  return JSON.stringify({ modelEfficiency: { rows: [modelEvidenceRow(provider)] } })
}

describe('strict canonical Metrora tool output privacy', () => {
  it('accepts bounded factual provider identifiers through model efficiency output', async () => {
    for (const provider of ['opencode', 'gemini', 'zed', 'claude', 'codex', '[provider]']) {
      const result = await createMetroraToolRegistry(source(modelReportRow(provider)), scope).execute('get_model_efficiency', {})
      const bounded = assertStrictBoundedMetroraToolContent(result.content)
      const row = JSON.parse(bounded).modelEfficiency.rows[0] as MetroraToolModelEvidenceRow
      expect(row.provider).toBe(provider)
    }
  })

  it.each([
    ['filesystem path', 'C:\\Users\\someone\\secret'],
    ['relative path', '../../private'],
    ['bearer text', 'Bearer abc123'],
    ['secret assignment', 'token=abc123'],
    ['control characters', 'provider\nidentifier'],
    ['overlong identifier', 'p'.repeat(81)],
  ])('rejects unsafe provider fixture: %s', (_label, provider) => {
    expect(() => assertStrictBoundedMetroraToolContent(contentWithProvider(provider))).toThrowError(
      expect.objectContaining({ code: 'invalid-output' }),
    )
  })
})
