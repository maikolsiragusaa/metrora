import { describe, expect, it } from 'vitest'

import { chatLMStudioMain, probeLMStudioMain } from './lmstudio-runtime'
import type { AdvisorRuntimeChatPayload } from './advisor-runtime'

const payload: AdvisorRuntimeChatPayload = {
  model: 'synthetic-model',
  messages: [{ role: 'user', content: 'Use the evidence tool.' }],
  tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
  stream: false,
}
function streamedResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const LOOPBACK_MODELS_URL = 'http://127.0.0.1:1234/api/v1/models'
const LOOPBACK_CHAT_URL = 'http://127.0.0.1:1234/v1/chat/completions'
const EXTERNAL_REDIRECT_URL = 'https://external.example.invalid/escape'
type FetchCall = { url: string; init?: RequestInit }
function redirectingFetch(status: number, calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (init?.redirect !== 'error') {
      calls.push({ url: EXTERNAL_REDIRECT_URL, init })
      return new Response(JSON.stringify({ models: [{ type: 'llm', key: 'escaped-model' }] }), { status: 200 })
    }
    return new Response(null, { status, headers: { location: EXTERNAL_REDIRECT_URL } })
  }) as typeof fetch
}
describe('Electron LM Studio local runtime', () => {
  it('probes the fixed loopback v1 model endpoint and creates unknown tool profiles', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ models: [
        { type: 'llm', key: 'qwen/qwen3-8b' },
        { type: 'embedding', key: 'nomic-embed' },
        { type: 'llm', key: 'qwen/qwen3-8b' },
      ] }), { status: 200 })
    }) as typeof fetch
    await expect(probeLMStudioMain(fetchImpl)).resolves.toMatchObject({
      runtime: 'lmstudio',
      available: true,
      models: ['qwen/qwen3-8b'],
      discoveryState: 'models-discovered',
      capabilities: [{ modelId: 'qwen/qwen3-8b', toolCall: 'unknown', streaming: 'supported' }],
    })
    expect(calls).toEqual(['http://127.0.0.1:1234/api/v1/models'])
  })

  it('normalizes OpenAI-compatible messages and never sends renderer-controlled URLs or credentials', async () => {
    const request: { current: { url: string; init?: RequestInit } | null } = { current: null }
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request.current = { url: String(input), init }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Tool result ready.', tool_calls: [] } }] }), { status: 200 })
    }) as typeof fetch
    const result = await chatLMStudioMain(fetchImpl, {
      ...payload,
      messages: [
        { role: 'user', content: 'Use the evidence tool.' },
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{}' } }] },
        { role: 'tool', content: '{"ok":true}', tool_name: 'get_spend_snapshot' },
      ],
    })
    expect(result).toMatchObject({ message: { content: 'Tool result ready.' }, streamed: false })
    expect(request.current?.url).toBe('http://127.0.0.1:1234/v1/chat/completions')
    const body = JSON.parse(String(request.current?.init?.body)) as { messages: Array<Record<string, unknown>> }
    expect(body.messages[1]?.tool_calls).toEqual([{ id: 'metrora_call_0', type: 'function', function: { name: 'get_spend_snapshot', arguments: '{}' } }])
    expect(body.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'metrora_call_0' })
    expect(request.current?.init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(request.current?.init?.redirect).toBe('error')
  })

  it.each([301, 302, 307, 308])('rejects loopback redirects for discovery, chat, and streaming (%s)', async status => {
    const probeCalls: FetchCall[] = []
    const probe = await probeLMStudioMain(redirectingFetch(status, probeCalls))
    expect(probe).toMatchObject({ available: false, detail: 'Local LM Studio server returned HTTP ' + status + '.' })
    expect(probe.detail).not.toContain(EXTERNAL_REDIRECT_URL)
    expect(probeCalls.map(call => call.url)).toEqual([LOOPBACK_MODELS_URL])
    expect(probeCalls[0]?.init?.redirect).toBe('error')

    const chatCalls: FetchCall[] = []
    await expect(chatLMStudioMain(redirectingFetch(status, chatCalls), payload)).rejects.toThrow('HTTP ' + status)
    expect(chatCalls.map(call => call.url)).toEqual([LOOPBACK_CHAT_URL])
    expect(chatCalls[0]?.init?.redirect).toBe('error')

    const streamCalls: FetchCall[] = []
    await expect(chatLMStudioMain(redirectingFetch(status, streamCalls), { ...payload, stream: true })).rejects.toThrow('HTTP ' + status)
    expect(streamCalls.map(call => call.url)).toEqual([LOOPBACK_CHAT_URL])
    expect(streamCalls[0]?.init?.redirect).toBe('error')
  })

  it('parses bounded SSE content and streamed tool-call fragments', async () => {
    const fetchImpl = (async () => streamedResponse([
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Verified ' } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'get_spend_snapshot', arguments: '{' } }] } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'context.', tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] }) + '\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch
    await expect(chatLMStudioMain(fetchImpl, { ...payload, stream: true })).resolves.toEqual({
      message: { content: 'Verified context.', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: '{}' } }] },
      streamed: true,
    })
  })

  it('rejects malformed request tool calls and does not probe after cancellation', async () => {
    await expect(chatLMStudioMain(async () => new Response('{}'), { ...payload, messages: [{ role: 'assistant', content: '', tool_calls: 'invalid' }] as Array<Record<string, unknown>> })).rejects.toThrow('tool_calls')
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    await expect(probeLMStudioMain((async () => { calls += 1; return new Response('{}') }) as typeof fetch, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(0)
  })

  it('fails closed on malformed streams and propagates cancellation', async () => {
    const malformed = (async () => streamedResponse(Array.from({ length: 17 }, () => 'data: {broken\n\n'))) as typeof fetch
    await expect(chatLMStudioMain(malformed, { ...payload, stream: true })).rejects.toThrow('malformed')

    const controller = new AbortController()
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })) as typeof fetch
    const pending = chatLMStudioMain(fetchImpl, payload, controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
