import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
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

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

describe('Electron Advisor local runtime', () => {
  it('probes and chats through the exact selected port on a real loopback socket', async () => {
    const requests: Array<{ method: string; path: string; port: number }> = []
    const server = createServer(async (request, response) => {
      requests.push({ method: request.method ?? '', path: request.url ?? '', port: request.socket.localPort ?? 0 })
      response.setHeader('content-type', 'application/json')
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200)
        response.end(JSON.stringify({ status: 'ok' }))
        return
      }
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200)
        response.end(JSON.stringify({ data: [{ id: 'fixture-llama-model', object: 'model' }] }))
        return
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const body = JSON.parse(await readRequestBody(request)) as { model?: string }
        expect(body.model).toBe('fixture-llama-model')
        response.writeHead(200)
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'real loopback answer' } }] }))
        return
      }
      response.writeHead(404)
      response.end(JSON.stringify({ error: 'not found' }))
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The loopback test server did not expose a TCP address.')
    const port = (address as AddressInfo).port
    try {
      const handlers = createAdvisorRuntimeHandlers()
      const probe = await handlers['metrora:advisorProbe']('llama-server', { port })
      expect(probe).toMatchObject({
        ok: true,
        value: {
          runtime: 'llama-server',
          available: true,
          models: ['fixture-llama-model'],
          discoveryState: 'models-discovered',
        },
      })

      const chat = await handlers['metrora:advisorChat']('loopback-envelope', {
        model: 'fixture-llama-model',
        messages: [{ role: 'user', content: 'Say hello.' }],
        tools: [],
        stream: false,
      }, 'llama-server', { port })
      expect(chat).toMatchObject({ ok: true, value: { streamed: false, message: { content: 'real loopback answer' } } })
      expect(requests.map(request => `${request.method} ${request.path}`)).toEqual([
        'GET /health',
        'GET /v1/models',
        'POST /v1/chat/completions',
      ])
      expect(requests.every(request => request.port === port)).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

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

  it('validates and lowers the provider-neutral Tool choice for Ollama', async () => {
    let body: Record<string, unknown> | undefined
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return textOnlyResponse(JSON.stringify({ message: { content: 'bounded' } }) + '\n')
    }) as typeof fetch
    await expect(chatOllamaMain(fetchImpl, { ...payload, toolChoice: 'required' })).resolves.toMatchObject({ message: { content: 'bounded' } })
    expect(body?.tool_choice).toBe('required')
    expect(body).not.toHaveProperty('toolChoice')
    await expect(chatOllamaMain(fetchImpl, { ...payload, toolChoice: 'invalid' as never })).rejects.toThrow('tool choice is invalid')
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
})
