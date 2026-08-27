// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { createAdvisorConformanceFixture } from './conformance'
import { HostedAdvisorRuntime, type HostedAdvisorTransport } from './hosted'
import { LMStudioAdvisorRuntime } from './lmstudio'
import { OllamaAdvisorRuntime, type OllamaTransport } from './ollama'
import { buildQuotaEvidence, buildSpendEvidence } from './evidence'
import type { AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

const planningContent = JSON.stringify({
  contractVersion: 'advisor-planning-draft-v1',
  schemaVersion: 1,
  turnKind: 'investigate',
  questionFamily: 'spend',
  requestedEvidenceDomains: ['usage-totals', 'cost', 'freshness'],
  toolRequests: [{ tool: 'get_spend_snapshot', arguments: {} }],
  presentationIntent: 'text',
  expertDetailRequested: false,
  clarification: null,
})

const synthesisContent = JSON.stringify({
  contractVersion: 'advisor-synthesis-draft-v1',
  schemaVersion: 1,
  conclusion: { claimIds: ['measured-total-cost'] },
  why: [{ claimIds: ['observed-calls'] }],
  details: [{ claimIds: ['observed-sessions'] }],
  claims: [{ id: 'measured-total-cost' }, { id: 'observed-calls' }, { id: 'observed-sessions' }],
  presentationRequests: [],
})

function localTransport(payloads: Array<Record<string, unknown>>, events: string[]): OllamaTransport {
  let calls = 0
  return {
    probe: async () => ({ available: true, models: ['fixture-model'], detail: 'fixture' }),
    chat: async (_requestId, payload) => {
      payloads.push(payload)
      calls += 1
      events.push('chat-' + calls)
      return calls === 1
        ? { streamed: false, message: { content: planningContent, tool_calls: [] } }
        : { streamed: false, message: { content: synthesisContent, tool_calls: [] } }
    },
    cancel: async () => true,
    onDelta: () => () => {},
  }
}

function hostedTransport(provider: 'openai' | 'anthropic' | 'gemini', payloads: Array<Record<string, unknown>>, events: string[]): HostedAdvisorTransport {
  let calls = 0
  return {
    probe: async () => ({ provider, available: true, models: [{ id: provider + '-test', label: provider + '-test', state: 'discovered', limitation: null }], detail: 'fixture', credentialState: 'ready' }),
    chat: async (_requestId, payload) => {
      payloads.push(payload)
      calls += 1
      events.push('chat-' + calls)
      return { streamed: false, message: { content: calls === 1 ? planningContent : synthesisContent, tool_calls: [] } }
    },
    cancel: async () => true,
    onEvent: () => () => {},
  }
}

function expectFreshPayloads(payloads: Array<Record<string, unknown>>): void {
  expect(payloads).toHaveLength(2)
  expect(payloads[0]?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function' })]))
  expect(payloads[1]?.tools).toEqual([])
  const planningMessages = payloads[0]?.messages as Array<Record<string, unknown>>
  const synthesisMessages = payloads[1]?.messages as Array<Record<string, unknown>>
  expect(planningMessages.some(message => String(message.content).includes('measuredCostUSD'))).toBe(false)
  expect(synthesisMessages.some(message => String(message.content).includes('measuredCostUSD'))).toBe(true)
  for (const message of [...planningMessages, ...synthesisMessages]) {
    expect(message.role).not.toBe('tool')
    expect(message).not.toHaveProperty('tool_calls')
    expect(message).not.toHaveProperty('tool_call_id')
    expect(message).not.toHaveProperty('tool_name')
  }
}

describe('Advisor independent planning and synthesis phases', () => {
  const fixture = createAdvisorConformanceFixture()
  const evidence = buildSpendEvidence('What changed in spend?', scope, fixture.overview)
  const tool = { type: 'function' as const, function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }

  it('executes the model-selected family when it differs from the deterministic fallback', async () => {
    const payloads: Array<Record<string, unknown>> = []
    let calls = 0
    const quotaPlanning = JSON.stringify({ ...JSON.parse(planningContent) as Record<string, unknown>, questionFamily: 'quota', requestedEvidenceDomains: ['provider-capacity', 'freshness'], toolRequests: [{ tool: 'get_quota_snapshot', arguments: {} }], presentationIntent: 'quota-card' })
    const quotaSynthesis = JSON.stringify({ contractVersion: 'advisor-synthesis-draft-v1', schemaVersion: 1, conclusion: { claimIds: ['quota-remaining-claude-0'] }, why: [], details: [], claims: [{ id: 'quota-remaining-claude-0' }], presentationRequests: [{ kind: 'quota-card' }] })
    const fixture = createAdvisorConformanceFixture()
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-override',
      transport: {
        probe: async () => ({ available: true, models: ['fixture-override'], detail: 'fixture' }),
        chat: async (_requestId, payload) => {
          payloads.push(payload)
          calls += 1
          return { streamed: false, message: { content: calls === 1 ? quotaPlanning : quotaSynthesis, tool_calls: [] } }
        },
        cancel: async () => true,
        onDelta: () => () => {},
      },
    })
    const answer = await runtime.generate({
      question: 'What changed in spend?',
      evidence,
      tools: [tool, { type: 'function', function: { name: 'get_quota_snapshot', description: 'quota', parameters: { type: 'object' } } }],
      executeTool: async name => ({ content: JSON.stringify({ tool: name }), evidence: buildQuotaEvidence('What changed in spend?', scope, fixture.overview, fixture.quota) }),
    })
    expect(payloads).toHaveLength(2)
    expect(answer.plan?.questionFamily).toBe('quota')
    expect(answer.conclusion).toContain('quota remaining')
  })

  it.each([
    ['Ollama', (transport: OllamaTransport) => new OllamaAdvisorRuntime({ model: 'fixture-ollama', transport })],
    ['LM Studio', (transport: OllamaTransport) => new LMStudioAdvisorRuntime({ model: 'fixture-lmstudio', transport })],
  ] as const)('%s performs planning, canonical execution, and one fresh synthesis call', async (_label, createRuntime) => {
    const payloads: Array<Record<string, unknown>> = []
    const events: string[] = []
    const runtime = createRuntime(localTransport(payloads, events))
    const answer = await runtime.generate({
      question: 'What changed in spend?',
      evidence,
      tools: [tool],
      executeTool: async () => {
        events.push('execute')
        return { content: '{"bounded":true}', evidence }
      },
    })

    expect(events).toEqual(['chat-1', 'execute', 'chat-2'])
    expectFreshPayloads(payloads)
    expect(answer.generatedByModel).toBe(true)
    expect(answer.conclusion).toBe('Metrora measured $12.00 in the selected period.')
  })

  it.each([
    ['Ollama', (transport: OllamaTransport) => new OllamaAdvisorRuntime({ model: 'fixture-ollama', transport })],
    ['LM Studio', (transport: OllamaTransport) => new LMStudioAdvisorRuntime({ model: 'fixture-lmstudio', transport })],
  ] as const)('%s cancels between evidence execution and synthesis', async (_label, createRuntime) => {
    const payloads: Array<Record<string, unknown>> = []
    const events: string[] = []
    const controller = new AbortController()
    const runtime = createRuntime(localTransport(payloads, events))
    await expect(runtime.generate({
      question: 'What changed in spend?',
      evidence,
      tools: [tool],
      executeTool: async () => {
        events.push('execute')
        controller.abort()
        return { content: '{"bounded":true}', evidence }
      },
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(events).toEqual(['chat-1', 'execute'])
    expect(payloads).toHaveLength(1)
  })

  it.each(['openai', 'anthropic', 'gemini'] as const)('%s performs the same two independent calls without tool-result replay', async provider => {
    const payloads: Array<Record<string, unknown>> = []
    const events: string[] = []
    const runtime = new HostedAdvisorRuntime({ provider, model: provider + '-test', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' }, consent: true, transport: hostedTransport(provider, payloads, events) })
    const answer = await runtime.generate({
      question: 'What changed in spend?',
      evidence,
      tools: [tool],
      executeTool: async () => {
        events.push('execute')
        return { content: '{"bounded":true}', evidence }
      },
    })

    expect(events).toEqual(['chat-1', 'execute', 'chat-2'])
    expectFreshPayloads(payloads)
    expect(answer.generatedByModel).toBe(true)
    expect(answer.conclusion).toBe('Metrora measured $12.00 in the selected period.')
  })

  it.each(['openai', 'anthropic', 'gemini'] as const)('%s cancels before a third call when evidence execution aborts', async provider => {
    const payloads: Array<Record<string, unknown>> = []
    const events: string[] = []
    const controller = new AbortController()
    const runtime = new HostedAdvisorRuntime({ provider, model: provider + '-test', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' }, consent: true, transport: hostedTransport(provider, payloads, events) })
    await expect(runtime.generate({
      question: 'What changed in spend?',
      evidence,
      tools: [tool],
      executeTool: async () => {
        events.push('execute')
        controller.abort()
        return { content: '{"bounded":true}', evidence }
      },
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(events).toEqual(['chat-1', 'execute'])
    expect(payloads).toHaveLength(1)
  })
})
