import { describe, expect, it, vi } from 'vitest'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorAnswer, AdvisorDataSource, AdvisorRuntimeInput, AdvisorModelRuntime } from '../advisor/types'
import { createBaselineSwarmCoordinator, createBaselineWorkerRequests } from '../../../src/swarm/coordinator-v1'
import type { SwarmEventV1, SwarmSynthesisInputV1 } from '../../../src/swarm/contract-v1'
import { createNativeHarnessSwarmSynthesizer, NativeHarnessWorkerAdapter } from './native-worker-adapter'

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

function runtime(capture: { input?: AdvisorRuntimeInput; denied: boolean; toolCalls?: number; generateCalls?: number }, requestedToolCalls = 1): AdvisorModelRuntime {
  return {
    id: 'ollama',
    label: 'Ollama local',
    mode: 'ollama-local',
    providerSupport: ['ollama'],
    availability: 'ready',
    supportsStreaming: false,
    generate: async (input, signal) => {
      capture.generateCalls = (capture.generateCalls ?? 0) + 1
      capture.input = input
      let evidenceRefs: AdvisorAnswer['evidence'] = []
      let coverage: AdvisorAnswer['coverage'] | null = null
      for (let index = 0; index < requestedToolCalls; index += 1) {
        input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'queued' })
        input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'started' })
        capture.toolCalls = (capture.toolCalls ?? 0) + 1
        const execution = await input.executeTool!('get_spend_snapshot', {}, signal)
        if (index === 0) {
          evidenceRefs = execution.evidence.refs
          coverage = execution.evidence.coverage
        }
        input.onToolEvent?.({ name: 'get_spend_snapshot', status: 'completed' })
      }
      if (requestedToolCalls === 1) {
        try {
          await input.executeTool!('get_spend_snapshot', {}, signal)
        } catch {
          capture.denied = true
        }
      }
      return {
        conclusion: 'Canonical spend evidence is available.',
        scopeLabel: 'Today',
        periodLabel: 'Today',
        evidence: evidenceRefs,
        coverage: coverage!,
        assumptions: [],
        unknown: [],
        nextInvestigations: [],
        details: [],
        runtime: { id: 'ollama', label: 'Ollama local', mode: 'ollama-local' },
      } satisfies AdvisorAnswer
    },
  }
}

function workerReport(answer: string): SwarmSynthesisInputV1['workers'][number] {
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: 'run-native-synthesis',
    workerId: 'run-native-synthesis-worker-1',
    role: 'investigator',
    profile: 'fixed-investigator-v1',
    status: 'completed',
    runtime: { id: 'ollama', label: 'Ollama local' },
    model: { id: 'model-a', label: 'model-a' },
    startedAt: '2026-08-31T00:00:00.000Z',
    endedAt: '2026-08-31T00:00:01.000Z',
    toolActivity: [],
    evidenceRefs: [],
    evidenceSummary: 'Canonical spend evidence is available.',
    answer,
    artifactSummary: null,
    errors: [],
    usage: null,
    resultDigest: '',
  }
}

describe('Native Harness Swarm worker adapter', () => {
  it('uses canonical read-only Tools, enforces allowlist/calls, and returns bounded identity', async () => {
    const sourceResult = source()
    const capture: { input?: AdvisorRuntimeInput; denied: boolean; toolCalls?: number; generateCalls?: number } = { denied: false }
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
    expect(capture.generateCalls).toBe(1)
    expect(result.runtime.label).not.toContain('Users')
    expect(JSON.stringify(result)).not.toContain('C:\\Users\\founder')
    expect(events.some(event => event.kind === 'worker' && event.status === 'tool-started')).toBe(true)
    expect(events.some(event => event.kind === 'worker' && event.status === 'tool-completed')).toBe(true)
  })

  it('permits four Tool calls in the single bounded round without a replanning loop', async () => {
    const sourceResult = source()
    const capture: { input?: AdvisorRuntimeInput; denied: boolean; toolCalls?: number; generateCalls?: number } = { denied: false }
    const adapter = new NativeHarnessWorkerAdapter({
      source: sourceResult.value,
      runtime: runtime(capture, 4),
      overview: overview(),
      now: () => '2026-08-31T00:00:00.000Z',
    })
    const [request] = createBaselineWorkerRequests({
      runId: 'run-native-four-tools',
      task: 'What changed in spend?',
      scope: { period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
      runtime: { id: 'ollama', label: 'Ollama local' },
      model: { id: 'model-a', label: 'model-a' },
      allowedToolNames: ['get_spend_snapshot'],
      limits: { maxToolCalls: 4, maxToolRounds: 1 },
    })
    const result = await adapter.run(request!)
    expect(result.status).toBe('completed')
    expect(capture.toolCalls).toBe(4)
    expect(capture.generateCalls).toBe(1)
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

  it('terminalizes a real coordinator run when the selected provider ignores AbortSignal', async () => {
    vi.useFakeTimers()
    try {
      const sourceResult = source()
      const hangingRuntime: AdvisorModelRuntime = {
        id: 'hosted-opencode-zen',
        label: 'OpenCode Zen',
        mode: 'hosted-byok',
        providerSupport: ['opencode-zen'],
        availability: 'ready',
        supportsStreaming: false,
        // Deliberately ignore the signal: this models a delayed provider/IPC
        // promise and proves the adapter/coordinator owns the foreground
        // deadline instead of relying on provider cancellation.
        generate: async () => await new Promise<AdvisorAnswer>(() => {}),
      }
      const adapter = new NativeHarnessWorkerAdapter({ source: sourceResult.value, runtime: hangingRuntime, overview: overview(), now: () => '2026-08-31T00:00:00.000Z' })
      const coordinator = createBaselineSwarmCoordinator({
        adapter,
        createRunId: () => 'run-native-timeout',
        now: () => '2026-08-31T00:00:00.000Z',
        cancellationGraceMs: 0,
      })
      const promise = coordinator.run({
        task: 'What changed in spend?',
        scope: { period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
        runtime: { id: 'opencode-zen', label: 'OpenCode Zen' },
        model: { id: 'fixture-model', label: 'fixture-model' },
        allowedToolNames: ['get_spend_snapshot'],
        workerCount: 2,
        limits: { maxToolCalls: 4, maxToolRounds: 1, timeoutMs: 1_000 },
        wholeRunTimeoutMs: 5_000,
      })
      await vi.advanceTimersByTimeAsync(1_001)
      const result = await promise
      expect(result.status).toBe('timeout')
      expect(result.workers.map(worker => worker.status)).toEqual(['timeout', 'timeout'])
      expect(result.synthesis).toBeNull()
      expect(result.evidence.timeout).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not promote a Swarm synthesis that invents a numeric fact', async () => {
    const runtimeWithUnsafeSynthesis: AdvisorModelRuntime = {
      ...runtime({ denied: false }),
      generateSwarmSynthesis: async () => ({
        answer: 'The measured total was $999, so the main contributor is Project A.',
        evidenceSummary: 'Unsafe numeric synthesis fixture.',
      }),
    }
    const synthesize = createNativeHarnessSwarmSynthesizer(runtimeWithUnsafeSynthesis)
    const result = await synthesize({
      contractVersion: 'metrora.swarm.v1',
      schemaVersion: 1,
      runId: 'run-native-synthesis',
      task: 'What changed in spend?',
      scope: { period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
      workers: [workerReport('The measured total was $12.')],
    }, new AbortController().signal)

    expect(result.status).toBe('unavailable')
    expect(result.answer).toBe('')
  })
})
