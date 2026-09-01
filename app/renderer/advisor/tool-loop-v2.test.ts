// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { buildQuotaEvidence, buildSpendEvidence } from './evidence'
import { HostedAdvisorRuntime, type HostedAdvisorTransport } from './hosted'
import { OllamaAdvisorRuntime, type OllamaTransport } from './ollama'
import { HARNESS_TOOL_LOOP_LIMITS } from './limits'
import type { AdvisorEvidence, AdvisorScope, AdvisorToolDefinition, AdvisorToolName } from './types'
import { createAdvisorConformanceFixture } from './conformance'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function definition(name: AdvisorToolName): AdvisorToolDefinition {
  return { type: 'function', function: { name, description: name, parameters: { type: 'object' } } }
}

function planning(questionFamily: 'spend' | 'quota', toolNames: AdvisorToolName[]): string {
  return JSON.stringify({
    contractVersion: 'advisor-planning-draft-v1',
    schemaVersion: 1,
    turnKind: 'investigate',
    questionFamily,
    requestedEvidenceDomains: questionFamily === 'quota' ? ['provider-capacity', 'freshness'] : ['usage-totals', 'cost'],
    toolRequests: toolNames.map(tool => ({ tool, arguments: {} })),
    presentationIntent: 'text',
    expertDetailRequested: false,
    clarification: null,
  })
}

function localTransport(responses: string[], payloads: Array<Record<string, unknown>>): OllamaTransport {
  let index = 0
  return {
    probe: async () => ({ available: true, models: ['fixture-model'], detail: 'fixture' }),
    chat: async (_requestId, payload) => {
      payloads.push(payload)
      const content = responses[Math.min(index++, responses.length - 1)] ?? 'The verified evidence is sufficient.'
      return { streamed: false, message: { content, tool_calls: [] } }
    },
    cancel: async () => true,
    onDelta: () => () => {},
  }
}

function hostedTransport(responses: string[], payloads: Array<Record<string, unknown>>): HostedAdvisorTransport {
  let index = 0
  return {
    probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'fixture-model', label: 'fixture-model', state: 'verified', limitation: null }], detail: 'fixture', credentialState: 'ready' }),
    chat: async (_requestId, payload) => {
      payloads.push(payload)
      const content = responses[Math.min(index++, responses.length - 1)] ?? 'The verified evidence is sufficient.'
      return { streamed: false, message: { content, tool_calls: [] } }
    },
    cancel: async () => true,
    onEvent: () => () => {},
  }
}

function unknownEvidence(): AdvisorEvidence {
  return {
    intent: 'unknown',
    question: 'Tell me a joke',
    scope,
    refs: [],
    coverage: { level: 'unavailable', label: 'Unavailable', detail: 'No mapped evidence.' },
    assumptions: [],
    unknown: [],
    nextInvestigations: [],
  }
}

describe('Harness bounded iterative Tool loop V2', () => {
  it('supports a second authorized read round and a final no-tool synthesis', async () => {
    const fixture = createAdvisorConformanceFixture()
    const spend = buildSpendEvidence('What changed and what quota remains?', scope, fixture.overview)
    const quota = buildQuotaEvidence('What changed and what quota remains?', scope, fixture.overview, fixture.quota)
    const payloads: Array<Record<string, unknown>> = []
    const rounds: number[] = []
    const executed: string[] = []
    const tools = [definition('get_spend_snapshot'), definition('get_quota_snapshot')]
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-model',
      transport: localTransport([
        planning('spend', ['get_spend_snapshot']),
        planning('quota', ['get_quota_snapshot']),
        'The verified evidence is sufficient for this answer.',
      ], payloads),
    })
    const answer = await runtime.generate({
      question: 'What changed and what quota remains?',
      evidence: spend,
      tools,
      onToolRound: round => rounds.push(round),
      executeTool: async name => {
        executed.push(name)
        return { content: JSON.stringify({ tool: name }), evidence: name === 'get_quota_snapshot' ? quota : spend }
      },
    })

    expect(rounds).toEqual([1, 2])
    expect(executed).toEqual(['get_spend_snapshot', 'get_quota_snapshot'])
    expect(payloads).toHaveLength(3)
    expect(payloads[0]?.tools).toHaveLength(2)
    expect(payloads[1]?.tools).toHaveLength(2)
    expect(payloads[2]?.tools).toEqual([])
    expect(answer.evidence.map(ref => ref.id)).toEqual(expect.arrayContaining([
      ...spend.refs.map(ref => ref.id),
      ...quota.refs.map(ref => ref.id),
    ]))
    expect(answer.conclusion).toContain('Metrora measured')
    expect(answer.conclusion).toContain('Claude quota freshness is up to date.')
    expect(answer.conclusion).toContain('The verified evidence is sufficient for this answer.')
  })

  it('keeps a bounded second read executable after a single bare native Tool call', async () => {
    const fixture = createAdvisorConformanceFixture()
    const spend = buildSpendEvidence('What changed and what quota remains?', scope, fixture.overview)
    const quota = buildQuotaEvidence('What changed and what quota remains?', scope, fixture.overview, fixture.quota)
    const payloads: Array<Record<string, unknown>> = []
    const executed: string[] = []
    let call = 0
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-model',
      transport: {
        probe: async () => ({ available: true, models: ['fixture-model'], detail: 'fixture' }),
        chat: async (_requestId, payload) => {
          payloads.push(payload)
          call += 1
          if (call === 1) return { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
          if (call === 2) return { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_quota_snapshot', arguments: '{}' } }] } }
          return { streamed: false, message: { content: 'The measured evidence is sufficient.' } }
        },
        cancel: async () => true,
        onDelta: () => () => {},
      },
    })
    const answer = await runtime.generate({
      question: 'What changed and what quota remains?',
      evidence: spend,
      tools: [definition('get_spend_snapshot'), definition('get_quota_snapshot')],
      executeTool: async name => {
        executed.push(name)
        return { content: JSON.stringify({ tool: name }), evidence: name === 'get_quota_snapshot' ? quota : spend }
      },
    })

    expect(executed).toEqual(['get_spend_snapshot', 'get_quota_snapshot'])
    expect(payloads).toHaveLength(3)
    expect(payloads[0]?.tools).toHaveLength(2)
    expect(payloads[1]?.tools).toHaveLength(2)
    expect(payloads[2]?.tools).toEqual([])
    expect(answer.conclusion).toContain('Claude quota freshness is up to date.')
    expect(answer.conclusion).toContain('The measured evidence is sufficient.')
  })

  it('keeps the hosted second read executable after a single bare native Tool call', async () => {
    const fixture = createAdvisorConformanceFixture()
    const spend = buildSpendEvidence('What changed and what quota remains?', scope, fixture.overview)
    const quota = buildQuotaEvidence('What changed and what quota remains?', scope, fixture.overview, fixture.quota)
    const payloads: Array<Record<string, unknown>> = []
    const executed: string[] = []
    let call = 0
    const runtime = new HostedAdvisorRuntime({
      provider: 'opencode-zen',
      model: 'fixture-model',
      capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' },
      consent: true,
      transport: {
        probe: async () => ({ provider: 'opencode-zen', available: true, models: [{ id: 'fixture-model', label: 'fixture-model', state: 'verified', limitation: null }], detail: 'fixture', credentialState: 'ready' }),
        chat: async (_requestId, payload) => {
          payloads.push(payload)
          call += 1
          if (call === 1) return { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
          if (call === 2) return { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_quota_snapshot', arguments: '{}' } }] } }
          return { streamed: false, message: { content: 'The hosted measured evidence is sufficient.' } }
        },
        cancel: async () => true,
        onEvent: () => () => {},
      },
    })
    const answer = await runtime.generate({
      question: 'What changed and what quota remains?',
      evidence: spend,
      tools: [definition('get_spend_snapshot'), definition('get_quota_snapshot')],
      executeTool: async name => {
        executed.push(name)
        return { content: JSON.stringify({ tool: name }), evidence: name === 'get_quota_snapshot' ? quota : spend }
      },
    })

    expect(executed).toEqual(['get_spend_snapshot', 'get_quota_snapshot'])
    expect(payloads).toHaveLength(3)
    expect(payloads[0]?.tools).toHaveLength(2)
    expect(payloads[1]?.tools).toHaveLength(2)
    expect(payloads[2]?.tools).toEqual([])
    expect(answer.conclusion).toContain('Claude quota freshness is up to date.')
    expect(answer.conclusion).toContain('The hosted measured evidence is sufficient.')
  })

  it('appends a grounded contributor interpretation when canonical spend atoms support it', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('Which Project drove the most spend?', scope, fixture.overview)
    const interpretation = 'Project A is an observed contributor in the spend breakdown.'
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-model',
      transport: localTransport([planning('spend', ['get_spend_snapshot']), interpretation], []),
    })
    const answer = await runtime.generate({
      question: 'Which Project drove the most spend?',
      evidence,
      tools: [definition('get_spend_snapshot')],
      executeTool: async () => ({ content: '{"tool":"get_spend_snapshot"}', evidence }),
    })

    expect(answer.conclusion).toContain(interpretation)
    expect(answer.conclusion).toContain('Metrora measured')
  })

  it('stops at the explicit read-round cap and does not ask for a third round', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed?', scope, fixture.overview)
    const payloads: Array<Record<string, unknown>> = []
    const rounds: number[] = []
    const executed: string[] = []
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-model',
      transport: localTransport([
        planning('spend', ['get_spend_snapshot']),
        planning('spend', ['get_spend_snapshot']),
        'The bounded evidence is sufficient.',
      ], payloads),
    })
    await runtime.generate({
      question: 'What changed?',
      evidence,
      tools: [definition('get_spend_snapshot')],
      onToolRound: round => rounds.push(round),
      executeTool: async name => {
        executed.push(name)
        return { content: JSON.stringify({ tool: name }), evidence }
      },
    })

    expect(rounds).toEqual([1, 2])
    expect(executed).toHaveLength(2)
    expect(payloads).toHaveLength(3)
    expect(payloads[2]?.tools).toEqual([])
    expect(rounds).not.toContain(HARNESS_TOOL_LOOP_LIMITS.maxRounds + 1)
  })

  it('stops at the explicit total-call cap while preserving a final synthesis pass', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed?', scope, fixture.overview)
    const payloads: Array<Record<string, unknown>> = []
    const executed: string[] = []
    const tools: AdvisorToolDefinition[] = [
      definition('get_spend_snapshot'),
      definition('get_quota_snapshot'),
      definition('get_overview_snapshot'),
      definition('get_coverage_report'),
    ]
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-model',
      transport: localTransport([
        planning('spend', ['get_spend_snapshot', 'get_quota_snapshot', 'get_overview_snapshot', 'get_coverage_report']),
        'The bounded evidence is sufficient.',
      ], payloads),
    })
    await runtime.generate({
      question: 'What changed?',
      evidence,
      tools,
      executeTool: async name => {
        executed.push(name)
        return { content: JSON.stringify({ tool: name }), evidence }
      },
    })

    expect(executed).toHaveLength(HARNESS_TOOL_LOOP_LIMITS.maxCallsPerTurn)
    expect(payloads).toHaveLength(2)
    expect(payloads[1]?.tools).toEqual([])
  })

  it('fails closed on malformed native tool requests without reaching a read executor', async () => {
    const executeTool = vi.fn()
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-model',
      transport: {
        probe: async () => ({ available: true, models: ['fixture-model'], detail: 'fixture' }),
        chat: async () => ({ streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{' } }] } }),
        cancel: async () => true,
        onDelta: () => () => {},
      },
    })
    const answer = await runtime.generate({
      question: 'Tell me a joke',
      evidence: unknownEvidence(),
      tools: [definition('get_spend_snapshot')],
      executeTool,
    })

    expect(executeTool).not.toHaveBeenCalled()
    expect(answer.conclusion).not.toContain('Local model context')
  })

  it('keeps the hosted iterative loop bounded and ends synthesis without provider-native tool replay', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed and what quota remains?', scope, fixture.overview)
    const quota = buildQuotaEvidence('What changed and what quota remains?', scope, fixture.overview, fixture.quota)
    const payloads: Array<Record<string, unknown>> = []
    const executed: string[] = []
    const runtime = new HostedAdvisorRuntime({
      provider: 'openai',
      model: 'fixture-model',
      capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' },
      consent: true,
      transport: hostedTransport([
        planning('spend', ['get_spend_snapshot']),
        planning('quota', ['get_quota_snapshot']),
        'The verified hosted evidence is sufficient.',
      ], payloads),
    })
    const answer = await runtime.generate({
      question: 'What changed and what quota remains?',
      evidence,
      tools: [definition('get_spend_snapshot'), definition('get_quota_snapshot')],
      executeTool: async name => {
        executed.push(name)
        return { content: JSON.stringify({ tool: name }), evidence: name === 'get_quota_snapshot' ? quota : evidence }
      },
    })

    expect(executed).toEqual(['get_spend_snapshot', 'get_quota_snapshot'])
    expect(payloads).toHaveLength(3)
    expect(payloads[2]?.tools).toEqual([])
    expect((payloads[2]?.messages as Array<Record<string, unknown>>).some(message => message.role === 'tool')).toBe(false)
    expect(answer.conclusion).toContain('Metrora measured')
  })
})
