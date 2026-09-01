// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AdvisorAnswer, AdvisorModelRuntime } from '../advisor/types'
import { createAdvisorConformanceFixture } from '../advisor/conformance'
import { useSwarmRun, type UseSwarmRunOptions } from './useSwarmRun'

function options(runtime: AdvisorModelRuntime, overview: UseSwarmRunOptions['overview']): UseSwarmRunOptions {
  const fixture = createAdvisorConformanceFixture()
  return {
    source: fixture.source,
    runtime,
    scope: fixture.scope,
    overview,
    modelId: 'fixture-model',
    modelLabel: 'fixture-model',
    enabled: true,
  }
}

function abortableHangingRuntime(): AdvisorModelRuntime {
  return {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    mode: 'hosted-byok',
    providerSupport: ['opencode-zen'],
    availability: 'ready',
    supportsStreaming: false,
    generate: (_input, signal) => new Promise<AdvisorAnswer>((_resolve, reject) => {
      const abort = () => reject(new DOMException('provider cancelled', 'AbortError'))
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    }),
  }
}

describe('useSwarmRun foreground lifecycle', () => {
  it('frees the composer on cancel and after coordinator replacement, then allows another run', async () => {
    const fixture = createAdvisorConformanceFixture()
    const runtime = abortableHangingRuntime()
    const initial = options(runtime, fixture.overview)
    const { result, rerender, unmount } = renderHook(props => useSwarmRun(props), { initialProps: initial })

    act(() => result.current.run('What changed in spend?'))
    expect(result.current.state.running).toBe(true)

    // Polling a fresh overview recreates the adapter/coordinator while the
    // old provider call is still in flight. The old run must no longer own
    // the foreground handle.
    rerender({ ...initial, overview: { ...fixture.overview } })
    await waitFor(() => expect(result.current.state.running).toBe(false))
    expect(result.current.state.status).toBe('cancelled')

    act(() => result.current.run('Try the next bounded run'))
    expect(result.current.state.running).toBe(true)
    act(() => result.current.cancel())
    expect(result.current.state.running).toBe(false)
    expect(result.current.state.status).toBe('cancelled')

    unmount()
  })
})
