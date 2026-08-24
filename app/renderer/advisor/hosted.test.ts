// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { createAdvisorConformanceFixture } from './conformance'
import { HostedAdvisorRuntime, type HostedAdvisorTransport } from './hosted'

describe('Hosted Advisor renderer runtime', () => {
  it('sends minimum evidence with streaming enabled and keeps the deterministic answer authoritative', async () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const requests: Array<Record<string, unknown>> = []
    const deltas: string[] = []
    let listener: ((event: { requestId: string; kind: string; text?: string }) => void) | null = null
    const transport: HostedAdvisorTransport = {
      probe: async () => ({ provider: 'openai', available: true, models: [{ id: 'gpt-test', label: 'gpt-test', state: 'discovered', limitation: null }], detail: 'ready', credentialState: 'ready' }),
      chat: async (requestId, payload) => {
        requests.push(payload)
        listener?.({ requestId, kind: 'text-delta', text: 'The pattern is qualitative.' })
        return { streamed: true, message: { content: 'The pattern is qualitative.' } }
      },
      cancel: async () => true,
      onEvent: callback => {
        listener = callback
        return () => { listener = null }
      },
    }
    const answer = await new HostedAdvisorRuntime({ provider: 'openai', model: 'gpt-test', transport }).generate({
      question: 'What changed in spend?',
      evidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      onDelta: text => deltas.push(text),
    })

    const payload = requests[0]!
    const messages = payload.messages as Array<{ role: string; content: string }>
    expect(payload.tools).toEqual([])
    expect(payload.stream).toBe(true)
    expect(messages.map(message => message.role)).toEqual(['system', 'user', 'system'])
    expect(messages[2]?.content).toContain('measuredCostUSD')
    expect(deltas).toEqual(['The pattern is qualitative.'])
    expect(answer.runtime).toMatchObject({ id: 'hosted-openai', mode: 'hosted-byok' })
    expect(answer.generatedByModel).toBe(true)
    expect(answer.streamed).toBe(true)
    expect(answer.conclusion).toContain('Metrora measured')
    expect(answer.conclusion).toContain('Provider context: The pattern is qualitative.')
  })
})
