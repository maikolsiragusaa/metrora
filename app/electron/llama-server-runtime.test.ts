import { describe, expect, it } from 'vitest'
import { chatLlamaServerMain, probeLlamaServerMain, validateLlamaServerEndpoint } from './llama-server-runtime'
import type { AdvisorRuntimeChatPayload } from './advisor-runtime'

function payload(stream: boolean, model = 'fixture-model'): AdvisorRuntimeChatPayload {
  return { model, messages: [{ role: 'user', content: 'hello' }], tools: [], stream }
}

describe('llama-server local runtime', () => {
  it('accepts only explicit loopback HTTP endpoints', () => {
    expect(validateLlamaServerEndpoint()).toBe('http://127.0.0.1:8080')
    expect(validateLlamaServerEndpoint('http://localhost:9090')).toBe('http://localhost:9090')
    expect(validateLlamaServerEndpoint('http://[::1]:8080')).toBe('http://[::1]:8080')
    for (const endpoint of ['https://127.0.0.1:8080', 'http://192.168.1.2:8080', 'http://127.0.0.1:8080/v1', 'http://user:pass@127.0.0.1:8080', 'http://127.0.0.1:8080?token=x']) {
      expect(() => validateLlamaServerEndpoint(endpoint)).toThrow()
    }
  })

  it('probes health and model metadata on the fixed default endpoint', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      return new Response(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'fixture-model' }, { id: 42 }] }), { status: 200 })
    }
    const result = await probeLlamaServerMain(fetchImpl)
    expect(result).toMatchObject({ runtime: 'llama-server', available: true, models: ['fixture-model'], discoveryState: 'models-discovered' })
    expect(result.capabilities[0]).toMatchObject({ modelId: 'fixture-model', streaming: 'supported', toolCall: 'unknown' })
    expect(calls).toEqual(['http://127.0.0.1:8080/health', 'http://127.0.0.1:8080/v1/models'])
  })

  it('projects upstream path model ids into safe renderer handles and routes chat through the trusted map', async () => {
    const rawIds = [
      'C:\\Users\\sirag\\models\\windows.gguf',
      '/home/sirag/models/unix.gguf',
      '../models/relative.gguf',
      'alias-model',
    ]
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: rawIds.map(id => ({ id })) }), { status: 200 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'routed response' } }] }), { status: 200 })
    }

    const result = await probeLlamaServerMain(fetchImpl)
    expect(result.models).toHaveLength(rawIds.length)
    expect(result.models).not.toEqual(expect.arrayContaining(rawIds))
    expect(JSON.stringify(result)).not.toContain('C:\\Users\\sirag')
    expect(JSON.stringify(result)).not.toContain('/home/sirag')
    expect(JSON.stringify(result)).not.toContain('../models')
    expect(result.models).toContain('alias-model')
    expect(result.capabilities.every(capability => capability.toolCall === 'unknown')).toBe(true)
    expect(result.capabilities.map(capability => capability.modelId)).toEqual(result.models)
    expect(Object.values(result.modelLabels)).toEqual(['windows.gguf', 'unix.gguf', 'relative.gguf', 'alias-model'])
    expect(Object.values(result.modelLabels).join('|')).not.toMatch(/[\\/]/u)

    const selectedHandle = result.models[0]!
    await chatLlamaServerMain(fetchImpl, payload(false, selectedHandle))
    const chatCall = calls.find(call => call.url.endsWith('/v1/chat/completions'))
    expect(chatCall).toBeDefined()
    expect(JSON.parse(String(chatCall?.init?.body))).toMatchObject({ model: rawIds[0], stream: false })
  })

  it('preserves normal chat responses and real SSE deltas/tool-call fragments', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      if (payloadFrom(init).stream) {
        const body = [
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hello' } }] }),
          'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'get_', arguments: '{"x":' } }] } }] }),
          'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'overview', arguments: '1}' } }] } }] }),
          'data: [DONE]',
          '',
        ].join('\n')
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'normal response' } }] }), { status: 200 })
    }
    const normal = await chatLlamaServerMain(fetchImpl, payload(false))
    expect(normal).toEqual({ message: { content: 'normal response', tool_calls: [] }, streamed: false })
    const deltas: string[] = []
    const streamed = await chatLlamaServerMain(fetchImpl, payload(true), undefined, delta => deltas.push(delta))
    expect(streamed).toEqual({ message: { content: 'hello', tool_calls: [{ function: { name: 'overview', arguments: '{"x":1}' } }] }, streamed: true })
    expect(deltas).toEqual(['hello'])
    expect(calls.every(call => call.url === 'http://127.0.0.1:8080/v1/chat/completions' && call.init?.redirect === 'error')).toBe(true)
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ model: 'fixture-model', stream: false, messages: [{ role: 'user', content: 'hello' }] })
  })

  it('fails closed on malformed streams and propagates cancellation', async () => {
    const malformedFetch: typeof fetch = async () => new Response('data: {bad}\n\ndata: [DONE]\n', { status: 200 })
    await expect(chatLlamaServerMain(malformedFetch, payload(true))).rejects.toThrow(/no valid messages|malformed/u)

    const controller = new AbortController()
    const pendingFetch: typeof fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
      else init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    const pending = chatLlamaServerMain(pendingFetch, payload(false), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    const probeController = new AbortController()
    probeController.abort()
    await expect(probeLlamaServerMain(pendingFetch, probeController.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

function payloadFrom(init: RequestInit | undefined): { stream?: boolean } {
  try { return JSON.parse(String(init?.body)) as { stream?: boolean } } catch { return {} }
}
