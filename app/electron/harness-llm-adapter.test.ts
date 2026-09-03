// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
  type ToolCallId,
} from '@deepseek-ai/dsh-llm'

import {
  harnessProviderRoute,
  METRORA_HARNESS_CONTEXT_WINDOW,
  MetroraLocalLlmAdapter,
} from './harness-llm-adapter.mjs'

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

describe('Metrora DSH provider-neutral adapter', () => {
  it('exposes pinned local routes, bounded context and retry policy', async () => {
    const adapter = new MetroraLocalLlmAdapter()

    expect(harnessProviderRoute('ollama')).toBe('metrora-local-ollama')
    expect(harnessProviderRoute('lmstudio')).toBe('metrora-local-lmstudio')
    expect(harnessProviderRoute('llama-server')).toBe('metrora-local-llama-server')
    expect(adapter.providerRetryPolicy(harnessProviderRoute('ollama'))).toMatchObject({
      mode: 'normal',
      maxRetries: 2,
      retryableCodes: ['RATE_LIMIT', 'SERVER'],
    })
    await expect(adapter.resolveModel(harnessProviderRoute('ollama'), 'qwen3:8b')).resolves.toMatchObject({
      provider: 'metrora-local-ollama',
      id: 'qwen3:8b',
      context: { contextWindow: METRORA_HARNESS_CONTEXT_WINDOW },
    })
  })

  it('maps durable DSH messages and native tool calls through the Ollama wire contract', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return streamedResponse([
        JSON.stringify({ message: { tool_calls: [{ function: { name: 'get_overview_snapshot', arguments: '{}' } }] }, done: true }) + '\n',
      ])
    }) as typeof fetch
    const adapter = new MetroraLocalLlmAdapter({ fetchImpl })
    const route = harnessProviderRoute('ollama')
    const callId = 'call-1' as ToolCallId
    const options: GenerateOptions = {
      provider: route,
      model: 'qwen3:8b',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'Read the selected overview.' }], source: { kind: 'user' } }),
        createAssistantMessage({
          content: [{ type: 'tool-call', id: callId, name: 'get_overview_snapshot', arguments: '{}' }],
          source: { provider: route, model: 'qwen3:8b' },
        }),
        createToolResultMessage({ callId, content: [{ type: 'text', text: '{"status":"fresh"}' }], isError: false }),
      ],
      tools: [{ name: 'get_overview_snapshot', description: 'Read the canonical overview.', parameters: { type: 'object' } }],
      signal: new AbortController().signal,
    }
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options)) chunks.push(chunk)

    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/chat')
    const body = JSON.parse(String(calls[0]?.init?.body)) as { messages: Array<Record<string, unknown>>; tools: unknown[] }
    expect(body.messages).toEqual([
      { role: 'user', content: 'Read the selected overview.' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: callId, type: 'function', function: { name: 'get_overview_snapshot', arguments: '{}' } }],
      },
      { role: 'tool', content: '{"status":"fresh"}', tool_call_id: callId },
    ])
    expect(body.tools).toEqual([{
      type: 'function',
      function: { name: 'get_overview_snapshot', description: 'Read the canonical overview.', parameters: { type: 'object' } },
    }])
    expect(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })
})
