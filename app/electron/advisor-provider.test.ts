import { describe, expect, it, vi } from 'vitest'

import { advisorHostedProviderDescriptors, createAdvisorHostedHandlers, type AdvisorHostedEvent, type AdvisorHostedProviderId } from './advisor-provider'

const providers: AdvisorHostedProviderId[] = ['openai', 'anthropic', 'gemini']
const request = (provider: AdvisorHostedProviderId, stream = false) => ({
  provider,
  model: provider === 'gemini' ? 'models/gemini-2.5-flash' : provider + '-test-model',
  messages: [{ role: 'user', content: 'Return a short evidence-safe answer.' }],
  stream,
  consent: true,
})
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
function sseResponse(payloads: unknown[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) controller.enqueue(encoder.encode('data: ' + JSON.stringify(payload) + '\n\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
function readyHandlers(fetchImpl: typeof fetch, events: AdvisorHostedEvent[] = []) {
  return createAdvisorHostedHandlers({
    fetchImpl,
    credentialStatus: async provider => ({ provider, state: 'ready' }),
    readCredential: async () => 'synthetic-secret',
    emitEvent: event => events.push(event),
  })
}
function modelPayload(provider: AdvisorHostedProviderId): Record<string, unknown> {
  if (provider === 'gemini') return { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] }] }
  if (provider === 'anthropic') return { data: [{ id: 'claude-test', display_name: 'Claude Test' }] }
  return { data: [{ id: 'gpt-test', object: 'model' }] }
}
function textPayload(provider: AdvisorHostedProviderId): Record<string, unknown> {
  if (provider === 'gemini') return { candidates: [{ content: { parts: [{ text: 'Measured response.' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 } }
  if (provider === 'anthropic') return { content: [{ type: 'text', text: 'Measured response.' }], usage: { input_tokens: 4, output_tokens: 3 } }
  return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Measured response.' }] }], usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } }
}

describe('Advisor hosted provider authority', () => {
  it('keeps provider origins and paths code-owned', () => {
    expect(advisorHostedProviderDescriptors).toEqual({
      openai: { origin: 'https://api.openai.com', modelsPath: '/v1/models', chatPath: '/v1/responses' },
      anthropic: { origin: 'https://api.anthropic.com', modelsPath: '/v1/models', chatPath: '/v1/messages', anthropicVersion: '2023-06-01' },
      gemini: { origin: 'https://generativelanguage.googleapis.com', modelsPath: '/v1beta/models', chatPath: '/v1beta/models/{model}:generateContent', streamPath: '/v1beta/models/{model}:streamGenerateContent?alt=sse' },
      openrouter: { origin: 'https://openrouter.ai', modelsPath: '/api/v1/models?output_modalities=text', chatPath: '/api/v1/chat/completions', protocol: 'openai-chat' },
      'opencode-zen': {
        origin: 'https://opencode.ai',
        modelsPath: '/zen/v1/models',
        modelProtocol: 'per-model',
        chatPaths: {
          responses: '/zen/v1/responses',
          messages: '/zen/v1/messages',
          chat: '/zen/v1/chat/completions',
          gemini: '/zen/v1/models/{model}:generateContent',
          geminiStream: '/zen/v1/models/{model}:streamGenerateContent?alt=sse',
        },
      },
    })
  })

  it.each(providers)('discovers %s models with provider-specific auth and redirect rejection', async provider => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse(modelPayload(provider))
    }) as typeof fetch
    const handlers = readyHandlers(fetchImpl)
    const result = await handlers['metrora:advisorHostedProbe']!(provider) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { provider, available: true, credentialState: 'ready' } })
    expect(result.value.models[0].state).toBe('discovered')
    expect(calls[0]?.init?.redirect).toBe('error')
    const headers = calls[0]?.init?.headers as Record<string, string>
    if (provider === 'openai') expect(headers.Authorization).toBe('Bearer synthetic-secret')
    if (provider === 'anthropic') {
      expect(headers['x-api-key']).toBe('synthetic-secret')
      expect(headers['anthropic-version']).toBe('2023-06-01')
    }
    if (provider === 'gemini') expect(headers['x-goog-api-key']).toBe('synthetic-secret')
  })

  it.each(providers)('parses %s non-streaming text and emits only normalized events', async provider => {
    const events: AdvisorHostedEvent[] = []
    const fetchImpl = (async () => jsonResponse(textPayload(provider))) as typeof fetch
    const handlers = readyHandlers(fetchImpl, events)
    const result = await handlers['metrora:advisorHostedChat']!('request-' + provider, request(provider)) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { provider, message: { content: 'Measured response.' }, streamed: false } })
    expect(result.value.usage).toMatchObject({ inputTokens: 4, outputTokens: 3 })
    expect(events.map(event => event.kind)).toContain('text-delta')
    expect(events.at(-1)?.kind).toBe('completed')
    expect(JSON.stringify(events)).not.toContain('synthetic-secret')
  })

  it.each(providers)('parses %s SSE text without forwarding provider event names', async provider => {
    const events: AdvisorHostedEvent[] = []
    const streamPayloads = provider === 'openai'
      ? [{ type: 'response.output_text.delta', delta: 'Measured ' }, { type: 'response.output_text.delta', delta: 'stream.' }, { type: 'response.completed', response: { usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } } }]
      : provider === 'anthropic'
        ? [{ type: 'message_start', message: { usage: { input_tokens: 2 } } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Measured stream.' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', usage: { output_tokens: 2 } }]
        : [{ candidates: [{ content: { parts: [{ text: 'Measured stream.' }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 } }]
    const fetchImpl = (async () => sseResponse(streamPayloads)) as typeof fetch
    const handlers = readyHandlers(fetchImpl, events)
    const result = await handlers['metrora:advisorHostedChat']!('stream-' + provider, request(provider, true)) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { message: { content: 'Measured stream.' }, streamed: true, usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } } })
    expect(events.some(event => event.kind === 'text-delta')).toBe(true)
    expect(events.some(event => event.kind === 'response.output_text.delta' as never)).toBe(false)
  })

  it('requires explicit evidence-sharing consent in the main process', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(textPayload('openai')))
    const handlers = readyHandlers(fetchImpl)
    const result = await handlers['metrora:advisorHostedChat']!('no-consent', { ...request('openai'), consent: false }) as { ok: boolean; error: { kind: string } }
    expect(result).toMatchObject({ ok: false, error: { kind: 'request-malformed' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects provider-native tools and never calls the network', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(textPayload('openai')))
    const handlers = readyHandlers(fetchImpl)
    const result = await handlers['metrora:advisorHostedChat']!('tool-request', { ...request('openai'), tools: [{ type: 'function', function: { name: 'web_search' } }] }) as { ok: boolean; error: { kind: string; message: string } }
    expect(result).toMatchObject({ ok: false, error: { kind: 'tool-unsupported' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('redacts provider error bodies and supports cancellation', async () => {
    const failure = readyHandlers((async () => jsonResponse({ error: 'sk-live-secret-body' }, 500)) as typeof fetch)
    const failed = await failure['metrora:advisorHostedChat']!('failure', request('openai')) as { ok: boolean; error: { message: string } }
    expect(failed).toMatchObject({ ok: false })
    expect(JSON.stringify(failed)).not.toContain('sk-live-secret-body')

    let started!: () => void
    const fetchStarted = new Promise<void>(resolve => { started = resolve })
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      started()
      await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
      throw new Error('unreachable')
    }) as typeof fetch
    const events: AdvisorHostedEvent[] = []
    const handlers = readyHandlers(fetchImpl, events)
    const pending = handlers['metrora:advisorHostedChat']!('cancel-me', request('openai'))
    await fetchStarted
    expect(await handlers['metrora:advisorHostedCancel']!('cancel-me')).toEqual({ ok: true, value: true })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'cancelled' } })
    expect(events.some(event => event.kind === 'cancelled')).toBe(true)
  })
  it('cancels hosted chat during credential custody before any provider request starts', async () => {
    let markStatusStarted!: () => void
    const statusStarted = new Promise<void>(resolve => { markStatusStarted = resolve })
    let resolveStatus!: (value: { provider: 'openai'; state: 'ready' }) => void
    const fetchImpl = vi.fn(async () => jsonResponse(textPayload('openai')))
    const handlers = createAdvisorHostedHandlers({
      fetchImpl,
      credentialStatus: async () => {
        markStatusStarted()
        return await new Promise<{ provider: 'openai'; state: 'ready' }>(resolve => { resolveStatus = resolve })
      },
      readCredential: async () => 'synthetic-secret',
    })
    const pending = handlers['metrora:advisorHostedChat']!('custody-cancel', request('openai'))
    await statusStarted
    expect(await handlers['metrora:advisorHostedCancel']!('custody-cancel')).toEqual({ ok: true, value: true })
    resolveStatus({ provider: 'openai', state: 'ready' })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'cancelled' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('cancels an in-flight hosted model probe', async () => {
    let started!: () => void
    const fetchStarted = new Promise<void>(resolve => { started = resolve })
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      started()
      await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
      throw new Error('unreachable')
    }) as typeof fetch
    const handlers = readyHandlers(fetchImpl)
    const pending = handlers['metrora:advisorHostedProbe']!('openai', 'probe-cancel')
    await fetchStarted
    expect(await handlers['metrora:advisorHostedCancel']!('probe-cancel')).toEqual({ ok: true, value: true })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'cancelled' } })
  })
  it('labels a provider-rejected credential as invalid without exposing the response body', async () => {
    const handlers = readyHandlers((async () => jsonResponse({ error: 'secret-body' }, 401)) as typeof fetch)
    const result = await handlers['metrora:advisorHostedProbe']!('openai') as { ok: boolean; value: { credentialState: string; detail: string } }
    expect(result).toMatchObject({ ok: true, value: { credentialState: 'invalid', detail: 'The provider rejected the saved credential.' } })
    expect(JSON.stringify(result)).not.toContain('secret-body')
  })
  it.each(providers)('maps %s independent planning/synthesis payloads without provider-native continuation', async provider => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse(textPayload(provider))
    }) as typeof fetch
    const handlers = readyHandlers(fetchImpl)
    const tool = { type: 'function' as const, function: { name: 'get_spend_snapshot', description: 'Measured spend', parameters: { type: 'object' } } }
    const result = await handlers['metrora:advisorHostedChat']!('native-' + provider, {
      ...request(provider),
      messages: [
        { role: 'system', content: 'Use canonical facts.' },
        { role: 'user', content: 'What changed?' },
      ],
      tools: [tool],
    }) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { provider } })
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, any>
    expect(body).not.toHaveProperty('conversation')
    expect(body).not.toHaveProperty('previous_response_id')
    expect(body).not.toHaveProperty('background')
    expect(JSON.stringify(body)).not.toContain('function_call_output')
    expect(JSON.stringify(body)).not.toContain('tool_result')
    expect(JSON.stringify(body)).not.toContain('functionResponse')
    if (provider === 'openai') {
      expect(body.store).toBe(false)
      expect(body.tools).toEqual([{ type: 'function', name: 'get_spend_snapshot', description: 'Measured spend', parameters: { type: 'object' } }])
      expect(body.input).toEqual([{ role: 'user', content: 'What changed?' }])
    } else if (provider === 'anthropic') {
      expect(body.system).toBe('Use canonical facts.')
      expect(body.tools).toEqual([{ name: 'get_spend_snapshot', description: 'Measured spend', input_schema: { type: 'object' } }])
      expect(body.messages).toEqual([{ role: 'user', content: 'What changed?' }])
    } else {
      expect(body.systemInstruction).toEqual({ parts: [{ text: 'Use canonical facts.' }] })
      expect(body.tools).toEqual([{ functionDeclarations: [{ name: 'get_spend_snapshot', description: 'Measured spend', parameters: { type: 'object' } }] }])
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'What changed?' }] }])
    }
  })

  it.each(['anthropic', 'gemini'] as const)('collects bounded multi-page %s model discovery without duplicate records', async provider => {
    const urls: string[] = []
    const fetchImpl = (async (url: RequestInfo | URL) => {
      urls.push(String(url))
      if (provider === 'anthropic') {
        return jsonResponse(urls.length === 1
          ? { data: [{ id: 'claude-page-1', display_name: 'Claude page one' }], has_more: true, last_id: 'claude-page-2' }
          : { data: [{ id: 'claude-page-1' }, { id: 'claude-page-2', display_name: 'Claude page two' }], has_more: false })
      }
      return jsonResponse(urls.length === 1
        ? { models: [{ name: 'models/gemini-page-1', displayName: 'Gemini page one', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'gemini-page-2' }
        : { models: [{ name: 'models/gemini-page-1' }, { name: 'models/gemini-page-2', displayName: 'Gemini page two', supportedGenerationMethods: ['generateContent'] }] })
    }) as typeof fetch
    const handlers = readyHandlers(fetchImpl)
    const result = await handlers['metrora:advisorHostedProbe']!(provider) as { ok: boolean; value: any }
    expect(result.value.models.map((model: { id: string }) => model.id)).toEqual(provider === 'anthropic'
      ? ['claude-page-1', 'claude-page-2']
      : ['models/gemini-page-1', 'models/gemini-page-2'])
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain(provider === 'anthropic' ? 'after_id=claude-page-2' : 'pageToken=gemini-page-2')
  })

  it('stops repeated model pagination tokens and deduplicates usable records', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: RequestInfo | URL) => {
      urls.push(String(url))
      return jsonResponse({ data: [{ id: 'claude-cycle' }], has_more: true, last_id: 'same-token' })
    }) as typeof fetch
    const handlers = readyHandlers(fetchImpl)
    const result = await handlers['metrora:advisorHostedProbe']!('anthropic') as { ok: boolean; value: any }
    expect(result.value.models.map((model: { id: string }) => model.id)).toEqual(['claude-cycle'])
    expect(urls).toHaveLength(2)
  })

  it('maps an OpenAI Responses output item id to its canonical call id across argument deltas', async () => {
    const events: AdvisorHostedEvent[] = []
    const streamPayloads = [
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'get_spend_snapshot' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"provider":' },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '"all"}' },
      { type: 'response.function_call_arguments.done', item_id: 'item-1', name: 'get_spend_snapshot', arguments: '{"provider":"all"}' },
      { type: 'response.completed', response: { usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } } },
    ]
    const handlers = readyHandlers((async () => sseResponse(streamPayloads)) as typeof fetch, events)
    const result = await handlers['metrora:advisorHostedChat']!('item-call-fixture', request('openai', true)) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { message: { tool_calls: [{ id: 'call-1', name: 'get_spend_snapshot', arguments: '{"provider":"all"}' }] } } })
    expect(events.find(event => event.kind === 'tool-call-start')).toMatchObject({ callId: 'call-1', name: 'get_spend_snapshot' })
    expect(events.find(event => event.kind === 'tool-call-delta')).toMatchObject({ callId: 'call-1' })
    expect(events.find(event => event.kind === 'tool-call-complete')).toMatchObject({ callId: 'call-1', arguments: '{"provider":"all"}' })
  })
  it('rejects more than the bounded number of JSON tool calls', async () => {
    const payload = { output: Array.from({ length: 9 }, (_, index) => ({ type: 'function_call', call_id: 'call-' + index, name: 'get_spend_snapshot', arguments: '{}' })) }
    const result = await readyHandlers((async () => jsonResponse(payload)) as typeof fetch)['metrora:advisorHostedChat']!('too-many-json-tools', request('openai')) as { ok: boolean; error: { kind: string } }
    expect(result).toMatchObject({ ok: false, error: { kind: 'tool-malformed' } })
  })
  it('rejects an OpenAI Responses stream that ends with an incomplete tool call', async () => {
    const payloads = [{ type: 'response.output_item.added', item: { id: 'item-incomplete', type: 'function_call', call_id: 'call-incomplete', name: 'get_spend_snapshot' } }, { type: 'response.completed', response: {} }]
    const result = await readyHandlers((async () => sseResponse(payloads)) as typeof fetch)['metrora:advisorHostedChat']!('incomplete-response-tool', request('openai', true)) as { ok: boolean; error: { kind: string } }
    expect(result).toMatchObject({ ok: false, error: { kind: 'tool-malformed' } })
  })

  it('discovers OpenRouter capabilities without treating model listing as conformance', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ data: [
        { id: 'openai/gpt-5', name: 'GPT 5', supported_parameters: ['tools', 'structured_outputs'] },
        { id: 'openai/text-only', name: 'Text only', supported_parameters: [] },
      ] })
    }) as typeof fetch
    const result = await readyHandlers(fetchImpl)['metrora:advisorHostedProbe']!('openrouter') as { ok: boolean; value: any }
    expect(result.value.models).toEqual([
      expect.objectContaining({ id: 'openai/gpt-5', state: 'unverified', capabilities: { conversational: 'available', streaming: 'unknown', toolCall: 'unknown' } }),
      expect.objectContaining({ id: 'openai/text-only', state: 'limited', capabilities: { conversational: 'available', streaming: 'unknown', toolCall: 'unsupported' } }),
    ])
    expect(calls[0]?.url).toContain('output_modalities=text')
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-secret')
  })

  it('marks OpenRouter models without capability metadata unverified and fails closed for native tools', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ data: [{ id: 'openai/metadata-missing', name: 'Metadata missing' }] })
    }) as typeof fetch
    const probe = await readyHandlers(fetchImpl)['metrora:advisorHostedProbe']!('openrouter') as { ok: boolean; value: any }
    expect(probe.value.models[0]).toEqual(expect.objectContaining({
      id: 'openai/metadata-missing',
      state: 'unverified',
      capabilities: { conversational: 'available', streaming: 'unknown', toolCall: 'unknown' },
    }))
  })

  it('maps OpenRouter Chat Completions body, auth and usage', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'OpenRouter response.' } }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } })
    }) as typeof fetch
    const tool = { type: 'function' as const, function: { name: 'get_spend_snapshot', description: 'Measured spend', parameters: { type: 'object' } } }
    const result = await readyHandlers(fetchImpl)['metrora:advisorHostedChat']!('openrouter-chat', {
      provider: 'openrouter', model: 'openai/gpt-5', messages: [{ role: 'user', content: 'What changed?' }], tools: [tool], stream: false, consent: true,
    }) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { provider: 'openrouter', message: { content: 'OpenRouter response.' }, usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 } } })
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-secret')
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, any>
    expect(body.messages).toEqual([{ role: 'user', content: 'What changed?' }])
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'get_spend_snapshot', description: 'Measured spend', parameters: { type: 'object' } } }])
  })
  it('assigns unique bounded ids when a JSON tool call omits its provider id', async () => {
    const fetchImpl = (async () => jsonResponse({ choices: [{ message: { tool_calls: [
      { function: { name: 'get_spend_snapshot', arguments: '{}' } },
      { function: { name: 'get_model_efficiency', arguments: '{}' } },
    ] } }] })) as typeof fetch
    const result = await readyHandlers(fetchImpl)['metrora:advisorHostedChat']!('openrouter-json-ids', {
      provider: 'openrouter', model: 'openai/gpt-5', messages: [{ role: 'user', content: 'Use evidence.' }], consent: true,
    }) as { ok: boolean; value: any }
    expect(result.value.message.tool_calls.map((call: { id: string }) => call.id)).toEqual(['openrouter-tool-0', 'openrouter-tool-1'])
  })

  it('normalizes OpenRouter streamed tool calls without provider-native events', async () => {
    const events: AdvisorHostedEvent[] = []
    const payloads = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'or-call-1', type: 'function', function: { name: 'get_spend_snapshot', arguments: '{"provider":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"all"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
    ]
    const handlers = readyHandlers((async () => sseResponse(payloads)) as typeof fetch, events)
    const result = await handlers['metrora:advisorHostedChat']!('openrouter-stream', {
      provider: 'openrouter', model: 'openai/gpt-5', messages: [{ role: 'user', content: 'Use evidence.' }], stream: true, consent: true,
    }) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { message: { tool_calls: [{ id: 'or-call-1', name: 'get_spend_snapshot', arguments: '{"provider":"all"}' }] }, streamed: true } })
    expect(events.find(event => event.kind === 'tool-call-start')).toMatchObject({ provider: 'openrouter', callId: 'or-call-1' })
    expect(events.find(event => event.kind === 'tool-call-complete')).toMatchObject({ callId: 'or-call-1', arguments: '{"provider":"all"}' })
  })

  it('keeps a stable synthetic Chat tool id when the provider assigns its id after the first delta', async () => {
    const events: AdvisorHostedEvent[] = []
    const payloads = [
      { choices: [{ delta: { tool_calls: [{ index: 0, type: 'function', function: { name: 'get_spend_snapshot', arguments: '{"provider":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'late-provider-id', function: { arguments: '"all"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]
    const handlers = readyHandlers((async () => sseResponse(payloads)) as typeof fetch, events)
    const result = await handlers['metrora:advisorHostedChat']!('openrouter-late-id', {
      provider: 'openrouter', model: 'openai/gpt-5', messages: [{ role: 'user', content: 'Use evidence.' }], stream: true, consent: true,
    }) as { ok: boolean; value: any }
    expect(result).toMatchObject({ ok: true, value: { message: { tool_calls: [{ id: 'openrouter-tool-0', name: 'get_spend_snapshot', arguments: '{"provider":"all"}' }] } } })
    expect(events.find(event => event.kind === 'tool-call-delta')).toMatchObject({ callId: 'openrouter-tool-0' })
  })

  it('keeps OpenCode Zen protocol, endpoint and credential headers model-specific', async () => {
    const cases = [
      { model: 'gpt-5.6-sol', path: '/zen/v1/responses', header: 'Authorization', payload: textPayload('openai') },
      { model: 'claude-sonnet-5', path: '/zen/v1/messages', header: 'x-api-key', payload: textPayload('anthropic') },
      { model: 'deepseek-v4-pro', path: '/zen/v1/chat/completions', header: 'Authorization', payload: { choices: [{ message: { content: 'Zen chat response.' } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } } },
      { model: 'gemini-3.6-flash', path: '/zen/v1/models/gemini-3.6-flash:generateContent', header: 'x-goog-api-key', payload: textPayload('gemini') },
    ] as const
    for (const item of cases) {
      const calls: Array<{ url: string; init?: RequestInit }> = []
      const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        return jsonResponse(item.payload)
      }) as typeof fetch
      const result = await readyHandlers(fetchImpl)['metrora:advisorHostedChat']!('zen-' + item.model, {
        provider: 'opencode-zen', model: item.model, messages: [{ role: 'user', content: 'Use the approved path.' }], stream: false, consent: true,
      }) as { ok: boolean; value: any }
      expect(result).toMatchObject({ ok: true, value: { provider: 'opencode-zen', model: item.model } })
      expect(calls[0]?.url).toBe('https://opencode.ai' + item.path)
      const headers = calls[0]?.init?.headers as Record<string, string>
      expect(headers[item.header]).toBe(item.header === 'Authorization' ? 'Bearer synthetic-secret' : 'synthetic-secret')
    }
  })

  it('marks unknown OpenCode Zen models unsupported and fails closed before network use', async () => {
    const probeFetch = (async () => jsonResponse({ data: [{ id: 'future-unknown-model' }, { id: 'gpt-future-model' }, { id: 'gpt-5.6-sol' }] })) as typeof fetch
    const probe = await readyHandlers(probeFetch)['metrora:advisorHostedProbe']!('opencode-zen') as { ok: boolean; value: any }
    expect(probe.value.models).toEqual([
      expect.objectContaining({ id: 'future-unknown-model', state: 'unsupported' }),
      expect.objectContaining({ id: 'gpt-future-model', state: 'unsupported' }),
      expect.objectContaining({ id: 'gpt-5.6-sol', state: 'unverified' }),
    ])
    const chatFetch = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'should not run' } }] }))
    const result = await readyHandlers(chatFetch as typeof fetch)['metrora:advisorHostedChat']!('zen-unknown', {
      provider: 'opencode-zen', model: 'gpt-future-model', messages: [{ role: 'user', content: 'Do not run.' }], consent: true,
    }) as { ok: boolean; error: { kind: string } }
    expect(result).toMatchObject({ ok: false, error: { kind: 'model-unavailable' } })
    expect(chatFetch).not.toHaveBeenCalled()
  })
})
