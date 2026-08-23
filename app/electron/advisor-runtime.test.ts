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
    })
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/tags')
  })

  it('reads NDJSON incrementally, caps content, and exposes deltas without waiting for text()', async () => {
    const fetchImpl = (async () => streamedResponse([
      '{"message":{"content":"Measured "}}',
      '\n{"message":{"content":"evidence."},"done":true}\n',
    ])) as typeof fetch
    const deltas: string[] = []
    const result = await chatOllamaMain(fetchImpl, payload, undefined, text => deltas.push(text))

    expect(result.streamed).toBe(true)
    expect(result.message.content).toBe('Measured evidence.')
    expect(deltas).toEqual(['Measured ', 'Measured evidence.'])
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
})
