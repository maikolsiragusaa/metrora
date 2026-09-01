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

const continuationContent = 'The verified Metrora evidence is sufficient to answer the question.'

function localTransport(payloads: Array<Record<string, unknown>>, events: string[], finalContent = continuationContent): OllamaTransport {
  let calls = 0
  return {
    probe: async () => ({ available: true, models: ['fixture-model'], detail: 'fixture' }),
    chat: async (_requestId, payload) => {
      payloads.push(payload)
      calls += 1
      events.push('chat-' + calls)
      return calls === 1
        ? { streamed: false, message: { content: planningContent, tool_calls: [] } }
        : { streamed: false, message: { content: finalContent, tool_calls: [] } }
    },
    cancel: async () => true,
    onDelta: () => () => {},
  }
}

function synthesisContent(claimIds: string[], interpretation: string, whyClaimIds: string[] = []): string {
  return JSON.stringify({
    contractVersion: 'advisor-synthesis-draft-v1',
    schemaVersion: 1,
    conclusion: { claimIds: [claimIds[0]] },
    why: whyClaimIds.length ? [{ claimIds: whyClaimIds }] : [],
    details: [],
    claims: claimIds.map(id => ({ id })),
    narrative: { interpretation },
    presentationRequests: [],
  })
}

function payloadsForTest(): Array<Record<string, unknown>> {
  return []
}

function hostedTransport(provider: 'openai' | 'anthropic' | 'gemini', payloads: Array<Record<string, unknown>>, events: string[]): HostedAdvisorTransport {
  let calls = 0
  return {
    probe: async () => ({ provider, available: true, models: [{ id: provider + '-test', label: provider + '-test', state: 'discovered', limitation: null }], detail: 'fixture', credentialState: 'ready' }),
    chat: async (_requestId, payload) => {
      payloads.push(payload)
      calls += 1
      events.push('chat-' + calls)
      return { streamed: false, message: { content: calls === 1 ? planningContent : continuationContent, tool_calls: [] } }
    },
    cancel: async () => true,
    onEvent: () => () => {},
  }
}

function expectFreshPayloads(payloads: Array<Record<string, unknown>>): void {
  expect(payloads).toHaveLength(2)
  expect(payloads[0]?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function' })]))
  const planningMessages = payloads[0]?.messages as Array<Record<string, unknown>>
  const continuationMessages = payloads[1]?.messages as Array<Record<string, unknown>>
  expect(planningMessages.some(message => String(message.content).includes('measuredCostUSD'))).toBe(false)
  expect(payloads[1]?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function' })]))
  expect(continuationMessages.some(message => String(message.content).includes('measuredCostUSD'))).toBe(true)
  for (const message of [...planningMessages, ...continuationMessages]) {
    expect(message.role).not.toBe('tool')
    expect(message).not.toHaveProperty('tool_calls')
    expect(message).not.toHaveProperty('tool_call_id')
    expect(message).not.toHaveProperty('tool_name')
  }
}

describe('Advisor bounded planning and continuation phases', () => {
  const fixture = createAdvisorConformanceFixture()
  const evidence = buildSpendEvidence('What changed in spend?', scope, fixture.overview)
  const tool = { type: 'function' as const, function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }

  it('executes the model-selected family when it differs from the deterministic fallback', async () => {
    const payloads: Array<Record<string, unknown>> = []
    let calls = 0
    const quotaPlanning = JSON.stringify({ ...JSON.parse(planningContent) as Record<string, unknown>, questionFamily: 'quota', requestedEvidenceDomains: ['provider-capacity', 'freshness'], toolRequests: [{ tool: 'get_quota_snapshot', arguments: {} }], presentationIntent: 'quota-card' })
    const quotaContinuation = 'The verified quota evidence is sufficient for this answer.'
    const fixture = createAdvisorConformanceFixture()
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-override',
      transport: {
        probe: async () => ({ available: true, models: ['fixture-override'], detail: 'fixture' }),
        chat: async (_requestId, payload) => {
          payloads.push(payload)
          calls += 1
          return { streamed: false, message: { content: calls === 1 ? quotaPlanning : quotaContinuation, tool_calls: [] } }
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
    expect(answer.conclusion).toContain('Claude quota')
  })

  it.each([
    ['Ollama', (transport: OllamaTransport) => new OllamaAdvisorRuntime({ model: 'fixture-ollama', transport })],
    ['LM Studio', (transport: OllamaTransport) => new LMStudioAdvisorRuntime({ model: 'fixture-lmstudio', transport })],
  ] as const)('%s performs planning, canonical execution, and bounded continuation', async (_label, createRuntime) => {
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
    expect(answer.conclusion).toContain('Metrora measured $12.00 in the selected period.')
    expect(answer.conclusion).toContain('The verified Metrora evidence is sufficient to answer the question.')
  })

  it('keeps a verified model-spend fact and a bounded comparison interpretation in the product synthesis path', async () => {
    const question = 'How much did I spend with provider/model gpt-safe this year? Is that a lot?'
    const payloads: Array<Record<string, unknown>> = []
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-ollama',
      transport: localTransport(payloads, [], synthesisContent(['model-measured-cost-0', 'spend-trend-direction'], 'The available period comparison provides bounded qualitative context.', ['spend-trend-direction'])),
    })
    const answer = await runtime.generate({
      question,
      evidence,
      tools: [tool],
      executeTool: async () => ({ content: '{"bounded":true}', evidence }),
    })

    expect(answer.synthesis?.narrative?.interpretation).toContain('bounded qualitative context')
    expect(answer.claims?.map(claim => claim.id)).toEqual(['model-measured-cost-0', 'spend-trend-direction'])
    expect(answer.conclusion).toContain('Observed spend for gpt-safe was $8.00.')
    expect(answer.conclusion).toContain('The available period comparison provides bounded qualitative context.')
  })

  it('keeps the verified fact and explicitly reports when high-or-low comparison is unavailable', async () => {
    const question = 'How much did I spend with provider/model gpt-safe this year? Is that a lot?'
    const noComparisonEvidence = buildSpendEvidence('missing comparison', scope, {
      ...fixture.overview,
      history: { daily: [fixture.overview.history.daily[0]!] },
    })
    const runtime = new OllamaAdvisorRuntime({
      model: 'fixture-ollama',
      transport: localTransport(payloadsForTest(), [], synthesisContent(['model-measured-cost-0'], 'Metrora cannot establish whether this is high or low from the available evidence.')),
    })
    const answer = await runtime.generate({
      question,
      evidence: noComparisonEvidence,
      tools: [tool],
      executeTool: async () => ({ content: '{"bounded":true}', evidence: noComparisonEvidence }),
    })

    expect(answer.conclusion).toContain('Observed spend for gpt-safe was $8.00.')
    expect(answer.conclusion).toContain('Metrora cannot establish whether this is high or low from the available evidence.')
  })

  it('allows evidence-backed contributor wording while blocking unsupported causal prose', async () => {
    const contribution = synthesisContent(['model-measured-cost-0', 'project-measured-cost-0'], 'The main drivers are observed contributors in the canonical spend breakdown.')
    const runtime = new OllamaAdvisorRuntime({ model: 'fixture-ollama', transport: localTransport(payloadsForTest(), [], contribution) })
    const answer = await runtime.generate({
      question: 'What are the main drivers of spend?',
      evidence,
      tools: [tool],
      executeTool: async () => ({ content: '{"bounded":true}', evidence }),
    })
    expect(answer.conclusion).toContain('The main drivers are observed contributors in the canonical spend breakdown.')

    const causal = new OllamaAdvisorRuntime({
      model: 'fixture-ollama',
      transport: localTransport(payloadsForTest(), [], synthesisContent(['model-measured-cost-0'], 'The selected model caused the increase.')),
    })
    const causalAnswer = await causal.generate({
      question: 'What are the main drivers of spend?',
      evidence,
      tools: [tool],
      executeTool: async () => ({ content: '{"bounded":true}', evidence }),
    })
    expect(causalAnswer.conclusion).not.toContain('caused the increase')
    expect(causalAnswer.conclusion).toContain('Metrora measured $12.00 in the selected period.')
  })

  it('drops a mismatched structured contributor narrative while retaining its verified fact', async () => {
    const mismatched = synthesisContent(['project-measured-cost-0'], 'Project Z is an observed contributor in the canonical spend breakdown.')
    const runtime = new OllamaAdvisorRuntime({ model: 'fixture-ollama', transport: localTransport(payloadsForTest(), [], mismatched) })
    const answer = await runtime.generate({
      question: 'What are the spend contributors?',
      evidence,
      tools: [tool],
      executeTool: async () => ({ content: '{"bounded":true}', evidence }),
    })
    expect(answer.claims?.map(claim => claim.id)).toEqual(['project-measured-cost-0'])
    expect(answer.synthesis?.narrative).toBeUndefined()
    expect(answer.conclusion).toContain('Measured spend for Project Project A was $12.00.')
    expect(answer.conclusion).not.toContain('Project Z')
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

  it.each(['openai', 'anthropic', 'gemini'] as const)('%s performs the same bounded continuation without tool-result replay', async provider => {
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
    expect(answer.conclusion).toContain('Metrora measured $12.00 in the selected period.')
    expect(answer.conclusion).toContain('The verified Metrora evidence is sufficient to answer the question.')
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
