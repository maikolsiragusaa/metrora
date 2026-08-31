import { describe, expect, it, vi } from 'vitest'

import { chatOllamaMain, createAdvisorRuntimeHandlers, probeOllamaMain } from './advisor-runtime'

const payload = { model: 'llama3.2', messages: [], tools: [], stream: true }

function streamedResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}
function textOnlyResponse(text: string): Response {
  return { ok: true, body: null, text: async () => text } as unknown as Response
}

describe('Electron Advisor local runtime', () => {
  it('probes the fixed loopback endpoint and reports discovered models', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ models: [{ name: 'llama3.2' }, { name: 'qwen2.5' }] }), { status: 200 })
    }) as typeof fetch

    await expect(probeOllamaMain(fetchImpl)).resolves.toEqual({
      available: true,
      models: ['llama3.2', 'qwen2.5'],
      detail: 'Local Ollama is reachable.',
      capabilities: [
        { schemaVersion: 1, runtime: 'ollama', modelId: 'llama3.2', discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', limitation: 'Tool-call support is unknown until this model passes a bounded Advisor conformance check.' },
        { schemaVersion: 1, runtime: 'ollama', modelId: 'qwen2.5', discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', limitation: 'Tool-call support is unknown until this model passes a bounded Advisor conformance check.' },
      ],
    })
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/tags')
    expect(calls[0]?.init?.redirect).toBe('error')
  })

  it('reads NDJSON incrementally and caps content without exposing raw deltas', async () => {
    const fetchImpl = (async () => streamedResponse([
      '{"message":{"content":"Measured "}}',
      '\n{"message":{"content":"evidence."},"done":true}\n',
    ])) as typeof fetch
    const result = await chatOllamaMain(fetchImpl, payload)

    expect(result.streamed).toBe(true)
    expect(result.message.content).toBe('Measured evidence.')
  })
  it('fails closed when one valid reader-backed NDJSON record exceeds the content cap', async () => {
    const response = streamedResponse([JSON.stringify({ message: { content: 'x'.repeat(32_001) } }) + '\n'])

    await expect(chatOllamaMain(async () => response, payload)).rejects.toThrow('content limit')
  })

  it('fails closed when valid fallback NDJSON records cumulatively exceed the content cap', async () => {
    const response = textOnlyResponse([
      JSON.stringify({ message: { content: 'x'.repeat(20_000) } }),
      JSON.stringify({ message: { content: 'y'.repeat(12_001) } }),
    ].join('\n'))

    await expect(chatOllamaMain(async () => response, payload)).rejects.toThrow('content limit')
  })

  it('tolerates malformed NDJSON up to the intended bound, then fails closed', async () => {
    const valid = JSON.stringify({ message: { content: 'valid' } }) + '\n'
    const tolerated = streamedResponse([...Array.from({ length: 16 }, () => '{broken\n'), valid])
    await expect(chatOllamaMain(async () => tolerated, payload)).resolves.toMatchObject({ message: { content: 'valid' } })

    const exceeded = streamedResponse([...Array.from({ length: 17 }, () => '{broken\n'), valid])
    await expect(chatOllamaMain(async () => exceeded, payload)).rejects.toThrow('malformed chunks')
  })

  it('enforces the response byte cap on the non-reader fallback path', async () => {
    const response = textOnlyResponse('x'.repeat(2 * 1024 * 1024 + 1))

    await expect(chatOllamaMain(async () => response, payload)).rejects.toThrow('response exceeded the safety limit')
  })

  it('returns a bounded cancellation envelope and never exposes the local endpoint', async () => {
    let rejectRequest: ((error: unknown) => void) | null = null
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })) as typeof fetch
    const handlers = createAdvisorRuntimeHandlers(fetchImpl)
    const pending = handlers['metrora:advisorChat']('request-1', payload)
    await Promise.resolve()
    await expect(handlers['metrora:advisorCancel']('request-1')).resolves.toEqual({ ok: true, value: true })
    const result = await pending
    expect(result).toEqual({ ok: false, error: { kind: 'cancelled', message: 'Advisor request cancelled.' } })
    expect(rejectRequest).not.toBeNull()
  })
  it('fails closed before fetch when the parent signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const fetchImpl = (async () => { calls += 1; return textOnlyResponse('{}') }) as typeof fetch
    await expect(chatOllamaMain(fetchImpl, payload, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(probeOllamaMain(fetchImpl, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(0)
  })
  it('uses UTF-8 byte bounds for streamed content and model requests', async () => {
    const unicode = '€'.repeat(11_000)
    const response = streamedResponse([JSON.stringify({ message: { content: unicode } }) + '\n'])
    await expect(chatOllamaMain(async () => response, payload)).rejects.toThrow('content limit')

    const oversizedPayload = { ...payload, tools: [{ type: 'function', function: { name: 'x', parameters: { blob: 'x'.repeat(2 * 1024 * 1024) } } }] }
    await expect(chatOllamaMain(async () => textOnlyResponse('{}'), oversizedPayload)).rejects.toThrow('request exceeded')
  })

  it('does not forward raw model deltas from the production IPC handler', async () => {
    const fetchImpl = (async () => streamedResponse([
      '{"message":{"content":"token=supersecretvalue"}}\n',
    ])) as typeof fetch
    const deltas: string[] = []
    const handlers = createAdvisorRuntimeHandlers(fetchImpl)
    const result = await handlers['metrora:advisorChat']('request-raw-boundary', payload, (text: string) => deltas.push(text))
    expect(result).toMatchObject({ ok: true })
    expect(deltas).toEqual([])
  })
  it('keeps a newer request flight when an older request completes first', async () => {
    const requests: Array<{ resolve: (response: Response) => void }> = []
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      requests.push({ resolve })
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })) as typeof fetch
    const handlers = createAdvisorRuntimeHandlers(fetchImpl)
    const first = handlers['metrora:advisorChat']('collision', payload)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const second = handlers['metrora:advisorChat']('collision', payload)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[0]!.resolve(textOnlyResponse(JSON.stringify({ message: { content: 'first' } }) + '\n'))
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(handlers['metrora:advisorCancel']('collision')).resolves.toEqual({ ok: true, value: true })
    await expect(second).resolves.toMatchObject({ ok: false, error: { kind: 'cancelled' } })
  })

  it('routes llama-server IPC probe and chat through a validated custom loopback port', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'fixture-model' }] }), { status: 200 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }), { status: 200 })
    }) as typeof fetch
    const handlers = createAdvisorRuntimeHandlers(fetchImpl)
    const probe = await handlers['metrora:advisorProbe']('llama-server', { port: 9091 })
    expect(probe).toMatchObject({ ok: true, value: { available: true, models: ['fixture-model'] } })
    const chat = await handlers['metrora:advisorChat']('llama-custom', { model: 'fixture-model', messages: [{ role: 'user', content: 'hello' }], tools: [], stream: false }, 'llama-server', { port: 9091 })
    expect(chat).toMatchObject({ ok: true, value: { message: { content: 'ready' } } })
    expect(calls).toEqual([
      'http://127.0.0.1:9091/health',
      'http://127.0.0.1:9091/v1/models',
      'http://127.0.0.1:9091/v1/chat/completions',
    ])
  })

  it('rejects malformed llama-server port options before network use', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse('{}')) as typeof fetch
    const handlers = createAdvisorRuntimeHandlers(fetchImpl)
    await expect(handlers['metrora:advisorProbe']('llama-server', { port: 70000 })).resolves.toMatchObject({ ok: false, error: { kind: 'validation' } })
    await expect(handlers['metrora:advisorProbe']('llama-server', { port: '9090' })).resolves.toMatchObject({ ok: false, error: { kind: 'validation' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
