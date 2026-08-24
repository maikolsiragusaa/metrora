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
    const answer = await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', consent: true, transport }).generate({
      question: 'What changed in spend?',
      evidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      executeTool: async () => ({ content: '{"measured":true}', evidence }),
      onDelta: text => deltas.push(text),
    })

    const payload = requests[0]!
    const messages = (payload.messages as Array<{ role: string; content: string }>).slice(0, 3)
    expect(payload.tools).toHaveLength(1)
    expect(payload.stream).toBe(false)
    expect(payload.consent).toBe(true)
    expect(messages.map(message => message.role)).toEqual(['system', 'user', 'system'])
    expect(messages[2]?.content).toContain('measuredCostUSD')
    const finalPayload = requests[1]!
    expect(finalPayload.tools).toEqual([])
    expect(finalPayload.stream).toBe(false)
    const finalMessages = finalPayload.messages as Array<Record<string, unknown>>
    expect(finalMessages.map(message => message.role)).toEqual(['system', 'user', 'system', 'assistant', 'tool'])
    expect(finalMessages[3]).toMatchObject({ role: 'assistant', content: '', toolCalls: [{ id: 'call-spend', name: 'get_spend_snapshot' }] })
    expect(finalMessages[4]).toMatchObject({ role: 'tool', toolCallId: 'call-spend', toolName: 'get_spend_snapshot' })
    expect(deltas).toEqual([])
    await expect(new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', transport }).generate({ question: 'What changed in spend?', evidence })).rejects.toThrow('consent')
    expect(answer.runtime).toMatchObject({ id: 'hosted-openai', mode: 'hosted-byok' })
    expect(answer.generatedByModel).toBe(true)
    expect(answer.streamed).toBe(false)
    expect(answer.conclusion).toContain('Metrora measured')
    expect(answer.conclusion).not.toContain('Claude was not the main driver.')
    expect(answer.conclusion).not.toContain('Codex appears to be the main driver.')
  })
})
