import { describe, expect, it } from 'vitest'
import { createAdvisorHostedHandlers, type AdvisorHostedEvent } from './advisor-provider'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(payloads: readonly unknown[]): Response {
  const body = payloads.map(payload => 'data: ' + JSON.stringify(payload) + '\n\n').join('') + 'data: [DONE]\n\n'
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function handlers(fetchImpl: typeof fetch, events: AdvisorHostedEvent[] = []) {
  return createAdvisorHostedHandlers({
    fetchImpl,
    credentialStatus: async provider => ({ provider, state: 'ready' }),
    readCredential: async () => 'synthetic-secret',
    emitEvent: event => events.push(event),
  })
}

const tool = { type: 'function' as const, function: { name: 'get_spend_snapshot', description: 'Measured spend', parameters: { type: 'object', properties: { provider: { type: 'string' } }, additionalProperties: false } } }

describe('AI SDK provider substrate', () => {
  it('keeps native reasoning/tool continuation opaque while replaying exact IDs', async () => {
    const requests: Record<string, unknown>[] = []
    const events: AdvisorHostedEvent[] = []
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        return jsonResponse({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'private provider reasoning',
              tool_calls: [{ id: 'mimo-call-1', type: 'function', function: { name: 'get_spend_snapshot', arguments: '{"provider":"all"}' } }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        })
      }
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'The measured usage is ready.' }, finish_reason: 'stop' }] })
    }) as typeof fetch
    const hosted = handlers(fetchImpl, events)
    const first = await hosted['metrora:advisorHostedChat']!('ai-first', {
      provider: 'opencode-zen',
      model: 'mimo-v2.5-free',
      messages: [{ role: 'user', content: 'Check usage.' }],
      tools: [tool],
      stream: false,
      consent: true,
      harnessConformance: true,
    }) as { ok: boolean; value: any }

    expect(first.ok).toBe(true)
    expect(first.value.message.tool_calls).toEqual([{ id: 'mimo-call-1', name: 'get_spend_snapshot', arguments: '{"provider":"all"}' }])
    expect(first.value).not.toHaveProperty('providerMetadata')
    expect(first.value.continuation).toMatchObject({ provider: 'opencode-zen', model: 'mimo-v2.5-free', protocol: 'openai-chat', adapter: 'ai-sdk-openai-compatible-v1' })
    expect(first.value.message.content).not.toContain('private provider reasoning')
    expect(events.every(event => !Object.prototype.hasOwnProperty.call(event, 'providerMetadata'))).toBe(true)

    const second = await hosted['metrora:advisorHostedChat']!('ai-second', {
      provider: 'opencode-zen',
      model: 'mimo-v2.5-free',
      messages: [
        { role: 'user', content: 'Check usage.' },
        { role: 'assistant', content: '', toolCalls: first.value.message.tool_calls },
        { role: 'tool', content: '{"measuredCostUSD":12}', toolCallId: 'mimo-call-1', toolName: 'get_spend_snapshot' },
      ],
      tools: [tool],
      stream: false,
      consent: true,
      continuation: first.value.continuation,
      harnessConformance: true,
    }) as { ok: boolean; value: any }

    expect(second).toMatchObject({ ok: true, value: { message: { content: 'The measured usage is ready.' } } })
    const replayed = requests[1]!
    expect(replayed.messages).toEqual([
      { role: 'user', content: 'Check usage.' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'private provider reasoning',
        tool_calls: [{ id: 'mimo-call-1', type: 'function', function: { name: 'get_spend_snapshot', arguments: '{"provider":"all"}' } }],
      },
      { role: 'tool', content: '{"measuredCostUSD":12}', tool_call_id: 'mimo-call-1', name: 'get_spend_snapshot' },
    ])
    expect(replayed.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', reasoning_content: 'private provider reasoning' })]))
    expect(JSON.stringify(events)).not.toContain('providerMetadata')
  })

  it('ignores continuation from a different exact model and stays on semantic history', async () => {
    const requests: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Safe answer.' }, finish_reason: 'stop' }] })
    }) as typeof fetch
    const hosted = handlers(fetchImpl)
    const result = await hosted['metrora:advisorHostedChat']!('ai-incompatible', {
      provider: 'openrouter',
      model: 'openai/gpt-5',
      messages: [
        { role: 'user', content: 'Check usage.' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'get_spend_snapshot', arguments: '{}' }] },
        { role: 'tool', content: '{"measuredCostUSD":12}', toolCallId: 'call-1', toolName: 'get_spend_snapshot' },
      ],
      tools: [tool],
      stream: false,
      consent: true,
      continuation: {
        provider: 'openrouter',
        model: 'openai/other-model',
        protocol: 'openai-chat',
        adapter: 'ai-sdk-openai-compatible-v1',
        responseMessages: [{ role: 'assistant', content: [{ type: 'reasoning', text: 'do not replay me' }, { type: 'tool-call', toolCallId: 'call-1', toolName: 'get_spend_snapshot', input: {} }] }],
      },
      harnessConformance: true,
    }) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true })
    expect(JSON.stringify(requests[0])).not.toContain('do not replay me')
    expect(JSON.stringify(requests[0])).toContain('call-1')
  })

  it('maps OpenAI-compatible streaming text and lifecycle events without provider metadata', async () => {
    const events: AdvisorHostedEvent[] = []
    const fetchImpl = (async () => sseResponse([
      { choices: [{ index: 0, delta: { role: 'assistant', content: 'Safe ' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'streamed answer.' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } },
    ])) as typeof fetch
    const hosted = handlers(fetchImpl, events)
    const result = await hosted['metrora:advisorHostedChat']!('ai-stream', {
      provider: 'openrouter',
      model: 'openai/gpt-5',
      messages: [{ role: 'user', content: 'Give me a concise answer.' }],
      tools: [tool],
      stream: true,
      consent: true,
      harnessConformance: true,
    }) as { ok: boolean; value: any }

    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({ streamed: true, message: { content: 'Safe streamed answer.', tool_calls: [] } })
    expect(events.some(event => event.kind === 'text-delta' && event.text === 'Safe ')).toBe(true)
    expect(events.some(event => event.kind === 'text-delta' && event.text === 'streamed answer.')).toBe(true)
    expect(events.some(event => event.kind === 'completed' && event.streamed === true)).toBe(true)
    expect(JSON.stringify(result.value)).not.toContain('providerMetadata')
  })
})
