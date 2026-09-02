// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AdvisorAnswer, AdvisorDataSource, AdvisorModelRuntime, AdvisorRuntimeInput, AdvisorScope, AdvisorSwarmSynthesisResult } from '../advisor/types'
import { createAdvisorConformanceFixture } from '../advisor/conformance'
import type { MenubarPayload } from '../lib/types'
import { useSwarmRun, type UseSwarmRunOptions } from './useSwarmRun'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(value => { resolve = value })
  return { promise, resolve }
}

function answer(runtimeId: string, text: string): AdvisorAnswer {
  return {
    conclusion: text,
    scopeLabel: 'Today · All projects · All providers',
    periodLabel: 'Today',
    evidence: [],
    coverage: { level: 'high', label: 'Verified', detail: 'Bounded fixture evidence.' },
    assumptions: [],
    unknown: [],
    nextInvestigations: [],
    details: [],
    runtime: { id: runtimeId, label: runtimeId, mode: 'ollama-local' },
  }
}

function source(): AdvisorDataSource {
  return {
    getOverview: async () => createAdvisorConformanceFixture().overview,
    getModels: async () => [],
    getQuota: async () => [],
  }
}

function runtime(id: string, generate: AdvisorModelRuntime['generate'], generateSwarmSynthesis?: AdvisorModelRuntime['generateSwarmSynthesis']): AdvisorModelRuntime {
  return {
    id,
    label: 'Fixture runtime ' + id,
    mode: 'ollama-local',
    providerSupport: ['fixture'],
    availability: 'ready',
    supportsStreaming: false,
    generate,
    ...(generateSwarmSynthesis ? { generateSwarmSynthesis } : {}),
  }
}

function options(overrides: Partial<UseSwarmRunOptions> = {}): UseSwarmRunOptions {
  const fixture = createAdvisorConformanceFixture()
  const scope: AdvisorScope = {
    period: 'today',
    range: null,
    provider: 'all',
    projectId: 'all',
    projectName: 'All projects',
    model: null,
  }
  return {
    source: fixture.source,
    runtime: runtime('fixture', async () => answer('fixture', 'fixture answer')),
    scope,
    overview: fixture.overview,
    modelId: 'fixture-model',
    modelLabel: 'fixture-model',
    enabled: true,
    ...overrides,
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 24; index += 1) await Promise.resolve()
  await new Promise<void>(resolve => setImmediate(resolve))
  for (let index = 0; index < 24; index += 1) await Promise.resolve()
}

describe('useSwarmRun execution ownership', () => {
  it('keeps one run alive across polling and runtime-promotion replacements and closes after synthesis', async () => {
    const workerOne = deferred<AdvisorAnswer>()
    const workerTwo = deferred<AdvisorAnswer>()
    const synthesis = deferred<AdvisorSwarmSynthesisResult>()
    const signals: AbortSignal[] = []
    const generate = vi.fn(async (input: AdvisorRuntimeInput, signal?: AbortSignal) => {
      const workerIndex = signals.length
      if (signal) signals.push(signal)
      const required = input.requiredToolRequests?.[0]
      if (required) await input.executeTool?.(required.tool, required.arguments, signal)
      return (workerIndex === 0 ? workerOne : workerTwo).promise
    })
    const generateSwarmSynthesis = vi.fn(async (input: Parameters<NonNullable<AdvisorModelRuntime['generateSwarmSynthesis']>>[0]) => {
      expect(input.question).toBe('Explain the observed spend change.')
      return synthesis.promise
    })
    const initial = options({ runtime: runtime('fixture', generate, generateSwarmSynthesis) })
    const { result, rerender } = renderHook((props: UseSwarmRunOptions) => useSwarmRun(props), { initialProps: initial })

    act(() => result.current.run('Explain the observed spend change.', 2))
    await act(async () => { await flushMicrotasks() })
    expect(generate).toHaveBeenCalledTimes(2)

    const polledOverview = structuredClone(initial.overview) as MenubarPayload
    polledOverview.generated = 'poll-1'
    const promotedRuntimeGenerate = vi.fn(async () => answer('fixture', 'promoted runtime must not replace the run'))
    rerender({ ...initial, overview: polledOverview, runtime: runtime('fixture', promotedRuntimeGenerate) })

    expect(result.current.state.running).toBe(true)
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => !signal.aborted)).toBe(true)

    await act(async () => {
      workerOne.resolve(answer('fixture', 'worker one'))
      workerTwo.resolve(answer('fixture', 'worker two'))
      await flushMicrotasks()
    })
    expect(generate).toHaveBeenCalledTimes(2)

    await act(async () => {
      synthesis.resolve({ answer: 'Synthesized result: the bounded worker findings are grounded in the selected spend evidence.', evidenceSummary: 'Two bounded worker closeouts with the measured spend anchor.' })
      await flushMicrotasks()
    })
    await waitFor(() => expect(result.current.state.running).toBe(false))
    expect(result.current.state.status).toBe('completed')
    expect(result.current.state.result?.workers).toHaveLength(2)
    expect(result.current.state.result?.synthesis?.answer).toBe('Synthesized result: the bounded worker findings are grounded in the selected spend evidence.')
    expect(promotedRuntimeGenerate).not.toHaveBeenCalled()
  })

  it('keeps bounded timeout closeout effective while polling replaces overview repeatedly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const workerOne = deferred<AdvisorAnswer>()
      const workerTwo = deferred<AdvisorAnswer>()
      let workerIndex = 0
      const signals: AbortSignal[] = []
      const generate = vi.fn(async (_input: AdvisorRuntimeInput, signal?: AbortSignal) => {
        if (signal) signals.push(signal)
        return (workerIndex++ === 0 ? workerOne : workerTwo).promise
      })
      const generateSwarmSynthesis = vi.fn(async () => ({ answer: 'The bounded worker closeout has worker one completed while worker two timed out.', evidenceSummary: 'One worker completed before the other timed out.' }))
      const initial = options({ runtime: runtime('fixture', generate, generateSwarmSynthesis) })
      const { result, rerender } = renderHook((props: UseSwarmRunOptions) => useSwarmRun(props), { initialProps: initial })

      act(() => result.current.run('Close even when one worker stalls.', 2))
      await act(async () => { await flushMicrotasks() })
      expect(generate).toHaveBeenCalledTimes(2)
      await act(async () => {
        workerOne.resolve(answer('fixture', 'worker one completed'))
        await flushMicrotasks()
      })

      for (let index = 1; index <= 3; index += 1) {
        const polledOverview = structuredClone(initial.overview) as MenubarPayload
        polledOverview.generated = 'poll-' + index
        rerender({ ...initial, overview: polledOverview })
        expect(result.current.state.running).toBe(true)
      }
      expect(signals.every(signal => !signal.aborted)).toBe(true)

      await act(async () => { await vi.advanceTimersByTimeAsync(120_001) })
      vi.useRealTimers()
      await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 1_000, interval: 5 })
      expect(result.current.state.status).toBe('partial')
      expect(result.current.state.result?.workers.map(worker => worker.status)).toEqual(['completed', 'timeout'])
      expect(result.current.state.result?.synthesis?.answer).toBe('The bounded worker closeout has worker one completed while worker two timed out.')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['runtime', (initial: UseSwarmRunOptions, nextRuntime: AdvisorModelRuntime) => ({ ...initial, runtime: nextRuntime })],
    ['model', (initial: UseSwarmRunOptions) => ({ ...initial, modelId: 'model-b', modelLabel: 'model-b' })],
    ['scope', (initial: UseSwarmRunOptions) => ({ ...initial, scope: { ...initial.scope, period: 'week' as const } })],
  ] as const)('terminalizes the old run on an intentional %s switch and permits the next run', async (_kind, change) => {
    const firstWorker = deferred<AdvisorAnswer>()
    const secondWorker = deferred<AdvisorAnswer>()
    let calls = 0
    const nextSynthesis = async () => ({ answer: 'Next run completed with the bounded next-run worker closeout.', evidenceSummary: 'The next bounded run completed.' })
    const firstRuntime = runtime('fixture-a', async () => {
      calls += 1
      if (calls === 1) return firstWorker.promise
      if (calls === 2) return secondWorker.promise
      return answer('fixture-a', 'next run completed')
    }, nextSynthesis)
    const nextRuntime = runtime('fixture-b', async () => answer('fixture-b', 'next run completed'), nextSynthesis)
    const initial = options({ runtime: firstRuntime })
    const { result, rerender } = renderHook((props: UseSwarmRunOptions) => useSwarmRun(props), { initialProps: initial })

    act(() => result.current.run('The old run must be cancelled.', 2))
    await act(async () => { await flushMicrotasks() })
    expect(result.current.state.running).toBe(true)
    rerender(change(initial, nextRuntime))

    expect(result.current.state.running).toBe(false)
    expect(result.current.state.status).toBe('cancelled')

    act(() => result.current.run('The next run may start.', 2))
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 1_000, interval: 5 })
    expect(result.current.state.status).toBe('completed')
    expect(result.current.state.result?.synthesis?.answer).toBe('Next run completed with the bounded next-run worker closeout.')
  })
})
