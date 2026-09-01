// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { createAdvisorKernel } from './kernel'
import { OllamaAdvisorRuntime } from './ollama'
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

  it('keeps explicit bounded comparison periods and model filters through deterministic fallback', async () => {
    const fixtureOverview = {
      ...measured,
      current: { ...measured.current!, cost: 12, calls: 3, sessions: 2 },
    } as unknown as MenubarPayload
    const fixtureSource: AdvisorDataSource = {
      getOverview: vi.fn(async (requestedScope, signal) => {
        if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
        return {
          ...fixtureOverview,
          current: {
            ...fixtureOverview.current!,
            cost: requestedScope.period === 'lifetime' ? 42 : 12,
            calls: requestedScope.period === 'lifetime' ? 9 : 3,
          },
        }
      }),
      getModels: vi.fn(async () => []),
      getQuota: vi.fn(async () => []),
    }
    const runtime = new OllamaAdvisorRuntime({
      model: 'synthetic-model',
      transport: {
        probe: async () => ({ available: true, models: ['synthetic-model'], detail: 'synthetic' }),
        chat: async () => ({ streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{' } }] } }),
        cancel: async () => true,
        onDelta: () => () => {},
      },
    })

    const answer = await createAdvisorKernel(fixtureSource, runtime).investigate({
      question: 'Show spend for this week and lifetime.',
      scope,
    })

    expect(fixtureSource.getOverview).toHaveBeenCalledTimes(2)
    expect((fixtureSource.getOverview as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ period: 'week', model: null }),
      expect.objectContaining({ period: 'lifetime', model: null }),
    ])
    expect(answer.conclusion).toContain('12')
    expect(answer.conclusion).toContain('42')
    expect(answer.coverage.level).toBe('high')
  })
})
