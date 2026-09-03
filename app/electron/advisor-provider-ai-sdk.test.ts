import { describe, expect, it } from 'vitest'
import { createAdvisorHostedHandlers, type AdvisorHostedEvent } from './advisor-provider'
import { transformOpenAiCompatibleRequestBody } from './advisor-provider-ai-sdk'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(payloads: readonly unknown[]): Response {
  const body = payloads.map(payload => 'data: ' + JSON.stringify(payload) + '\n\n').join('') + 'data: [DONE]\n\n'
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function responsesTextPayload(text: string, outputId = 'msg-1'): Record<string, unknown> {
  return {
    id: 'resp-' + outputId,
    object: 'response',
    created_at: 1_778_307_756,
    model: 'muse-spark-1.2-contributor-free',
    output: [{ type: 'message', role: 'assistant', id: outputId, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
  }
}

function handlers(fetchImpl: typeof fetch, events: AdvisorHostedEvent[] = [], diagnostics: Array<Record<string, unknown>> = []) {
  return createAdvisorHostedHandlers({
    fetchImpl,
    credentialStatus: async provider => ({ provider, state: 'ready' }),
    readCredential: async () => 'synthetic-secret',
    emitEvent: event => events.push(event),
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
  })
}

const tool = { type: 'function' as const, function: { name: 'get_spend_snapshot', description: 'Measured spend', parameters: { type: 'object', properties: { provider: { type: 'string' } }, additionalProperties: false } } }

const mimoCall = { id: 'mimo-call-1', type: 'function', function: { name: 'get_spend_snapshot', arguments: '{}' } }

describe('AI SDK provider substrate', () => {
  it('prepares an ordinary MiMo no-Tool request without an interleaved field', () => {
    expect(transformOpenAiCompatibleRequestBody({ model: 'mimo-v2.5-free', messages: [{ role: 'user', content: 'Ci sei?' }] })).toEqual({
      model: 'mimo-v2.5-free',
      messages: [{ role: 'user', content: 'Ci sei?' }],
    })
  })

  it('prepares a MiMo Tool-call request with an explicit empty reasoning_content field', () => {
    expect(transformOpenAiCompatibleRequestBody({ model: 'mimo-v2.5-free', messages: [{ role: 'assistant', content: null, tool_calls: [mimoCall] }] })).toEqual({
      model: 'mimo-v2.5-free',
      messages: [{ role: 'assistant', content: null, tool_calls: [mimoCall], reasoning_content: '' }],
    })
  })

  it('prepares a MiMo Tool-result continuation with the exact function name', () => {
    expect(transformOpenAiCompatibleRequestBody({ model: 'mimo-v2.5-free', messages: [
      { role: 'assistant', content: null, tool_calls: [mimoCall] },
      { role: 'tool', content: '{"measuredCostUSD":12}', tool_call_id: 'mimo-call-1' },
    ] })).toEqual({
      model: 'mimo-v2.5-free',
      messages: [
        { role: 'assistant', content: null, tool_calls: [mimoCall], reasoning_content: '' },
        { role: 'tool', content: '{"measuredCostUSD":12}', tool_call_id: 'mimo-call-1', name: 'get_spend_snapshot' },
      ],
    })
  })

  it('keeps an explicitly empty MiMo reasoning_content continuation empty', () => {
    expect(transformOpenAiCompatibleRequestBody({ model: 'mimo-v2.5-free', messages: [{ role: 'assistant', content: null, reasoning_content: '', tool_calls: [mimoCall] }] }).messages).toEqual([
      { role: 'assistant', content: null, reasoning_content: '', tool_calls: [mimoCall] },
    ])
  })

  it('preserves non-empty MiMo reasoning_content on continuation', () => {
    expect(transformOpenAiCompatibleRequestBody({ model: 'mimo-v2.5-free', messages: [{ role: 'assistant', content: null, reasoning_content: 'bounded-reasoning', tool_calls: [mimoCall] }] }).messages).toEqual([
      { role: 'assistant', content: null, reasoning_content: 'bounded-reasoning', tool_calls: [mimoCall] },
    ])
  })

  it.each(['high', 'xhigh'] as const)('routes reviewed Muse through OpenAI Responses and keeps the natural first step at %s reasoning', async reasoningEffort => {
    const requests: Record<string, unknown>[] = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/zen/v1/models')) return jsonResponse({ data: [{ id: 'muse-spark-1.2-contributor-free', protocol: 'openai-responses' }] })
      expect(String(url)).toBe('https://opencode.ai/zen/v1/responses')
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return jsonResponse(responsesTextPayload('Metrora measured the requested facts and I can explain them.'))
    }) as typeof fetch
    const hosted = handlers(fetchImpl)
    await hosted['metrora:advisorHostedProbe']!('opencode-zen')
    const result = await hosted['metrora:advisorHostedChat']!('muse-natural', {
      provider: 'opencode-zen',
      model: 'muse-spark-1.2-contributor-free',
      messages: [{ role: 'user', content: 'È vero che ho speso più di 4.000 dollari lifetime?' }],
      tools: [tool],
      reasoningEffort,
      stream: false,
      consent: true,
      harnessConformance: true,
    }) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { model: 'muse-spark-1.2-contributor-free', message: { content: 'Metrora measured the requested facts and I can explain them.' } } })
    expect(requests[0]).toMatchObject({ model: 'muse-spark-1.2-contributor-free' })
    expect(requests[0]).toHaveProperty('input')
    expect(requests[0]).toHaveProperty('reasoning.effort', reasoningEffort)
    expect(requests[0]).toHaveProperty('reasoning.summary', 'detailed')
    expect(JSON.stringify(result)).not.toContain('providerMetadata')
  })

  it('replays a Muse Responses tool continuation inside the same bounded adapter', async () => {
    const requests: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return requests.length === 1
        ? jsonResponse({
            id: 'resp-tool-1', object: 'response', created_at: 1_778_307_756, model: 'muse-spark-1.2-contributor-free',
            output: [
              { type: 'reasoning', id: 'rs-tool-1', encrypted_content: 'encrypted-reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] },
              { type: 'function_call', id: 'fc-tool-1', call_id: 'muse-call-1', name: 'get_spend_snapshot', arguments: '{}', status: 'completed' },
            ],
            usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
          })
        : jsonResponse(responsesTextPayload('The canonical read is complete.', 'msg-2'))
    }) as typeof fetch
    const hosted = handlers(fetchImpl)
    const first = await hosted['metrora:advisorHostedChat']!('muse-tool-first', {
      provider: 'opencode-zen', model: 'muse-spark-1.2-contributor-free',
      messages: [{ role: 'user', content: 'Check usage.' }], tools: [tool], toolChoice: 'required', stream: false, consent: true, harnessConformance: true,
    }) as { ok: boolean; value: any }
    expect(first).toMatchObject({ ok: true, value: { message: { tool_calls: [{ id: 'muse-call-1', name: 'get_spend_snapshot', arguments: '{}' }] }, continuation: { protocol: 'openai-responses', adapter: 'ai-sdk-openai-responses-v1' } } })
    expect(requests[0]?.tool_choice).toBe('required')
    expect(JSON.stringify(first)).not.toContain('private reasoning')
    expect(JSON.stringify(first)).not.toContain('encrypted-reasoning')

    const second = await hosted['metrora:advisorHostedChat']!('muse-tool-second', {
      provider: 'opencode-zen', model: 'muse-spark-1.2-contributor-free',
      messages: [
        { role: 'user', content: 'Check usage.' },
        { role: 'assistant', content: '', toolCalls: first.value.message.tool_calls },
        { role: 'tool', content: '{"measuredCostUSD":12}', toolCallId: 'muse-call-1', toolName: 'get_spend_snapshot' },
      ],
      tools: [tool], stream: false, consent: true, continuation: first.value.continuation, harnessConformance: true,
    }) as { ok: boolean; value: any }
    expect(second).toMatchObject({ ok: true, value: { message: { content: 'The canonical read is complete.' } } })
    expect(requests[1]).toHaveProperty('input')
    expect(JSON.stringify(requests[1])).not.toContain('private reasoning')
  })

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
      toolChoice: 'required',
      stream: false,
      consent: true,
      harnessConformance: true,
    }) as { ok: boolean; value: any }

    expect(first.ok).toBe(true)
    expect(first.value.message.tool_calls).toEqual([{ id: 'mimo-call-1', name: 'get_spend_snapshot', arguments: '{"provider":"all"}' }])
    expect(first.value).not.toHaveProperty('providerMetadata')
    expect(first.value.continuation).toMatchObject({ id: expect.any(String), provider: 'opencode-zen', model: 'mimo-v2.5-free', protocol: 'openai-chat', adapter: 'ai-sdk-openai-compatible-v1' })
    expect(first.value.continuation).not.toHaveProperty('responseMessages')
    expect(first.value.message.content).not.toContain('private provider reasoning')
    expect(JSON.stringify(first)).not.toContain('private provider reasoning')
    expect(JSON.stringify(first.value.continuation)).not.toContain('private provider reasoning')
    expect(events.every(event => !Object.prototype.hasOwnProperty.call(event, 'providerMetadata'))).toBe(true)
    expect(JSON.stringify(events)).not.toContain('private provider reasoning')

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

  it('rejects a continuation reference from a different exact model', async () => {
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
        id: 'opaque-continuation-reference-1',
        provider: 'openrouter',
        model: 'openai/other-model',
        protocol: 'openai-chat',
        adapter: 'ai-sdk-openai-compatible-v1',
      },
      harnessConformance: true,
    }) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: false, error: { kind: 'continuation-unavailable' } })
    expect(requests).toHaveLength(0)
  })

  it('rejects raw provider-native continuation payloads at the IPC boundary', async () => {
    const fetchImpl = (async () => jsonResponse({ choices: [{ message: { role: 'assistant', content: 'not reached' } }] })) as typeof fetch
    const hosted = handlers(fetchImpl)
    const result = await hosted['metrora:advisorHostedChat']!('ai-raw-continuation', {
      provider: 'opencode-zen',
      model: 'mimo-v2.5-free',
      messages: [{ role: 'user', content: 'Check usage.' }],
      stream: false,
      consent: true,
      continuation: {
        id: 'opaque-continuation-reference-raw',
        provider: 'opencode-zen',
        model: 'mimo-v2.5-free',
        protocol: 'openai-chat',
        adapter: 'ai-sdk-openai-compatible-v1',
        responseMessages: [{ role: 'assistant', content: [{ type: 'reasoning', text: 'private provider reasoning' }] }],
      },
      harnessConformance: true,
    }) as { ok: boolean; error: { kind: string } }
    expect(result).toMatchObject({ ok: false, error: { kind: 'request-malformed' } })
    expect(JSON.stringify(result)).not.toContain('private provider reasoning')
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

  it('retains a safe AI SDK request-rejection diagnostic inside Electron', async () => {
    const diagnostics: Array<Record<string, unknown>> = []
    const fetchImpl = (async () => jsonResponse({ error: { message: 'private prompt and credential details must not escape' } }, 422)) as typeof fetch
    const hosted = handlers(fetchImpl, [], diagnostics)
    const result = await hosted['metrora:advisorHostedChat']!('ai-diagnostic', {
      provider: 'openrouter',
      model: 'openai/gpt-5',
      messages: [{ role: 'user', content: 'Give me a concise answer.' }],
      stream: false,
      consent: true,
      harnessConformance: true,
    }) as { ok: boolean; error?: { kind: string; message: string } }

    expect(result).toMatchObject({ ok: false, error: { kind: 'provider-request-rejected' } })
    expect(diagnostics).toEqual([expect.objectContaining({ status: 422, stage: 'ai-sdk', category: 'provider-request-rejected' })])
    expect(JSON.stringify(result)).not.toMatch(/private prompt|credential details|synthetic-secret/i)
  })
})
