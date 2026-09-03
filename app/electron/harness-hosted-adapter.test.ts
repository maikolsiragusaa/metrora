// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

import { MetroraHostedLlmAdapter, hostedProviderRoute, probeHostedProvider } from './harness-hosted-adapter.mjs'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

describe('Metrora hosted DSH adapter', () => {
  it('discovers models through the configured provider without exposing credentials', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return jsonResponse({ data: [{ id: 'gpt-5', reasoning_efforts: ['min', 'medium', 'high'] }] })
    }) as typeof fetch
    const result = await probeHostedProvider('openai', async () => 'secret-value', fetchImpl)
    expect(result).toMatchObject({ provider: 'openai', available: true, models: [{ id: 'gpt-5', reasoningEfforts: ['min', 'medium', 'high'] }] })
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/models')
    expect(String(calls[0]?.init?.headers)).not.toContain('secret-value')
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })

  it('preserves native OpenAI tool-call IDs and translates reasoning into DSH blocks', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response([
        'data: {"choices":[{"delta":{"reasoning_content":"checking "}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"openai-native-9","function":{"name":"read","arguments":"{\\"file_path\\":\\"README.md\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const adapter = new MetroraHostedLlmAdapter({ fetchImpl, readCredential: async () => 'secret-value' })
    const options: GenerateOptions = {
      provider: hostedProviderRoute('openai'),
      model: 'gpt-5',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Read the file.' }], source: { kind: 'user' } })],
      tools: [{ name: 'read', description: 'Read a Workspace file.', parameters: { type: 'object' } }],
      reasoningEffort: ReasoningEffortId('high'),
    }
    const chunks = await collect(adapter.stream(options))
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reasoning-delta', text: 'checking ' }),
      expect.objectContaining({ type: 'tool-call-delta', id: 'openai-native-9', name: 'read' }),
      expect.objectContaining({ type: 'finish', reason: { kind: 'tool-calls' } }),
    ]))
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(body.model).toBe('gpt-5')
    expect(body.reasoning_effort).toBe('high')
    expect(JSON.stringify(body)).not.toContain('secret-value')
  })

  it('round-trips Gemini function calls and results with the native call identity', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      const body = calls.length === 1
        ? 'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"read","args":{"path":"README.md"},"id":"gemini-native-1"}}]}}]}\n\n'
        : 'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"The file was read successfully."}]}}]}\n\n'
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const callId = ToolCallId('gemini-native-1')
    const adapter = new MetroraHostedLlmAdapter({ fetchImpl, readCredential: async () => 'secret-value' })
    const options: GenerateOptions = {
      provider: hostedProviderRoute('gemini'),
      model: 'gemini-2.5-flash',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'Read the file.' }], source: { kind: 'user' } }),
        createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"README.md"}' }], source: { provider: hostedProviderRoute('gemini'), model: 'gemini-2.5-flash' } }),
        createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'file contents' }] }),
      ],
      tools: [{ name: 'read', description: 'Read a Workspace file.', parameters: { type: 'object' } }],
    }
    const initial = { ...options, messages: [options.messages[0]!] }
    const chunks = await collect(adapter.stream(initial))
    expect(chunks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tool-call-delta', id: 'gemini-native-1', name: 'read' })]))
    expect(calls).toHaveLength(1)

    const second = await collect(adapter.stream({ ...options, messages: [...options.messages] }))
    expect(second).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text-delta', text: 'The file was read successfully.' })]))
    expect(calls).toHaveLength(2)
    const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>
    const contents = body.contents as Array<Record<string, unknown>>
    expect(contents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'read', args: { path: 'README.md' }, id: 'gemini-native-1' } }] })
    expect(contents[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'read', response: { output: 'file contents' }, id: 'gemini-native-1' } }] })
    expect(JSON.stringify(body)).not.toContain('secret-value')
  })

  it('bounds hosted probe responses', async () => {
    const result = await probeHostedProvider('openai', async () => 'secret-value', (async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 })) as typeof fetch)
    expect(result.available).toBe(false)
    expect(result.detail).toBe('The selected provider is unavailable.')
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })
})
