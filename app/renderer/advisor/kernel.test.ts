// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { createAdvisorConformanceFixture } from './conformance'
import { createAdvisorKernel } from './kernel'
import { OllamaAdvisorRuntime } from './ollama'
import { DeterministicAdvisorRuntime } from './runtime'
import { createAdvisorOverviewSnapshot } from './tools'
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
  it('starts the model with the authorized turn plan and minimum-read contract', async () => {
    const data = source()
    const inputs: AdvisorRuntimeInput[] = []
    await createAdvisorKernel(data, capturingRuntime(inputs)).investigate({ question: 'What changed in spend?', scope })

    expect(data.getOverview).toHaveBeenCalledOnce()
    expect(inputs[0]?.evidence).toMatchObject({ intent: 'spend-change', refs: [expect.objectContaining({ id: 'overview.current' })], coverage: { level: 'high' } })
    expect(inputs[0]?.requiredEvidence).toEqual([expect.objectContaining({ intent: 'spend-change', refs: [expect.objectContaining({ id: 'overview.current' })] })])
    expect(inputs[0]?.requiredToolRequests).toEqual([{ tool: 'get_spend_snapshot', arguments: {} }])
    expect(inputs[0]?.tools?.map(tool => tool.function.name)).toEqual(expect.arrayContaining(['get_spend_snapshot', 'get_project_drivers', 'get_session_highlights']))
    expect(inputs[0]?.guard?.intent).toBe('unknown')
    expect(inputs[0]?.plan?.questionFamily).toBe('spend')
  })

  it('fails closed when the explicit question period conflicts with the selected UI scope', async () => {
    const fixture = createAdvisorConformanceFixture()
    const answer = await createAdvisorKernel(fixture.source, new DeterministicAdvisorRuntime()).investigate({
      question: 'How much have I spent in total?',
      scope: { ...fixture.scope, period: 'today' },
    })

    expect(fixture.reads.overviews).toHaveLength(0)
    expect(answer.plan?.scopeConflict).toMatchObject({ currentPeriod: 'today', requestedPeriod: 'lifetime' })
    expect(answer.understanding?.scopeConflict?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'use-requested-period' }),
      expect.objectContaining({ id: 'change-scope' }),
    ]))
    expect(answer.conclusion).toMatch(/Lifetime|totale/i)
    expect(answer.evidence).toEqual([])
  })

  it('fetches Lifetime for the Chat kernel instead of reusing a cached Today overview', async () => {
    const today = { ...measured, current: { ...measured.current!, cost: 0.96 } } as unknown as MenubarPayload
    const lifetime = { ...measured, current: { ...measured.current!, cost: 4118.17 } } as unknown as MenubarPayload
    const fixture = createAdvisorConformanceFixture({ overview: lifetime })
    const lifetimeScope = { ...fixture.scope, period: 'lifetime' as const }
    const answer = await createAdvisorKernel(fixture.source, new DeterministicAdvisorRuntime()).investigate({
      question: 'How much have I spent in lifetime?',
      scope: lifetimeScope,
      overview: createAdvisorOverviewSnapshot({ ...fixture.scope, period: 'today' }, today),
    })

    expect(fixture.reads.overviews).toHaveLength(1)
    expect(fixture.reads.overviews[0]).toMatchObject({ period: 'lifetime' })
    expect(answer.conclusion).toMatch(/4,118\.17|4118\.17/u)
    expect(answer.conclusion).not.toContain('0.96')
  })

  it('executes the mandatory spend read before the first model step and returns natural same-turn synthesis', async () => {
    const fixture = createAdvisorConformanceFixture()
    const events: Array<{ name: string; status: string }> = []
    const requests: Array<Record<string, unknown>> = []
    let calls = 0
    const runtime = new OllamaAdvisorRuntime({
      model: 'chat-model',
      transport: {
        probe: async () => ({ available: true, models: ['chat-model'], detail: 'ready' }),
        cancel: async () => true,
        onDelta: () => () => {},
        chat: async (_requestId, payload) => {
          requests.push(payload)
          calls += 1
          return { streamed: false, message: { content: 'Metrora measured $12.00 in lifetime spend; that is the verified total for the selected scope.' } }
        },
      },
    })
    const answer = await createAdvisorKernel(fixture.source, runtime).investigate({
      question: 'È vero che ho speso più di 4k in totale di AI? Verifica i dati disponibili e dammi una conclusione.',
      scope: { ...fixture.scope, period: 'lifetime' },
      onToolEvent: event => events.push(event),
    })

    expect(fixture.reads.overviews).toHaveLength(1)
    expect(fixture.reads.overviews[0]).toMatchObject({ period: 'lifetime' })
    expect(events).toEqual([
      { name: 'get_spend_snapshot', status: 'queued' },
      { name: 'get_spend_snapshot', status: 'started' },
      { name: 'get_spend_snapshot', status: 'completed' },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'system', content: expect.stringContaining('Canonical evidence already verified') }),
    ]))
    expect((requests[0]?.messages as Array<Record<string, unknown>>).some(message => message.role === 'assistant' && message.toolCalls)).toBe(false)
    expect(answer.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'overview.current' })]))
    expect(answer.coverage.level).toBe('high')
    expect(answer.conclusion).toContain('$12.00')
    expect(answer.generatedByModel).toBe(true)
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
      scope: { ...fixture.scope, period: 'lifetime' },
    })

    expect(answer.conclusion).toMatch(/12[.,]00/u)
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
    expect(inputs[0]?.tools).toBeUndefined()
    expect(inputs[0]?.toolContract).toBeUndefined()
  })

  it('lets the model request one bounded follow-up Tool after the controller baseline read', async () => {
    const fixture = createAdvisorConformanceFixture()
    const events: Array<{ name: string; status: string }> = []
    const requests: Array<Record<string, unknown>> = []
    let calls = 0
    const runtime = new OllamaAdvisorRuntime({
      model: 'follow-up-model',
      transport: {
        probe: async () => ({ available: true, models: ['follow-up-model'], detail: 'ready' }),
        cancel: async () => true,
        onDelta: () => () => {},
        chat: async (_requestId, payload) => {
          requests.push(payload)
          calls += 1
          return calls === 1
            ? { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_project_drivers', arguments: '{}' } }] } }
            : { streamed: false, message: { content: 'Metrora measured $12.00 in lifetime spend; Project A is the observed project contributing to it.' } }
        },
      },
    })
    const answer = await createAdvisorKernel(fixture.source, runtime).investigate({
      question: 'Which projects are contributing most to lifetime spend?',
      scope: { ...fixture.scope, period: 'lifetime' },
      onToolEvent: event => events.push(event),
    })

    expect(fixture.reads.overviews).toHaveLength(2)
    expect(events).toEqual([
      { name: 'get_spend_snapshot', status: 'queued' },
      { name: 'get_spend_snapshot', status: 'started' },
      { name: 'get_spend_snapshot', status: 'completed' },
      { name: 'get_project_drivers', status: 'queued' },
      { name: 'get_project_drivers', status: 'started' },
      { name: 'get_project_drivers', status: 'completed' },
    ])
    expect(requests).toHaveLength(2)
    expect(requests[0]?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: 'get_project_drivers' }) }),
    ]))
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', toolCalls: expect.arrayContaining([expect.objectContaining({ name: 'get_project_drivers' })]) }),
      expect.objectContaining({ role: 'tool', toolCallId: expect.any(String) }),
    ]))
    expect(answer.generatedByModel).toBe(true)
    expect(answer.conclusion).toContain('$12.00')
  })

  it('reports a selected-model failure without switching into deterministic evidence mode', async () => {
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
    expect(fixtureSource.getOverview).toHaveBeenNthCalledWith(1, expect.objectContaining({ period: 'week' }))
    expect(fixtureSource.getOverview).toHaveBeenNthCalledWith(2, expect.objectContaining({ period: 'lifetime' }))
    expect(answer.conclusion).toContain('selected model could not finish')
    expect(answer.conclusion).not.toContain('offline evidence')
    expect(answer.runtimeFailure).toBe(true)
  })
})
