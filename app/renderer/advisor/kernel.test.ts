// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { createAdvisorConformanceFixture } from './conformance'
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
  it('passes controller-selected canonical evidence before model generation', async () => {
    const data = source()
    const inputs: AdvisorRuntimeInput[] = []
    await createAdvisorKernel(data, capturingRuntime(inputs)).investigate({ question: 'What changed in spend?', scope })

    expect(data.getOverview).toHaveBeenCalledOnce()
    expect(inputs[0]?.evidence).toMatchObject({
      intent: 'spend-change',
      coverage: { level: 'high' },
      refs: [expect.objectContaining({ id: 'overview.current' })],
    })
    expect(inputs[0]?.requiredToolRequests).toEqual([{ tool: 'get_spend_snapshot', arguments: {} }])
    expect(inputs[0]?.guard?.intent).toBe('unknown')
    expect(inputs[0]?.plan?.questionFamily).toBe('spend')
  })

  it('executes the mandatory spend read for the Italian over-4k question and grounds the answer', async () => {
    const fixture = createAdvisorConformanceFixture()
    const events: Array<{ name: string; status: string }> = []
    const answer = await createAdvisorKernel(fixture.source, new DeterministicAdvisorRuntime()).investigate({
      question: 'È vero che ho speso più di 4k in totale di AI? Verifica i dati disponibili e dammi una conclusione.',
      scope: fixture.scope,
      onToolEvent: event => events.push(event),
    })

    expect(fixture.reads.overviews).toHaveLength(1)
    expect(fixture.reads.overviews[0]).toMatchObject({ period: 'lifetime' })
    expect(events).toEqual([
      { name: 'get_spend_snapshot', status: 'queued' },
      { name: 'get_spend_snapshot', status: 'started' },
      { name: 'get_spend_snapshot', status: 'completed' },
    ])
    expect(answer.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'overview.current' })]))
    expect(answer.coverage.level).toBe('high')
    expect(answer.conclusion).toContain('12.00')
    expect(answer.conclusion).not.toMatch(/Buongiorno|Hello\. I can help you understand spend/i)
  })

  it('falls back to canonical evidence when a capable model returns generic factual prose', async () => {
    const fixture = createAdvisorConformanceFixture()
    const runtime: AdvisorModelRuntime = {
      id: 'generic-model',
      label: 'Generic model',
      mode: 'ollama-local',
      providerSupport: ['fixture'],
      availability: 'ready',
      generate: async () => ({
        conclusion: 'Hello. I can help you understand spend, models, Projects, sessions, quota, and Bench results.',
        scopeLabel: 'Today',
        periodLabel: 'Today',
        evidence: [],
        coverage: { level: 'high', label: 'High coverage', detail: 'The model returned text.' },
        assumptions: [],
        unknown: [],
        nextInvestigations: [],
        details: [],
        runtime: { id: 'generic-model', label: 'Generic model', mode: 'ollama-local' },
      }),
    }
    const answer = await createAdvisorKernel(fixture.source, runtime).investigate({
      question: 'È vero che ho speso più di 4k in totale di AI? Verifica i dati disponibili e dammi una conclusione.',
      scope: fixture.scope,
    })

    expect(answer.conclusion).toContain('12.00')
    expect(answer.conclusion).not.toMatch(/Hello\. I can help you understand spend/i)
    expect(answer.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'overview.current' })]))
    expect(answer.coverage.level).toBe('high')
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
