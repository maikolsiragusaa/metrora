import { describe, expect, it, vi } from 'vitest'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorAnswer, AdvisorDataSource, AdvisorRuntimeInput, AdvisorModelRuntime } from '../advisor/types'
import { createBaselineWorkerRequests } from '../../../src/swarm/coordinator-v1'
import type { SwarmEventV1 } from '../../../src/swarm/contract-v1'
import { NativeHarnessWorkerAdapter } from './native-worker-adapter'

function overview(): MenubarPayload {
  return {
    generated: '2026-08-31T00:00:00.000Z',
    current: {
      label: 'Today',
      cost: 12,
      calls: 2,
      sessions: 1,
      oneShotRate: null,
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitPercent: 0,
      codexCredits: 0,
      topActivities: [],
      topModels: [],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      topProjects: [],
      modelEfficiency: [],
      topSessions: [],
      retryTax: { totalUSD: 0, retries: 0, calls: 0, rate: null },
    },
    history: { daily: [] },
  } as unknown as MenubarPayload
}

function source() {
  const getOverview = vi.fn(async () => overview())
  const value: AdvisorDataSource = {
    getOverview,
    getModels: async () => [],
    getQuota: async () => [],
  }
  return { value, getOverview }
}

function runtime(capture: { input?: AdvisorRuntimeInput; denied: boolean }): AdvisorModelRuntime {
  return {
    id: 'ollama',
    label: 'Ollama local',
    mode: 'ollama-local',
    providerSupport: ['ollama'],
    availability: 'ready',
    supportsStreaming: false,
    generate: async (input, signal) => {
      capture.input = input
      input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'queued' })
      input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'started' })
      const execution = await input.executeTool!('get_spend_snapshot', {}, signal)
      input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'completed' })
      try {
        await input.executeTool!('get_spend_snapshot', {}, signal)
      } catch {
        capture.denied = true
      }
      return {
        conclusion: 'Canonical spend evidence is available.',
        scopeLabel: 'Today',
        periodLabel: 'Today',
        evidence: execution.evidence.refs,
        coverage: execution.evidence.coverage,
        assumptions: [],
        unknown: [],
        nextInvestigations: [],
        details: [],
        runtime: { id: 'ollama', label: 'Ollama local', mode: 'ollama-local' },
      } satisfies AdvisorAnswer
    },
  }
}

describe('Native Harness Swarm worker adapter', () => {
  it('uses canonical read-only Tools, enforces allowlist/calls, and returns bounded identity', async () => {
    const sourceResult = source()
    const capture: { input?: AdvisorRuntimeInput; denied: boolean } = { denied: false }
    const adapter = new NativeHarnessWorkerAdapter({
      source: sourceResult.value,
      runtime: runtime(capture),
      overview: overview(),
      now: () => '2026-08-31T00:00:00.000Z',
    })
    const [request] = createBaselineWorkerRequests({
      runId: 'run-native',
      task: 'What changed in spend?',
      scope: { period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
      runtime: { id: 'ollama', label: 'Ollama C:\\Users\\founder\\model' },
      model: { id: 'model-a', label: 'model-a' },
      allowedToolNames: ['get_spend_snapshot'],
      limits: { maxToolCalls: 1, maxToolRounds: 1 },
    })
    const events: SwarmEventV1[] = []
    const result = await adapter.run(request!, event => events.push(event))
    expect(result.status).toBe('completed')
    expect(result.toolActivity).toEqual([{ name: 'get_spend_snapshot', status: 'completed' }])
    expect(sourceResult.getOverview).not.toHaveBeenCalled()
    expect(capture.input?.tools?.map(tool => tool.function.name)).toEqual(['get_spend_snapshot'])
    expect(capture.denied).toBe(true)
    expect(result.runtime.label).not.toContain('Users')
    expect(JSON.stringify(result)).not.toContain('C:\\Users\\founder')
    expect(events.some(event => event.kind === 'worker' && event.status === 'tool-started')).toBe(true)
    expect(events.some(event => event.kind === 'worker' && event.status === 'tool-completed')).toBe(true)
  })

  it('calls the canonical registry when a supplied overview cannot satisfy the scope', async () => {
    const sourceResult = source()
    const capture: { input?: AdvisorRuntimeInput; denied: boolean } = { denied: false }
    const adapter = new NativeHarnessWorkerAdapter({
      source: sourceResult.value,
      runtime: runtime(capture),
      overview: null,
      now: () => '2026-08-31T00:00:00.000Z',
    })
    const [request] = createBaselineWorkerRequests({
      runId: 'run-native-source',
      task: 'What changed in spend?',
      scope: { period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
      runtime: { id: 'ollama', label: 'Ollama local' },
      model: { id: 'model-a', label: 'model-a' },
      allowedToolNames: ['get_spend_snapshot'],
      limits: { maxToolCalls: 1, maxToolRounds: 1 },
    })
    const result = await adapter.run(request!)
    expect(result.status).toBe('completed')
    expect(sourceResult.getOverview).toHaveBeenCalledOnce()
  })
})
