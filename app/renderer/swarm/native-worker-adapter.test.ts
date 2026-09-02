// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { MenubarPayload } from '../lib/types'
import { createAdvisorConformanceFixture } from '../advisor/conformance'
import { OllamaAdvisorRuntime } from '../advisor/ollama'
import type { AdvisorAnswer, AdvisorDataSource, AdvisorRuntimeInput, AdvisorModelRuntime } from '../advisor/types'
import { createBaselineWorkerRequests } from '../../../src/swarm/coordinator-v1'
import type { SwarmEventV1, SwarmSynthesisInputV1, SwarmWorkerResultV1 } from '../../../src/swarm/contract-v1'
import { NativeHarnessWorkerAdapter, createNativeHarnessSwarmSynthesizer } from './native-worker-adapter'
import { createAdvisorOverviewSnapshot } from '../advisor/tools'

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

describe('Native Harness Swarm worker adapter', () => {
  it('uses canonical read-only Tools, enforces allowlist/calls, and returns bounded identity', async () => {
    const sourceResult = source()
    const capture: { input?: AdvisorRuntimeInput; denied: boolean; toolCalls?: number; generateCalls?: number } = { denied: false }
    const adapter = new NativeHarnessWorkerAdapter({
      source: sourceResult.value,
      runtime: runtime(capture),
      overview: createAdvisorOverviewSnapshot({ period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null }, overview()),
      now: () => '2026-08-31T00:00:00.000Z',
    })
    const [request] = createBaselineWorkerRequests({
      runId: 'run-native',
      task: 'What changed in spend?',
      scope: { period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
      runtime: { id: 'ollama', label: 'Ollama C:\\Users\\fixture\\model' },
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
    expect(JSON.stringify(result)).not.toContain('C:\\Users\\fixture')
    expect(events.some(event => event.kind === 'worker' && event.status === 'tool-started')).toBe(true)
    expect(events.some(event => event.kind === 'worker' && event.status === 'tool-completed')).toBe(true)
  })

  it('permits four Tool calls in the single bounded round without a replanning loop', async () => {
    const sourceResult = source()
    const capture: { input?: AdvisorRuntimeInput; denied: boolean; toolCalls?: number; generateCalls?: number } = { denied: false }
    const adapter = new NativeHarnessWorkerAdapter({
      source: sourceResult.value,
      runtime: runtime(capture, 4),
      overview: createAdvisorOverviewSnapshot({ period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null }, overview()),
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

  it('gives Investigator and Verifier distinct trusted responsibilities and independent canonical reads', async () => {
    const fixture = createAdvisorConformanceFixture()
    const inputs: AdvisorRuntimeInput[] = []
    const roleCalls = new Map<string, number>()
    const loopRuntime = new OllamaAdvisorRuntime({
      model: 'role-model',
      transport: {
        probe: async () => ({ available: true, models: ['role-model'], detail: 'ready' }),
        cancel: async () => true,
        onDelta: () => () => {},
        chat: async (_requestId, payload) => {
          const system = String((payload.messages as Array<{ content?: unknown }>)[0]?.content ?? '')
          const role = /responsibility \((investigator|verifier),/u.exec(system)?.[1] ?? 'investigator'
          const count = (roleCalls.get(role) ?? 0) + 1
          roleCalls.set(role, count)
          return count === 1
            ? { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
            : { streamed: false, message: { content: role === 'investigator' ? 'I measured $12.00 in the selected scope; I would inspect the visible drivers next.' : 'I independently checked the canonical $12.00 measurement; the requested evidence is consistent.' } }
        },
      },
    })
    const runtime: AdvisorModelRuntime = {
      ...loopRuntime,
      generate: vi.fn(async (input: AdvisorRuntimeInput, signal?: AbortSignal) => {
        inputs.push(input)
        return loopRuntime.generate(input, signal)
      }),
    }
    const adapter = new NativeHarnessWorkerAdapter({ source: fixture.source, runtime, overview: null, now: () => '2026-08-31T00:00:00.000Z' })
    const requests = createBaselineWorkerRequests({
      runId: 'run-role-semantics',
      task: 'È vero che ho speso più di 4k di AI? Verifica i dati disponibili e dammi una conclusione.',
      scope: fixture.scope as any,
      runtime: { id: 'ollama', label: 'Ollama local' },
      model: { id: 'model-a', label: 'model-a' },
      allowedToolNames: ['get_spend_snapshot'],
      workerCount: 2,
      limits: { maxToolCalls: 4, maxToolRounds: 1 },
    })
    const events: SwarmEventV1[] = []
    const results = await Promise.all(requests.map(request => adapter.run(request, event => events.push(event))))

    expect(fixture.reads.overviews).toHaveLength(2)
    expect(inputs.map(input => input.workerContext?.role)).toEqual(['investigator', 'verifier'])
    expect(inputs[0]?.workerContext?.responsibility).not.toBe(inputs[1]?.workerContext?.responsibility)
    expect(inputs[1]?.workerContext?.instruction).toMatch(/Repeat the bounded canonical verification read/)
    expect(results.every(result => result.status === 'completed')).toBe(true)
    expect(results.every(result => result.evidenceResult?.status === 'usable')).toBe(true)
    expect(results.every(result => result.evidenceRefs.some(ref => ref.id === 'overview.current'))).toBe(true)
    expect(results[0]?.answer).not.toBe(results[1]?.answer)
    expect(events.filter(event => event.kind === 'worker' && event.status === 'tool-started')).toHaveLength(4)
    expect(events.filter(event => event.kind === 'worker' && event.status === 'tool-completed')).toHaveLength(2)
  })

  it('does not reuse a cached Today overview for a Lifetime worker read', async () => {
    const today = overview()
    const lifetime = {
      ...today,
      current: { ...today.current, cost: 4118.17, calls: 417, sessions: 28 },
    } as unknown as MenubarPayload
    const fixture = createAdvisorConformanceFixture({ overview: lifetime })
    let calls = 0
    const runtime = new OllamaAdvisorRuntime({
      model: 'lifetime-model',
      transport: {
        probe: async () => ({ available: true, models: ['lifetime-model'], detail: 'ready' }),
        cancel: async () => true,
        onDelta: () => () => {},
        chat: async () => {
          calls += 1
          return calls === 1
            ? { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
            : { streamed: false, message: { content: 'Metrora measured $4,118.17 in lifetime spend.' } }
        },
      },
    })
    const adapter = new NativeHarnessWorkerAdapter({
      source: fixture.source,
      runtime,
      overview: createAdvisorOverviewSnapshot({ period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null }, today),
      now: () => '2026-08-31T00:00:00.000Z',
    })
    const [request] = createBaselineWorkerRequests({
      runId: 'run-lifetime-provenance',
      task: 'How much have I spent in lifetime?',
      scope: { ...fixture.scope, period: 'lifetime' },
      runtime: { id: 'ollama', label: 'Ollama local' },
      model: { id: 'model-a', label: 'model-a' },
      allowedToolNames: ['get_spend_snapshot'],
      limits: { maxToolCalls: 1, maxToolRounds: 1 },
    })

    const result = await adapter.run(request!)

    expect(fixture.reads.overviews).toHaveLength(1)
    expect(fixture.reads.overviews[0]).toMatchObject({ period: 'lifetime' })
    expect(result.answer).toMatch(/4,118\.17|4118\.17/u)
    expect(result.answer).not.toContain('0.96')
  })

  it('keeps a terminal worker closeout truthful when the required canonical read is unavailable', async () => {
    const fixture = createAdvisorConformanceFixture()
    const failingSource: AdvisorDataSource = {
      ...fixture.source,
      getOverview: vi.fn(async () => { throw new Error('canonical spend source unavailable') }),
    }
    const runtime = new OllamaAdvisorRuntime({
      model: 'unavailable-model',
      transport: {
        probe: async () => ({ available: true, models: ['unavailable-model'], detail: 'ready' }),
        cancel: async () => true,
        onDelta: () => () => {},
        chat: async () => ({ streamed: false, message: { content: 'I cannot verify the measured spend yet.' } }),
      },
    })
    const adapter = new NativeHarnessWorkerAdapter({ source: failingSource, runtime, overview: null, now: () => '2026-08-31T00:00:00.000Z' })
    const [request] = createBaselineWorkerRequests({
      runId: 'run-unavailable-evidence',
      task: 'È vero che ho speso più di 4k di AI? Verifica i dati disponibili e dammi una conclusione.',
      scope: fixture.scope as any,
      runtime: { id: 'ollama', label: 'Ollama local' },
      model: { id: 'model-a', label: 'model-a' },
      allowedToolNames: ['get_spend_snapshot'],
      limits: { maxToolCalls: 4, maxToolRounds: 1 },
    })
    const result = await adapter.run(request!)

    expect(result.status).toBe('completed')
    expect(result.evidenceResult).toMatchObject({ status: 'unavailable', requiredToolNames: ['get_spend_snapshot'] })
    expect(result.evidenceRefs).toEqual([])
    expect(result.evidenceSummary).toMatch(/unavailable/i)
    expect(result.evidenceSummary).not.toMatch(/high coverage/i)
    expect(result.toolActivity).toEqual([{ name: 'get_spend_snapshot', status: expect.stringMatching(/unavailable|failed/) }])
    expect(result.answer).toMatch(/required canonical Metrora evidence was unavailable/i)
  })
})

function synthesisWorker(role: 'investigator' | 'verifier', answer: string): SwarmWorkerResultV1 {
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: 'run-synthesis',
    workerId: 'run-synthesis-' + role,
    role,
    profile: role === 'investigator' ? 'fixed-investigator-v1' : 'fixed-verifier-v1',
    status: 'completed',
    runtime: { id: 'ollama', label: 'Ollama local' },
    model: { id: 'model-a', label: 'model-a' },
    startedAt: '2026-08-31T00:00:00.000Z',
    endedAt: '2026-08-31T00:00:01.000Z',
    toolActivity: [{ name: 'get_spend_snapshot', status: 'completed' }],
    evidenceRefs: [{ id: 'overview.current', label: 'Measured spend and call totals' }],
    evidenceSummary: 'Usable canonical spend evidence: measured spend and call totals.',
    evidenceResult: { status: 'usable', requiredToolNames: ['get_spend_snapshot'], usedToolNames: ['get_spend_snapshot'] },
    answer,
    artifactSummary: null,
    errors: [],
    usage: null,
    resultDigest: 'digest-' + role,
  }
}

function synthesisInput(workers: readonly SwarmWorkerResultV1[]): SwarmSynthesisInputV1 {
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: 'run-synthesis',
    task: 'È vero che ho speso più di 4k in totale di AI? Verifica i dati disponibili e dammi una conclusione.',
    scope: { period: 'lifetime', provider: 'all', projectId: 'all', projectName: 'All projects', model: null },
    workers,
  }
}

describe('Native Harness Swarm synthesis boundary', () => {
  it('uses dedicated synthesis with the original task and normalized worker evidence', async () => {
    const workerAnswer = 'Metrora measured $12.00 in the selected period.'
    const generate = vi.fn(async () => { throw new Error('ordinary Harness generation must not synthesize Swarm') })
    let received: Parameters<NonNullable<AdvisorModelRuntime['generateSwarmSynthesis']>>[0] | undefined
    const generateSwarmSynthesis = vi.fn(async (input: Parameters<NonNullable<AdvisorModelRuntime['generateSwarmSynthesis']>>[0]) => {
      received = input
      return {
        answer: 'Verified spend is $12.00 from measured spend and call totals.',
        evidenceSummary: 'Both bounded workers agree on the measured spend evidence.',
      }
    })
    const runtime: AdvisorModelRuntime = { id: 'synthesis-fixture', label: 'Synthesis fixture', mode: 'ollama-local', providerSupport: ['fixture'], generate, generateSwarmSynthesis }
    const result = await createNativeHarnessSwarmSynthesizer(runtime)(synthesisInput([
      synthesisWorker('investigator', workerAnswer),
      synthesisWorker('verifier', workerAnswer),
    ]), new AbortController().signal)

    expect(generateSwarmSynthesis).toHaveBeenCalledOnce()
    expect(received?.question).toContain('È vero che ho speso più di 4k')
    expect(received?.workers[0]?.evidenceStatus).toBe('usable')
    expect(received?.workers[0]?.evidenceRefs).toEqual([{ id: 'overview.current', label: 'Measured spend and call totals' }])
    expect(generate).not.toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.answer).toContain('Verified spend is $12.00')
  })

  it('accepts a natural dedicated synthesis that answers the threshold question from canonical worker numbers', async () => {
    const workerAnswer = 'Metrora measured $4,118.17 in lifetime spend.'
    const runtime: AdvisorModelRuntime = {
      id: 'natural-synthesis-fixture',
      label: 'Natural synthesis fixture',
      mode: 'ollama-local',
      providerSupport: ['fixture'],
      generate: vi.fn(async () => { throw new Error('ordinary Harness generation must not synthesize Swarm') }),
      generateSwarmSynthesis: vi.fn(async () => ({
        answer: 'Sì: la spesa lifetime misurata è $4,118.17, quindi supera la soglia indicata.',
        evidenceSummary: 'Both workers reported the same lifetime spend.',
      })),
    }
    const result = await createNativeHarnessSwarmSynthesizer(runtime)(synthesisInput([
      synthesisWorker('investigator', workerAnswer),
      synthesisWorker('verifier', workerAnswer),
    ]), new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(result.answer).toContain('supera la soglia indicata')
    expect(result.errors).toEqual([])
  })

  it('rejects a dedicated synthesis that introduces an unsupported number', async () => {
    const workerAnswer = 'Metrora measured $12.00 in the selected period.'
    const runtime: AdvisorModelRuntime = {
      id: 'unsupported-number-fixture',
      label: 'Unsupported number fixture',
      mode: 'ollama-local',
      providerSupport: ['fixture'],
      generate: vi.fn(async () => { throw new Error('ordinary Harness generation must not synthesize Swarm') }),
      generateSwarmSynthesis: vi.fn(async () => ({
        answer: 'Metrora measured $99.00 in the selected period.',
        evidenceSummary: 'Unsupported numeric claim.',
      })),
    }
    const result = await createNativeHarnessSwarmSynthesizer(runtime)(synthesisInput([
      synthesisWorker('investigator', workerAnswer),
      synthesisWorker('verifier', workerAnswer),
    ]), new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(result.answer).toContain(workerAnswer)
    expect(result.answer).not.toContain('$99.00')
    expect(result.errors.join(' ')).toMatch(/safe supported explanation|worker closeout/i)
  })

  it.each([
    '',
    'Hello. I can help you understand spend, models, Projects, sessions, quota, and Bench results.',
  ])('falls back to worker closeouts for empty or generic synthesis output', async generatedAnswer => {
    const workerAnswer = 'Metrora measured $12.00 in the selected period.'
    const runtime: AdvisorModelRuntime = {
      id: 'malformed-synthesis-fixture',
      label: 'Malformed synthesis fixture',
      mode: 'ollama-local',
      providerSupport: ['fixture'],
      generate: vi.fn(async () => { throw new Error('ordinary Harness generation must not synthesize Swarm') }),
      generateSwarmSynthesis: vi.fn(async () => ({ answer: generatedAnswer, evidenceSummary: 'Generic or malformed output.' })),
    }
    const result = await createNativeHarnessSwarmSynthesizer(runtime)(synthesisInput([
      synthesisWorker('investigator', workerAnswer),
      synthesisWorker('verifier', workerAnswer),
    ]), new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(result.answer).toContain(workerAnswer)
    expect(result.answer).not.toBe(generatedAnswer)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
