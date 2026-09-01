import { describe, expect, it, vi } from 'vitest'
import type { MenubarPayload } from '../lib/types'
import { createAdvisorConformanceFixture } from '../advisor/conformance'
import { DeterministicAdvisorRuntime } from '../advisor/runtime'
import type { AdvisorAnswer, AdvisorDataSource, AdvisorRuntimeInput, AdvisorModelRuntime } from '../advisor/types'
import { createBaselineWorkerRequests } from '../../../src/swarm/coordinator-v1'
import type { SwarmEventV1, SwarmSynthesisInputV1, SwarmWorkerResultV1 } from '../../../src/swarm/contract-v1'
import { NativeHarnessWorkerAdapter, createNativeHarnessSwarmSynthesizer } from './native-worker-adapter'

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

  it('gives Investigator and Verifier distinct trusted responsibilities and independent canonical reads', async () => {
    const fixture = createAdvisorConformanceFixture()
    const inputs: AdvisorRuntimeInput[] = []
    const runtime: AdvisorModelRuntime = {
      id: 'role-fixture',
      label: 'Role fixture',
      mode: 'ollama-local',
      providerSupport: ['fixture'],
      availability: 'ready',
      generate: vi.fn(async (input: AdvisorRuntimeInput) => {
        inputs.push(input)
        return new DeterministicAdvisorRuntime().generate(input)
      }),
    }
    const adapter = new NativeHarnessWorkerAdapter({ source: fixture.source, runtime, overview: null, now: () => '2026-08-31T00:00:00.000Z' })
    const requests = createBaselineWorkerRequests({
      runId: 'run-role-semantics',
      task: 'È vero che ho speso più di 4k in totale di AI? Verifica i dati disponibili e dammi una conclusione.',
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
    expect(events.filter(event => event.kind === 'worker' && event.status === 'tool-started')).toHaveLength(4)
    expect(events.filter(event => event.kind === 'worker' && event.status === 'tool-completed')).toHaveLength(2)
  })

  it('keeps a terminal worker closeout truthful when the required canonical read is unavailable', async () => {
    const fixture = createAdvisorConformanceFixture()
    const failingSource: AdvisorDataSource = {
      ...fixture.source,
      getOverview: vi.fn(async () => { throw new Error('canonical spend source unavailable') }),
    }
    const runtime: AdvisorModelRuntime = {
      id: 'generic-fixture',
      label: 'Generic fixture',
      mode: 'ollama-local',
      providerSupport: ['fixture'],
      availability: 'ready',
      generate: vi.fn(async () => ({
        conclusion: 'Hello. I can help you understand spend.',
        scopeLabel: 'Today',
        periodLabel: 'Today',
        evidence: [],
        coverage: { level: 'high', label: 'High coverage', detail: 'The model returned text.' },
        assumptions: [],
        unknown: [],
        nextInvestigations: [],
        details: [],
        runtime: { id: 'generic-fixture', label: 'Generic fixture', mode: 'ollama-local' },
      } satisfies AdvisorAnswer)),
    }
    const adapter = new NativeHarnessWorkerAdapter({ source: failingSource, runtime, overview: null, now: () => '2026-08-31T00:00:00.000Z' })
    const [request] = createBaselineWorkerRequests({
      runId: 'run-unavailable-evidence',
      task: 'È vero che ho speso più di 4k in totale di AI? Verifica i dati disponibili e dammi una conclusione.',
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
    expect(result.answer).not.toMatch(/Hello\. I can help you understand spend/i)
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
