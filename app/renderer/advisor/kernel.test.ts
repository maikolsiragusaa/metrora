import { describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { createAdvisorKernel } from './kernel'
import { ADVISOR_TURN_TIMEOUT_MS } from './kernel'
import { DeterministicAdvisorRuntime } from './runtime'
import type { AdvisorDataSource, AdvisorModelRuntime, AdvisorRuntimeInput, AdvisorScope } from './types'

const scope: AdvisorScope = { period: 'week', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null }
const measured = {
  current: { cost: 12, calls: 3, sessions: 2, pricingCoverage: 1, topModels: [], topProjects: [], topSessions: [] },
  history: { daily: [] },
} as unknown as MenubarPayload

function source(): AdvisorDataSource {
  return { getOverview: vi.fn(async () => measured), getModels: vi.fn(async () => []), getQuota: vi.fn(async () => []) }
}
function capturingRuntime(inputs: AdvisorRuntimeInput[]): AdvisorModelRuntime {
  return {
    id: 'capture', label: 'capture', mode: 'ollama-local', providerSupport: [],
    generate: async input => {
      inputs.push(input)
      return new DeterministicAdvisorRuntime().generate(input)
    },
  }
}

describe('Advisor model planning boundary', () => {
  it('passes neutral model context before any canonical evidence read', async () => {
    const data = source()
    const inputs: AdvisorRuntimeInput[] = []
    await createAdvisorKernel(data, capturingRuntime(inputs)).investigate({ question: 'What changed in spend?', scope })

    expect(data.getOverview).not.toHaveBeenCalled()
    expect(inputs[0]?.evidence).toMatchObject({ intent: 'social', coverage: { level: 'high', label: 'Conversation' }, refs: [] })
    expect(inputs[0]?.guard?.intent).toBe('unknown')
    expect(inputs[0]?.plan?.questionFamily).toBe('spend')
  })

  it('does not fetch or manufacture evidence for an unrecognized no-tool question', async () => {
    const data = source()
    const inputs: AdvisorRuntimeInput[] = []
    await createAdvisorKernel(data, capturingRuntime(inputs)).investigate({ question: 'Tell me a joke', scope })

    expect(data.getOverview).not.toHaveBeenCalled()
    expect(inputs[0]?.evidence).toMatchObject({ intent: 'social', coverage: { level: 'high', label: 'Conversation' }, refs: [] })
  })

  it('applies one bounded timeout to a stalled model turn', async () => {
    vi.useFakeTimers()
    try {
      const runtime: AdvisorModelRuntime = {
        id: 'stalled',
        label: 'stalled',
        mode: 'ollama-local',
        providerSupport: [],
        generate: async () => new Promise<never>(() => {}),
      }
      const pending = createAdvisorKernel(source(), runtime).investigate({ question: 'What changed in spend?', scope })
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AdvisorTimeoutError' })

      await vi.advanceTimersByTimeAsync(ADVISOR_TURN_TIMEOUT_MS)

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a stalled model turn without waiting for the global timeout', async () => {
    vi.useFakeTimers()
    try {
      const runtime: AdvisorModelRuntime = {
        id: 'stalled',
        label: 'stalled',
        mode: 'ollama-local',
        providerSupport: [],
        generate: async () => new Promise<never>(() => {}),
      }
      const controller = new AbortController()
      const pending = createAdvisorKernel(source(), runtime).investigate({ question: 'What changed in spend?', scope, signal: controller.signal })
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AdvisorCancelledError' })

      controller.abort()

      await rejection
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
