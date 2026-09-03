import { describe, expect, it, vi } from 'vitest'

import { createMetroraToolRegistry } from '../src/tools/registry.js'
import type { MetroraOverview, MetroraToolDataSource, MetroraToolScope } from '../src/tools/types.js'

const scope: MetroraToolScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function overview(): MetroraOverview {
  return {
    generated: '2026-08-30T12:00:00.000Z',
    freshness: { readMode: 'snapshot', reconciliation: 'complete', durableThrough: null },
    current: {
      label: 'Last 7 days',
      cost: 12.5,
      calls: 8,
      sessions: 3,
      inputTokens: 1000,
      outputTokens: 600,
      pricingCoverage: 1,
      topModels: [{ name: 'qwen3:8b', cost: 8, calls: 5 }],
      topProjects: [{ name: 'api_key=sk_test_12345678901234567890', cost: 7, sessions: 2 }],
      topSessions: [{ project: 'C:\\Users\\owner\\source', cost: 4, calls: 2 }],
      modelAccounting: { rows: [{ name: 'qwen3:8b', cost: 8, calls: 5, inputTokens: 500, outputTokens: 300 }] },
    },
    history: {
      daily: [
        { date: '2026-08-29', cost: 4, calls: 3 },
        { date: '2026-08-30', cost: 8.5, calls: 5 },
      ],
    },
  }
}

function measuredZeroOverview(): MetroraOverview {
  const base = overview()
  return {
    ...base,
    current: {
      ...base.current!,
      cost: 0,
      calls: 0,
      sessions: 0,
    },
  }
}

function source(overrides: Partial<MetroraToolDataSource> = {}): MetroraToolDataSource {
  return {
    getOverview: vi.fn(async () => overview()),
    getModels: vi.fn(async () => [{ provider: 'ollama', model: 'qwen3:8b', calls: 5, costUSD: 8, outputTokens: 300, pricing: { state: 'priced' } }]),
    getQuota: vi.fn(async () => [{
      provider: 'claude',
      availability: 'available',
      connection: 'connected',
      freshness: 'fresh',
      observedAt: '2026-08-30T12:00:00.000Z',
      planLabel: 'Pro',
      windows: [{ id: 'daily', label: 'Daily', usedFraction: 0.25, resetsAt: '2026-08-31T00:00:00.000Z' }],
      credits: { balance: 10 },
    }]),
    getBenchEvidence: vi.fn(async () => ({ state: 'UNAVAILABLE' as const })),
    ...overrides,
  }
}

describe('canonical Metrora Tools foundation', () => {
  it('exposes exactly the stable eight factual tool names through one registry', () => {
    const registry = createMetroraToolRegistry(source(), scope)
    expect(registry.definitions.map(definition => definition.function.name)).toEqual([
      'get_spend_snapshot',
      'get_model_efficiency',
      'get_quota_snapshot',
      'get_overview_snapshot',
      'get_project_drivers',
      'get_session_highlights',
      'get_coverage_report',
      'get_bench_evidence',
    ])
    expect(registry.contract.scope.immutable).toBe(true)
    expect(registry.contract.output).toMatchObject({ maxBytes: 32 * 1024, privacy: 'content-minimal', jsonSafe: true })
  })

  it('uses the supplied canonical snapshot and returns a bounded privacy-safe envelope', async () => {
    const registry = createMetroraToolRegistry(source(), scope, overview())
    const result = await registry.execute('get_spend_snapshot', {})
    expect(result.evidence.spend?.measuredCostUSD).toBe(12.5)
    expect(result.envelope).toMatchObject({
      contractVersion: 'metrora-factual-tool-v1',
      schemaVersion: 1,
      tool: 'get_spend_snapshot',
      unavailable: false,
      privacy: 'content-minimal',
    })
    expect(result.content).not.toContain('C:\\Users\\owner')
    expect(result.content).not.toContain('sk_test_12345678901234567890')
    expect(result.content).not.toContain('api_key=')
    expect(result.content.length).toBeLessThanOrEqual(32 * 1024)
  })

  it('keeps authoritative measured zero distinct from an unavailable source', async () => {
    const zero = await createMetroraToolRegistry(source(), scope, measuredZeroOverview()).execute('get_spend_snapshot', {})
    expect(zero.evidence.spend?.measuredCostUSD).toBe(0)
    expect(zero.evidence.coverage.state).toBe('NO_DATA')
    expect(zero.envelope).toMatchObject({ unavailable: false })

    const unavailable = createMetroraToolRegistry(source({
      getOverview: vi.fn(async () => { throw new Error('source unavailable') }),
    }), scope)
    const missing = await unavailable.execute('get_spend_snapshot', {})
    expect(missing.evidence.spend?.measuredCostUSD).toBeNull()
    expect(missing.evidence.coverage.state).toBe('UNAVAILABLE')
    expect(missing.envelope).toMatchObject({ unavailable: true })
  })

  it('rejects unknown/additional arguments and every scope-widening request', async () => {
    const registry = createMetroraToolRegistry(source(), scope)
    await expect(registry.execute('not-a-tool', {})).rejects.toMatchObject({ code: 'unknown-tool' })
    await expect(registry.execute('get_spend_snapshot', { prompt: 'raw content' })).rejects.toMatchObject({ code: 'additional-argument' })
    await expect(registry.execute('get_spend_snapshot', { period: 'month' })).rejects.toMatchObject({ code: 'invalid-scope' })
    await expect(registry.execute('get_quota_snapshot', { provider: 'copilot' })).rejects.toMatchObject({ code: 'invalid-argument-value' })
    const todayRegistry = createMetroraToolRegistry(source(), { ...scope, period: 'today' })
    await expect(todayRegistry.execute('get_spend_snapshot', { period: 'yesterday' })).rejects.toMatchObject({ code: 'invalid-scope' })
  })

  it('does not allow a constrained provider or model scope to be changed by a call', async () => {
    const constrained = createMetroraToolRegistry(source(), {
      ...scope,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    })
    await expect(constrained.execute('get_quota_snapshot', { provider: 'codex' })).rejects.toMatchObject({ code: 'invalid-scope' })
    await expect(constrained.execute('get_spend_snapshot', { model: 'claude-opus-4-6' })).rejects.toMatchObject({ code: 'invalid-scope' })
  })

  it('stops before the data source when cancelled and preserves unavailable truth', async () => {
    const cancelledSource = source()
    const controller = new AbortController()
    controller.abort()
    await expect(createMetroraToolRegistry(cancelledSource, scope).execute('get_spend_snapshot', {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelledSource.getOverview).not.toHaveBeenCalled()

    const unavailable = createMetroraToolRegistry(source({
      getOverview: vi.fn(async () => { throw new Error('source unavailable') }),
    }), scope)
    const result = await unavailable.execute('get_spend_snapshot', {})
    expect(result.evidence.coverage.level).toBe('unavailable')
    expect(result.envelope?.unavailable).toBe(true)
    expect(result.content).toContain('unavailable')
  })
})
