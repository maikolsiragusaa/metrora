import { describe, expect, it, vi } from 'vitest'
import {
  createBaselineSwarmCoordinator,
  createBaselineWorkerRequests,
  SWARM_DEFAULT_WORKERS,
  SWARM_DEFAULT_MAX_TOOL_ROUNDS,
  SWARM_MAX_WORKERS,
} from '../src/swarm/coordinator-v1'
import type {
  SwarmEventV1,
  SwarmRunResultV1,
  SwarmWorkerRequestV1,
  SwarmWorkerResultV1,
} from '../src/swarm/contract-v1'
import type {
  WorkerAdapterObserveV1,
  WorkerAdapterStartOptionsV1,
  WorkerAdapterV1,
  WorkerExecutionV1,
} from '../src/swarm/worker-adapter-v1'

const input = {
  task: 'Explain the observed spend change using Metrora evidence.',
  scope: { period: 'today', provider: 'all', project: 'all' },
  runtime: { id: 'ollama', label: 'Ollama local' },
  model: { id: 'llama3.2', label: 'llama3.2' },
  allowedToolNames: ['get_spend_snapshot', 'get_project_drivers'],
} as const

function result(request: SwarmWorkerRequestV1, status: SwarmWorkerResultV1['status'] = 'completed'): SwarmWorkerResultV1 {
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: request.runId,
    workerId: request.workerId,
    role: request.role,
    profile: request.profile,
    status,
    runtime: request.runtime,
    model: request.model,
    startedAt: request.deadline.startedAt,
    endedAt: request.deadline.startedAt,
    toolActivity: [{ name: 'get_spend_snapshot', status: 'completed' }],
    evidenceRefs: [{ id: 'spend', label: 'Measured spend' }],
    evidenceSummary: 'Canonical Metrora evidence.',
    answer: 'Observed evidence is available.',
    artifactSummary: null,
    errors: status === 'completed' ? [] : ['fixture outcome'],
    usage: null,
    resultDigest: 'fixture-' + request.workerId,
  }
}

function expectDigestIdentity(output: SwarmRunResultV1): void {
  expect(output.workers).toHaveLength(output.evidence.workers.length)
  output.workers.forEach((worker, index) => {
    expect(worker.resultDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(output.evidence.workers[index]?.resultDigest).toBe(worker.resultDigest)
  })
}

class FixtureAdapter implements WorkerAdapterV1 {
  readonly adapterId = 'fixture-replacement-adapter-v1'
  readonly started: string[] = []
  readonly cancelled: string[] = []
  active = 0
  maxActive = 0
  private readonly outcomes: Record<number, SwarmWorkerResultV1['status'] | 'late'> = {}
  private readonly deferred = new Map<string, { resolve: () => void }>()

  constructor(outcomes: Record<number, SwarmWorkerResultV1['status'] | 'late'> = {}) {
    this.outcomes = outcomes
  }

  start(request: SwarmWorkerRequestV1, observe: WorkerAdapterObserveV1, _options: WorkerAdapterStartOptionsV1 = {}): WorkerExecutionV1 {
    this.started.push(request.workerId)
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'started', at: request.deadline.startedAt })
    observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'tool-started', at: request.deadline.startedAt, toolName: 'get_spend_snapshot' })
    const outcome = this.outcomes[Number(request.workerId.split('-').pop())] ?? 'completed'
    let settled = false
    let resolvePromise!: (value: SwarmWorkerResultV1) => void
    let rejectPromise!: (reason?: unknown) => void
    const promise = new Promise<SwarmWorkerResultV1>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const finish = (status: SwarmWorkerResultV1['status']) => {
      if (settled) return
      settled = true
      this.active -= 1
      resolvePromise(result(request, status))
    }
    if (outcome === 'late') {
      this.deferred.set(request.workerId, { resolve: () => finish('completed') })
    } else if (outcome === 'failed') {
      queueMicrotask(() => {
        if (!settled) {
          settled = true
          this.active -= 1
          rejectPromise(new Error('fixture failure'))
        }
      })
    } else {
      queueMicrotask(() => finish(outcome))
    }
    return {
      workerId: request.workerId,
      result: promise,
      cancel: () => {
        this.cancelled.push(request.workerId)
        if (outcome !== 'late') finish('cancelled')
      },
    }
  }

  async run(request: SwarmWorkerRequestV1, observe?: WorkerAdapterObserveV1, options?: WorkerAdapterStartOptionsV1): Promise<SwarmWorkerResultV1> {
    return this.start(request, observe ?? (() => {}), options).result
  }

  async cancel(workerId: string): Promise<void> {
    this.cancelled.push(workerId)
  }

  resolveLate(): void {
    for (const deferred of this.deferred.values()) deferred.resolve()
    this.deferred.clear()
  }
}

function coordinator(adapter: FixtureAdapter, extra: Partial<Parameters<typeof createBaselineSwarmCoordinator>[0]> = {}) {
  return createBaselineSwarmCoordinator({
    adapter,
    createRunId: () => 'run-fixture',
    now: () => '2026-08-31T00:00:00.000Z',
    cancellationGraceMs: 0,
    ...extra,
  })
}

describe('public Swarm baseline coordinator', () => {
  it('creates two fixed transparent roles by default and never recursively spawns', () => {
    const requests = createBaselineWorkerRequests({ ...input, runId: 'run-roles' })
    expect(requests).toHaveLength(SWARM_DEFAULT_WORKERS)
    expect(requests.map(request => request.role)).toEqual(['investigator', 'verifier'])
    expect(requests.map(request => request.profile)).toEqual(['fixed-investigator-v1', 'fixed-verifier-v1'])
    expect(requests[0]?.limits.maxToolRounds).toBe(SWARM_DEFAULT_MAX_TOOL_ROUNDS)
    expect(() => createBaselineWorkerRequests({ ...input, runId: 'two-rounds', limits: { maxToolRounds: 2 } })).toThrow()
    const safeIdentity = createBaselineWorkerRequests({
      ...input,
      runId: 'run-safe-identity',
      runtime: { id: 'ollama', label: 'Ollama C:\\Users\\founder\\model' },
    })[0]!
    expect(safeIdentity.runtime.label).not.toContain('Users')
    expect(requests[0]?.scope).not.toBe(input.scope)
    expect(Object.isFrozen(requests[0])).toBe(true)
    expect(() => createBaselineWorkerRequests({ ...input, runId: 'too-many', workerCount: SWARM_MAX_WORKERS + 1 })).toThrow()
  })

  it('runs two workers in bounded parallel, synthesizes both results, and emits one terminal closeout', async () => {
    const adapter = new FixtureAdapter()
    const events: SwarmEventV1[] = []
    const output = await coordinator(adapter).run(input, event => events.push(event))
    expect(output.status).toBe('completed')
    expect(output.workers).toHaveLength(2)
    expect(output.synthesis?.status).toBe('completed')
    expect(adapter.maxActive).toBe(2)
    expect(events.some(event => event.kind === 'worker' && event.status === 'tool-started')).toBe(true)
    expect(events.at(-1)).toMatchObject({ kind: 'swarm', status: 'completed' })
    expect(events.filter(event => event.kind === 'swarm' && event.status === 'completed')).toHaveLength(1)
    expectDigestIdentity(output)
  })

  it('bounds one worker that ignores cancellation while retaining the completed worker result', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new FixtureAdapter({ 2: 'late' })
      const events: SwarmEventV1[] = []
      const handle = coordinator(adapter).start({
        ...input,
        limits: { timeoutMs: 20 },
        wholeRunTimeoutMs: 1_000,
      }, event => events.push(event))
      await vi.advanceTimersByTimeAsync(21)
      const output = await handle.result

      expect(output.status).toBe('partial')
      expect(output.workers.map(worker => worker.status)).toEqual(['completed', 'timeout'])
      expect(output.synthesis?.answer).toContain('Observed evidence is available.')
      expect(events.at(-1)).toMatchObject({ kind: 'swarm', status: 'completed' })
      expect(events.filter(event => event.kind === 'swarm' && event.status === 'completed')).toHaveLength(1)
      adapter.resolveLate()
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
  })

  it('isolates one failed worker and returns truthful partial completion', async () => {
    const output = await coordinator(new FixtureAdapter({ 2: 'failed' })).run(input)
    expect(output.status).toBe('partial')
    expect(output.workers.map(worker => worker.status)).toEqual(['completed', 'failed'])
    expect(output.synthesis?.answer).toContain('Partial evidence')
    expectDigestIdentity(output)
  })

  it('marks complete failure as failed without inventing a synthesis answer', async () => {
    const output = await coordinator(new FixtureAdapter({ 1: 'unavailable', 2: 'failed' })).run(input)
    expect(output.status).toBe('failed')
    expect(output.synthesis).toBeNull()
    expect(output.evidence.finalStatus).toBe('failed')
    expectDigestIdentity(output)
  })

  it('fans cancellation out and suppresses a late worker result/event', async () => {
    const adapter = new FixtureAdapter({ 1: 'late', 2: 'late' })
    const events: SwarmEventV1[] = []
    const handle = coordinator(adapter).start(input, event => events.push(event))
    await Promise.resolve()
    handle.cancel()
    const output = await handle.result
    const eventCount = events.length
    expect(output.status).toBe('cancelled')
    expect(output.workers.every(worker => worker.status === 'cancelled')).toBe(true)
    expect(adapter.cancelled.length).toBeGreaterThanOrEqual(2)
    expectDigestIdentity(output)
    adapter.resolveLate()
    await Promise.resolve()
    expect(events).toHaveLength(eventCount)
  })

  it('uses a bounded whole-run timeout and no late result can overwrite it', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new FixtureAdapter({ 1: 'late', 2: 'late' })
      const promise = coordinator(adapter).run({ ...input, wholeRunTimeoutMs: 1_000 })
      await vi.advanceTimersByTimeAsync(1_001)
      const output = await promise
      expect(output.status).toBe('timeout')
      expect(output.workers.every(worker => worker.status === 'timeout')).toBe(true)
      expectDigestIdentity(output)
      adapter.resolveLate()
    } finally {
      vi.useRealTimers()
    }
  })

  it('enforces each worker deadline independently of the whole-run timeout', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new FixtureAdapter({ 1: 'late', 2: 'late' })
      const promise = coordinator(adapter).run({
        ...input,
        limits: { timeoutMs: 1_000 },
        wholeRunTimeoutMs: 5_000,
      })
      await vi.advanceTimersByTimeAsync(1_001)
      const output = await promise
      expect(output.status).toBe('timeout')
      expect(output.workers.every(worker => worker.status === 'timeout')).toBe(true)
      expect(output.synthesis).toBeNull()
      expectDigestIdentity(output)
      adapter.resolveLate()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a late synthesis from overwriting cancellation', async () => {
    let resolveSynthesis!: (value: { status: 'completed'; answer: string; evidenceSummary: string; errors: string[] }) => void
    let markSynthesisStarted!: () => void
    const synthesisStarted = new Promise<void>(resolve => { markSynthesisStarted = resolve })
    const lateSynthesis = new Promise<{ status: 'completed'; answer: string; evidenceSummary: string; errors: string[] }>(resolve => { resolveSynthesis = resolve })
    const handle = coordinator(new FixtureAdapter(), {
      synthesize: async () => {
        markSynthesisStarted()
        return lateSynthesis
      },
    }).start(input)
    await synthesisStarted
    handle.cancel()
    resolveSynthesis({ status: 'completed', answer: 'late', evidenceSummary: 'late', errors: [] })
    const output = await handle.result
    expect(output.status).toBe('cancelled')
    expect(output.synthesis?.status).toBe('cancelled')
    expect(output.synthesis?.answer).toBe('')
  })

  it('uses deterministic worker closeout when synthesis ignores its bounded deadline', async () => {
    vi.useFakeTimers()
    try {
      let markSynthesisStarted!: () => void
      const synthesisStarted = new Promise<void>(resolve => { markSynthesisStarted = resolve })
      const adapter = new FixtureAdapter()
      const events: SwarmEventV1[] = []
      const handle = coordinator(adapter, {
        synthesisTimeoutMs: 20,
        synthesize: async () => {
          markSynthesisStarted()
          return await new Promise<SwarmRunResultV1['synthesis']>(() => {}) as never
        },
      }).start({ ...input, wholeRunTimeoutMs: 1_000 }, event => events.push(event))
      await synthesisStarted
      await vi.advanceTimersByTimeAsync(21)
      const output = await handle.result

      expect(output.status).toBe('completed')
      expect(output.synthesis?.status).toBe('completed')
      expect(output.synthesis?.answer).toContain('Observed evidence is available.')
      expect(output.synthesis?.errors.join(' ')).toContain('bounded deadline')
      expect(events.at(-1)).toMatchObject({ kind: 'swarm', status: 'completed' })
      expect(events.filter(event => event.kind === 'swarm' && event.status === 'completed')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
