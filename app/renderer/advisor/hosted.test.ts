// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { createAdvisorConformanceFixture } from './conformance'
import { HostedAdvisorRuntime, type HostedAdvisorTransport } from './hosted'

describe('Hosted Advisor renderer runtime', () => {
  it('runs a bounded tool round trip and keeps the deterministic answer authoritative', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const requests: Array<Record<string, unknown>> = []
    const deltas: string[] = []
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (_requestId, payload) => {
        requests.push(payload)
        if (requests.length === 1) return { streamed: false, message: { content: 'Claude was not the main driver.', tool_calls: [{ id: 'call-spend', function: { name: 'get_spend_snapshot', arguments: '{}' } }] } }
        return { streamed: false, message: { content: 'Codex appears to be the main driver.' } }
      },
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'supported' }, consent: true, transport }).generate({
      question: 'What changed in spend?',
      evidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      executeTool: async () => ({ content: '{"measured":true}', evidence }),
      onDelta: text => deltas.push(text),
    })

    const payload = requests[0]!
    const messages = (payload.messages as Array<{ role: string; content: string }>).slice(0, 2)
    expect(payload.tools).toHaveLength(1)
    expect(payload.model).toBe('gpt-test')
    expect(payload.stream).toBe(false)
    expect(payload.consent).toBe(true)
    expect(messages.map(message => message.role)).toEqual(['system', 'user'])
    expect(messages.some(message => message.content.includes('measuredCostUSD'))).toBe(false)
    const finalPayload = requests[1]!
    expect(finalPayload.tools).toEqual([])
    expect(finalPayload.model).toBe('gpt-test')
    expect(finalPayload.stream).toBe(false)
    const finalMessages = finalPayload.messages as Array<Record<string, unknown>>
    expect(finalMessages.map(message => message.role)).toEqual(['system', 'user', 'system'])
    expect(finalMessages[2]?.content).toContain('measuredCostUSD')
    expect(finalMessages.some(message => message.role === 'tool')).toBe(false)
    expect(deltas).toEqual([])
    await expect(new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', transport }).generate({ question: 'What changed in spend?', evidence })).rejects.toThrow('consent')
    expect(answer.runtime).toMatchObject({ id: 'hosted-openai', mode: 'hosted-byok' })
    expect(answer.generatedByModel).toBe(true)
    expect(answer.streamed).toBe(false)
    expect(answer.conclusion).toContain('Metrora measured')
    expect(answer.conclusion).not.toContain('Claude was not the main driver.')
    expect(answer.conclusion).not.toContain('Codex appears to be the main driver.')
  })
  it.each(['openai', 'anthropic', 'gemini'] as const)('does not append contradictory qualitative prose for hosted %s', async provider => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const narrative = 'Codex appears to be the main driver.'
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider, available: true, models: [{ id: provider + '-model', label: provider + '-model', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async () => ({ streamed: false, message: { content: narrative } }),
      cancel: async () => true,
      onEvent: () => () => {},
    }
    const answer = await new HostedAdvisorRuntime({ provider, model: provider + '-model', consent: true, transport }).generate({
      question: 'What changed in spend?', evidence,
    })
    expect(answer.conclusion).toContain('Metrora measured')
    expect(answer.conclusion).not.toContain(narrative)
    expect(answer.streamed).toBe(false)
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
