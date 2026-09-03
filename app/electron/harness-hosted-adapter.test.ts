// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

import { MetroraHostedLlmAdapter, hostedProviderRoute, hostedReasoningConfig, probeHostedProvider } from './harness-hosted-adapter.mjs'

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

  it('normalizes realistic model-list payloads across every hosted route', async () => {
    const fixtures: Record<string, { url: string; payload: unknown; model: string; reasoningEfforts?: string[] }> = {
      openai: { url: 'https://api.openai.com/v1/models', payload: { data: [{ id: 'gpt-5.1', reasoning_efforts: ['medium', 'high'] }] }, model: 'gpt-5.1', reasoningEfforts: ['medium', 'high'] },
      anthropic: { url: 'https://api.anthropic.com/v1/models', payload: { data: [{ id: 'claude-sonnet-4-6' }] }, model: 'claude-sonnet-4-6' },
      gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models', payload: { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }, model: 'gemini-2.5-flash' },
      openrouter: { url: 'https://openrouter.ai/api/v1/models', payload: { data: [{ id: 'openai/gpt-5.1', supported_parameters: ['tools'], reasoning_efforts: ['xhigh'] }] }, model: 'openai/gpt-5.1', reasoningEfforts: ['xhigh'] },
      'opencode-zen': { url: 'https://opencode.ai/zen/v1/models', payload: { data: [{ id: 'opencode/zenith', reasoning_efforts: ['vendor-tier-2'] }] }, model: 'opencode/zenith', reasoningEfforts: ['vendor-tier-2'] },
    }

    for (const [provider, fixture] of Object.entries(fixtures)) {
      const calls: string[] = []
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(String(input))
        return jsonResponse(fixture.payload)
      }) as typeof fetch
      const result = await probeHostedProvider(provider as Parameters<typeof probeHostedProvider>[0], async () => 'secret-value', fetchImpl)
      expect(calls).toEqual([fixture.url])
      expect(result).toMatchObject({ available: true, provider, models: [{ id: fixture.model }] })
      if (fixture.reasoningEfforts) expect(result.models[0]?.reasoningEfforts).toEqual(fixture.reasoningEfforts)
    }
  })

  it('keeps provider reasoning IDs exact at the wire boundary', () => {
    expect(hostedReasoningConfig('openai', 'high')).toEqual({ reasoning_effort: 'high' })
    expect(hostedReasoningConfig('openrouter', 'xhigh')).toEqual({ reasoning_effort: 'xhigh' })
    expect(hostedReasoningConfig('opencode-zen', 'low', 'deepseek-v4-flash')).toEqual({ reasoning_effort: 'low' })
    expect(hostedReasoningConfig('anthropic', 'budget-4096')).toEqual({ thinking: { type: 'enabled', budget_tokens: 4096 } })
    expect(hostedReasoningConfig('gemini', 'budget-4096')).toEqual({ thinkingConfig: { thinkingBudget: 4096 } })
    expect(hostedReasoningConfig('opencode-zen', 'high', 'gemini-3-flash')).toEqual({ thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } })
    expect(hostedReasoningConfig('opencode-zen', 'high', 'claude-sonnet-4-6')).toEqual({ thinking: { type: 'adaptive' }, effort: 'high' })
    expect(hostedReasoningConfig('opencode-zen', 'high', 'claude-opus-4-7')).toEqual({ thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' })
    expect(hostedReasoningConfig('opencode-zen', 'low', 'claude-opus-4-5')).toEqual({ thinking: { type: 'enabled', budget_tokens: 16_000 } })
    expect(() => hostedReasoningConfig('opencode-zen', 'high', 'qwen3.5-plus')).toThrow('no reviewed provider wire translation')
    expect(() => hostedReasoningConfig('anthropic', 'high')).toThrow('has no supported provider wire translation')
    expect(() => hostedReasoningConfig('gemini', 'none')).toThrow('has no supported provider wire translation')
    expect(() => hostedReasoningConfig('anthropic', 'vendor-special')).toThrow('has no supported provider wire translation')
  })

  it('uses the reviewed OpenCode Zen transport for each selected model instead of assuming one universal endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      const url = String(input)
      const body = url.endsWith('/responses')
        ? ['data: {"type":"response.reasoning_summary_text.delta","delta":"checking "}\n\n', 'data: {"type":"response.output_text.delta","delta":"done"}\n\n', 'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n'].join('')
        : url.includes('/models/')
          ? ['data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"checking "},{"text":"done"}]}}]}\n\n'].join('')
        : ['data: {"choices":[{"delta":{"reasoning_content":"checking "}}]}\n\n', 'data: {"choices":[{"delta":{"content":"done"}}]}\n\n', 'data: [DONE]\n\n'].join('')
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const adapter = new MetroraHostedLlmAdapter({ fetchImpl, readCredential: async () => 'secret-value' })
    const base = { messages: [createUserMessage({ content: [{ type: 'text', text: 'Check the route.' }], source: { kind: 'user' } })] }

    const gptChunks = await collect(adapter.stream({ provider: hostedProviderRoute('opencode-zen'), model: 'gpt-5.6-sol', ...base, reasoningEffort: ReasoningEffortId('high') }))
    expect(calls[0]?.url).toBe('https://opencode.ai/zen/v1/responses')
    const gptBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(gptBody.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    expect(gptBody.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Check the route.' }] }])
    expect(gptChunks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reasoning-delta', text: 'checking ' }), expect.objectContaining({ type: 'text-delta', text: 'done' })]))

    await collect(adapter.stream({ provider: hostedProviderRoute('opencode-zen'), model: 'deepseek-v4-flash', ...base, reasoningEffort: ReasoningEffortId('low') }))
    expect(calls[1]?.url).toBe('https://opencode.ai/zen/v1/chat/completions')
    const deepSeekBody = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>
    expect(deepSeekBody.reasoning_effort).toBe('low')
    await collect(adapter.stream({ provider: hostedProviderRoute('opencode-zen'), model: 'gemini-3-flash', ...base, reasoningEffort: ReasoningEffortId('high') }))
    expect(calls[2]?.url).toBe('https://opencode.ai/zen/v1/models/gemini-3-flash:streamGenerateContent?alt=sse')
    const geminiBody = JSON.parse(String(calls[2]?.init?.body)) as Record<string, any>
    expect(geminiBody.generationConfig).toEqual({ thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } })
    await collect(adapter.stream({ provider: hostedProviderRoute('opencode-zen'), model: 'claude-sonnet-4-6', ...base, reasoningEffort: ReasoningEffortId('high') }))
    expect(calls[3]?.url).toBe('https://opencode.ai/zen/v1/messages')
    const claudeBody = JSON.parse(String(calls[3]?.init?.body)) as Record<string, any>
    expect(claudeBody.thinking).toEqual({ type: 'adaptive' })
    expect(claudeBody.max_tokens).toBe(4096)
    expect(JSON.stringify(calls[0]?.init?.body)).not.toContain('secret-value')
  })

  it('writes the Anthropic thinking budget in the native request shape', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response('data: {"type":"message_stop"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const adapter = new MetroraHostedLlmAdapter({ fetchImpl, readCredential: async () => 'secret-value' })
    await collect(adapter.stream({
      provider: hostedProviderRoute('anthropic'),
      model: 'claude-sonnet-4-6',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Explain the change.' }], source: { kind: 'user' } })],
      reasoningEffort: ReasoningEffortId('budget-4096'),
    }))
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages')
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(JSON.stringify(body)).not.toContain('secret-value')
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
