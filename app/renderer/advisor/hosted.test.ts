// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { createAdvisorConformanceFixture } from './conformance'
import { createAdvisorKernel } from './kernel'
import { HostedAdvisorRuntime, type HostedAdvisorTransport } from './hosted'
import type { AdvisorSwarmSynthesisInput } from './types'

describe('Hosted Advisor renderer runtime', () => {
  it('uses a dedicated bounded transport request for Swarm synthesis', async () => {
    const fixture = createAdvisorConformanceFixture()
    const requests: Array<Record<string, unknown>> = []
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'verified', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        return { streamed: false, message: { content: 'Verified spend is $12.00 from measured spend and call totals.' } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const runtime = new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', consent: true, transport })
    const input: AdvisorSwarmSynthesisInput = {
      question: 'È vero che ho speso più di 4k in totale di AI?',
      scope: fixture.scope,
      workers: [{
        role: 'investigator',
        status: 'completed',
        answer: 'Metrora measured $12.00 in the selected period.',
        evidenceSummary: 'Usable canonical spend evidence.',
        evidenceStatus: 'usable',
        evidenceRefs: [{ id: 'overview.current', label: 'Measured spend and call totals' }],
        requiredToolNames: ['get_spend_snapshot'],
        toolNamesUsed: ['get_spend_snapshot'],
      }],
    }

    const result = await runtime.generateSwarmSynthesis(input)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.tools).toEqual([])
    expect(requests[0]?.harnessConformance).toBe(true)
    const messages = requests[0]?.messages as Array<{ role: string; content: string }>
    expect(messages.at(-1)?.content).toBe(input.question)
    expect(messages.some(message => message.content.includes('Synthesize this bounded worker evidence'))).toBe(false)
    expect(result.answer).toContain('Verified spend is $12.00')
  })

  it.each([
    ['ciao come stai', 'Ciao! Sto bene, grazie.', 1, 'social'],
    ['Bonjour, comment ça va ?', 'Bonjour ! Je vais bien, merci.', 1, 'investigate'],
  ] as const)('keeps %s conversational without evidence or tools', async (question, responseText, expectedCalls, expectedTurnKind) => {
    const fixture = createAdvisorConformanceFixture()
    const requests: Array<Record<string, unknown>> = []
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openrouter', available: true, models: [{ id: 'openrouter/auto', label: 'openrouter/auto', state: 'unverified', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        return { streamed: false, message: { content: responseText } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const runtime = new HostedAdvisorRuntime({
      provider: 'openrouter',
      model: 'openrouter/auto',
      capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'unknown' },
      consent: true,
      transport,
    })

    const answer = await createAdvisorKernel(fixture.source, runtime).investigate({ question, scope: fixture.scope })

    expect(requests).toHaveLength(expectedCalls)
    expect(requests.map(request => request.tools)).toEqual(Array.from({ length: expectedCalls }, () => []))
    expect(fixture.reads.overviews).toHaveLength(0)
    expect(answer.plan?.turnKind).toBe(expectedTurnKind)
    expect(answer.evidence).toEqual([])
    expect(answer.conclusion).toBe(responseText)
    expect(answer.generatedByModel).toBe(true)
  })

  it('runs a bounded Tool round trip and performs one grounded repair when natural prose is rejected', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const requests: Array<Record<string, unknown>> = []
    const deltas: string[] = []
    let conformanceCalls = 0
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        if (requests.length === 1) return { streamed: false, message: { content: 'Claude was not the main driver.', tool_calls: [{ id: 'call-spend', function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
        if (requests.length === 2) return { streamed: false, message: { content: 'Codex appears to be the main driver.' } }
        return { streamed: false, message: { content: 'Metrora measured $12.00 in the selected period; I would inspect the project concentration next.' } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' }, consent: true, transport }).generate({
      question: 'What changed in spend?',
      evidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      executeTool: async () => ({ content: '{"measured":true}', evidence }),
      onConformance: () => { conformanceCalls += 1 },
      onDelta: text => deltas.push(text),
    })

    const payload = requests[0]!
    const messages = (payload.messages as Array<{ role: string; content: string }>).slice(0, 2)
    expect(payload.tools).toHaveLength(1)
    expect(payload.model).toBe('gpt-test')
    expect(payload.stream).toBe(false)
    expect(payload.consent).toBe(true)
    expect(payload.harnessConformance).toBe(true)
    expect(messages.map(message => message.role)).toEqual(['system', 'user'])
    expect(messages.some(message => message.content.includes('measuredCostUSD'))).toBe(false)
    const finalPayload = requests[1]!
    expect(finalPayload.tools).toHaveLength(1)
    expect(finalPayload.model).toBe('gpt-test')
    expect(finalPayload.stream).toBe(false)
    expect(finalPayload.harnessConformance).toBe(true)
    expect(conformanceCalls).toBe(1)
    const finalMessages = finalPayload.messages as Array<Record<string, unknown>>
    expect(finalMessages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(finalMessages[2]).toMatchObject({ toolCalls: [{ id: 'call-spend', name: 'get_spend_snapshot', arguments: '{}' }] })
    expect(finalMessages[3]).toMatchObject({ role: 'tool', toolCallId: 'call-spend', toolName: 'get_spend_snapshot' })
    expect(String(finalMessages[3]?.content)).toContain('measured')
    expect(finalPayload.messageMode).toBe('native')
    expect(deltas).toEqual([])
    expect(requests).toHaveLength(3)
    const repairPayload = requests[2]!
    expect(repairPayload.tools).toEqual([])
    expect(repairPayload.stream).toBe(false)
    expect(repairPayload.harnessConformance).toBe(true)
    expect((repairPayload.messages as Array<{ role: string; content: string }>).map(message => message.role)).toEqual(['system', 'user'])
    expect((repairPayload.messages as Array<{ role: string; content: string }>)[1]?.content).toContain('What changed in spend?')
    expect((repairPayload.messages as Array<{ role: string; content: string }>)[0]?.content).toContain('12')
    await expect(new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', transport }).generate({ question: 'What changed in spend?', evidence })).rejects.toThrow('consent')
    expect(answer.runtime).toMatchObject({ id: 'hosted-openai', mode: 'hosted-byok' })
    expect(answer.generatedByModel).toBe(true)
    expect(answer.streamed).toBe(false)
    expect(answer.conclusion).toContain('project concentration')
    expect(answer.conclusion).not.toContain('Claude was not the main driver.')
    expect(answer.conclusion).not.toContain('Codex appears to be the main driver.')
  })
  it.each(['openai', 'anthropic', 'gemini'] as const)('does not append contradictory qualitative prose for hosted %s', async provider => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const narrative = 'Codex appears to be the main driver.'
    const requests: Array<Record<string, unknown>> = []
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider, available: true, models: [{ id: provider + '-model', label: provider + '-model', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => { requests.push(payload); return { streamed: false, message: { content: narrative } } },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await new HostedAdvisorRuntime({ provider, model: provider + '-model', consent: true, transport }).generate({
      question: 'What changed in spend?', evidence,
    })
    expect(requests).toHaveLength(3)
    expect(requests[2]?.tools).toEqual([])
    expect(answer.conclusion).toContain('could not be safely finalized')
    expect(answer.conclusion).not.toContain(narrative)
    expect(answer.conclusion).not.toContain('Metrora measured')
    expect(answer.generatedByModel).toBe(false)
    expect(answer.streamed).toBe(false)
  })

  it('lets the model interpret a successful mandatory read in the same turn', async () => {
    const fixture = createAdvisorConformanceFixture()
    const requests: Array<Record<string, unknown>> = []
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        return { streamed: false, message: { content: 'Sì: Metrora measured $12.00 in the selected period, so this is a meaningful amount for the recorded activity.' } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await createAdvisorKernel(fixture.source, new HostedAdvisorRuntime({
      provider: 'openai',
      model: 'gpt-test',
      capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'unknown' },
      consent: true,
      transport,
    })).investigate({ question: 'What changed in spend?', scope: fixture.scope })

    expect(requests).toHaveLength(1)
    expect((requests[0]?.messages as Array<{ content: string }>).some(message => message.content.includes('12'))).toBe(true)
    expect(fixture.reads.overviews).toHaveLength(1)
    expect(answer.generatedByModel).toBe(true)
    expect(answer.conclusion).toContain('meaningful amount')
    expect(answer.conclusion).toContain('12.00')
  })

  it('allows one bounded follow-up read after the mandatory read and synthesizes both', async () => {
    const fixture = createAdvisorConformanceFixture()
    const requests: Array<Record<string, unknown>> = []
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        return requests.length === 1
          ? { streamed: false, message: { content: '', tool_calls: [{ id: 'project-drivers', function: { name: 'get_project_drivers', arguments: '{}' } }] } }
          : { streamed: false, message: { content: 'Metrora measured $12.00 overall, and Project A is the visible project context for that spend.' } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await createAdvisorKernel(fixture.source, new HostedAdvisorRuntime({
      provider: 'openai',
      model: 'gpt-test',
      capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' },
      consent: true,
      transport,
    })).investigate({ question: 'What changed in spend and which projects contributed?', scope: fixture.scope })

    expect(requests).toHaveLength(2)
    expect(fixture.reads.overviews).toHaveLength(2)
    expect((requests[0]?.messages as Array<{ content: string }>).some(message => message.content.includes('12'))).toBe(true)
    expect((requests[1]?.messages as Array<{ content: string }>).some(message => message.content.includes('Project A'))).toBe(true)
    expect(answer.generatedByModel).toBe(true)
    expect(answer.conclusion).toContain('Project A')
  })

  it('signals hosted conformance after the first valid response even when continuation later fails', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    let calls = 0
    let conformanceCalls = 0
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async () => {
        calls += 1
        if (calls === 1) return { streamed: false, message: { content: 'Read the spend.', tool_calls: [{ id: 'call-spend', function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
        throw new Error('provider unavailable')
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' }, consent: true, transport }).generate({
      question: 'What changed in spend?',
      evidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      executeTool: async () => ({ content: '{"measured":true}', evidence }),
      onConformance: () => { conformanceCalls += 1 },
    })
    expect(conformanceCalls).toBe(1)
    expect(answer.conclusion).toContain('could not finish')
    expect(answer.conclusion).not.toContain('offline evidence')
    expect(answer.materialLimits?.join(' ')).toContain('selected model')
  })

  it('does not signal conformance for a malformed first response', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    let conformanceCalls = 0
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async () => ({ streamed: false, message: { content: '' } }),
      cancel: async () => true,
      onEvent: () => () => {},
    }

    const answer = await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', consent: true, transport }).generate({
      question: 'What changed in spend?',
      evidence,
      onConformance: () => { conformanceCalls += 1 },
    })

    expect(conformanceCalls).toBe(0)
    expect(answer.conclusion).toContain('could not finish')
    expect(answer.conclusion).not.toContain('offline evidence')
  })

  it('reports a provider failure before the first model step without deterministic prose', async () => {
    const fixture = createAdvisorConformanceFixture()
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async () => { throw new Error('provider unavailable') },
      cancel: async () => true,
      onEvent: () => () => {},
    }

    const answer = await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', consent: true, transport }).generate({
      question: 'Tell me a joke',
      evidence: buildSpendEvidence('Tell me a joke', fixture.scope, fixture.overview),
    })

    expect(answer.runtimeFailure).toBe(true)
    expect(answer.conclusion).toContain('selected model could not finish')
    expect(answer.conclusion).not.toContain('offline evidence')
    expect(answer.generatedByModel).toBe(false)
  })

  it('does not signal conformance when the first request is cancelled', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const controller = new AbortController()
    let conformanceCalls = 0
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async () => new Promise(() => {}),
      cancel: async () => true,
      onEvent: () => () => {},
    }

    const pending = new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', consent: true, transport }).generate({
      question: 'What changed in spend?',
      evidence,
      onConformance: () => { conformanceCalls += 1 },
    }, controller.signal)
    await Promise.resolve()
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(conformanceCalls).toBe(0)
  })

  it('keeps same-scope conversation history for hosted follow-ups and drops other scopes', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const requests: Array<Record<string, unknown>> = []
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        return { streamed: false, message: { content: 'not structured synthesis' } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', consent: true, transport }).generate({
      question: 'E il mese scorso?',
      evidence,
      conversation: [
        { role: 'user', content: 'Quanto ho speso questa settimana?', scopeFingerprint: JSON.stringify({ period: 'week', range: null, projectId: 'all', provider: 'all', model: null }) },
        { role: 'assistant', content: 'Hai speso 12 USD.', scopeFingerprint: JSON.stringify({ period: 'week', range: null, projectId: 'all', provider: 'all', model: null }) },
        { role: 'user', content: 'other scope secret should not cross', scopeFingerprint: 'other-scope' },
      ],
    })
    const messages = requests[0]!.messages as Array<{ role: string; content: string }>
    expect(messages.map(message => message.content)).toEqual(expect.arrayContaining(['Quanto ho speso questa settimana?', 'Hai speso 12 USD.']))
    expect(messages.map(message => message.content)).not.toContain('other scope secret should not cross')
  })

  it('does not send or accept provider-native tool calls when model capability is unknown', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const requests: Array<Record<string, unknown>> = []
    const planning = JSON.stringify({
      contractVersion: 'advisor-planning-draft-v1',
      schemaVersion: 1,
      turnKind: 'investigate',
      questionFamily: 'spend',
      requestedEvidenceDomains: ['usage-totals', 'cost'],
      toolRequests: [{ tool: 'get_spend_snapshot', arguments: {} }],
      presentationIntent: 'text',
      expertDetailRequested: false,
      clarification: null,
    })
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openrouter', available: true, models: [{ id: 'text-only', label: 'Text only', state: 'limited', limitation: null, capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'unsupported' } }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        return requests.length === 1
          ? { streamed: false, message: { content: planning, tool_calls: [{ id: 'native-should-ignore', function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
          : { streamed: false, message: { content: '{}' } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await new HostedAdvisorRuntime({ provider: 'openrouter', model: 'text-only', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'unknown' }, consent: true, transport }).generate({
      question: 'What changed in spend?',
      evidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      executeTool: async () => ({ content: '{"bounded":true}', evidence }),
    })
    expect(requests[0]?.tools).toEqual([])
    expect(requests[0]?.message).toBeUndefined()
    expect(answer.runtime).toMatchObject({ id: 'hosted-openrouter', mode: 'hosted-byok' })
  })
})
