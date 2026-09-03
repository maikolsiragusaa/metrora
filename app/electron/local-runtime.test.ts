// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  chatLlamaServerMain,
  chatOllamaMain,
  llamaServerEndpointFromPort,
  probeLlamaServerMain,
  probeOllamaMain,
  validateLlamaServerEndpoint,
  type LocalRuntimeChatPayload,
} from './local-runtime.mjs'

const payload: LocalRuntimeChatPayload = {
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Inspect the workspace.' }],
  tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }],
  stream: true,
  reasoningEffort: 'high',
}

function streamedResponse(lines: string[], contentType = 'text/event-stream'): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('Metrora local provider adapter', () => {
  it('uses the fixed Ollama loopback probe and preserves provider-native IDs and reasoning', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (String(input).endsWith('/api/tags')) return jsonResponse({ models: [{ name: 'llama3.2', reasoning_efforts: ['low', 'high', 'unsupported', 'high'] }] })
      return streamedResponse([
        '{"message":{"thinking":"checking "}}\n',
        '{"message":{"content":"done","tool_calls":[{"id":"native-call-7","function":{"name":"read","arguments":"{\\"file_path\\":\\"README.md\\"}"}}]}}\n',
        '{"done":true}\n',
      ], 'application/x-ndjson')
    }) as typeof fetch

    await expect(probeOllamaMain(fetchImpl)).resolves.toMatchObject({ available: true, models: ['llama3.2'], capabilities: [{ modelId: 'llama3.2', reasoningEfforts: ['low', 'high'] }] })
    const result = await chatOllamaMain(fetchImpl, payload)
    expect(result.message).toMatchObject({ content: 'done', reasoning: 'checking ' })
    expect(result.message.tool_calls).toEqual([{ id: 'native-call-7', name: 'read', arguments: '{"file_path":"README.md"}' }])
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/tags')
    expect(calls[1]?.url).toBe('http://127.0.0.1:11434/api/chat')
    const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>
    expect(body.model).toBe('llama3.2')
    expect(body.think).toBe('high')
  })

  it('uses one validated custom loopback endpoint for llama.cpp discovery and actual chat', async () => {
    expect(llamaServerEndpointFromPort(19_876)).toBe('http://127.0.0.1:19876')
    expect(validateLlamaServerEndpoint('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(() => llamaServerEndpointFromPort(0)).toThrow('between 1 and 65535')
    expect(() => validateLlamaServerEndpoint('https://example.com:19876')).toThrow('loopback-only')

    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/v1/models')) return jsonResponse({ data: [{ id: 'qwen2.5-coder' }] })
      return streamedResponse(['data: {"choices":[{"delta":{"content":"custom-port answer"}}]}\n\ndata: [DONE]\n\n'])
    }) as typeof fetch
    const endpoint = llamaServerEndpointFromPort(19_876)
    await expect(probeLlamaServerMain(fetchImpl, undefined, endpoint)).resolves.toMatchObject({ endpoint, models: ['qwen2.5-coder'] })
    const result = await chatLlamaServerMain(fetchImpl, { ...payload, model: 'qwen2.5-coder' }, undefined, undefined, undefined, endpoint)
    expect(result.message.content).toBe('custom-port answer')
    expect(calls).toEqual([
      'http://127.0.0.1:19876/health',
      'http://127.0.0.1:19876/v1/models',
      'http://127.0.0.1:19876/v1/chat/completions',
    ])
  })

  it('fails closed on oversized provider responses and propagates cancellation before network access', async () => {
    const oversized = new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 })
    const fetchImpl = (async () => oversized) as typeof fetch
    await expect(chatOllamaMain(fetchImpl, { ...payload, tools: [], stream: false })).rejects.toThrow('safety limit')

    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const noNetwork = (async () => { calls += 1; return jsonResponse({}) }) as typeof fetch
    await expect(probeOllamaMain(noNetwork, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(0)
  })
})
