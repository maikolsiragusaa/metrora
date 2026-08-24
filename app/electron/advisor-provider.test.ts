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
    expect(result).toMatchObject({ ok: true, value: { message: { content: 'Measured stream.' }, streamed: true } })
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
})
