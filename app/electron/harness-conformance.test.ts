// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type ResolvedRetryPolicy, type StreamChunk, type ToolCallId } from '@deepseek-ai/dsh-llm'

import { verifyToolCapableModel, verifyToolCapableModelWithToolFailure } from './harness-conformance.mjs'

function finalAnswer(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function nonceCall(nonce: string): StreamChunk[] {
  const argumentsText = JSON.stringify({ nonce })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'native-conformance-call' as ToolCallId, name: 'metrora_conformance_nonce', argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'native-conformance-call' as ToolCallId, name: 'metrora_conformance_nonce', arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ConformanceAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly scripted: (request: GenerateOptions, index: number) => StreamChunk[]) { super() }
  providerInfo(provider: string): LlmProviderInfo { return { id: provider, name: 'Conformance test adapter' } }
  providerRetryPolicy(): ResolvedRetryPolicy { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }
  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> { return [] }
  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 16_384 }, reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } } }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    yield* this.scripted(request, this.requests.length)
  }
}

function returnedNonce(request: GenerateOptions): string | undefined {
  const result = request.messages
    .find(message => message.source.kind === 'tool')
    ?.content
    .find(block => block.type === 'tool-result')
  const text = result?.type === 'tool-result'
    ? result.content.find(block => block.type === 'text')
      ?? result.content.flatMap(block => block.type === 'tool-result' ? block.content : []).find(block => block.type === 'text')
    : undefined
  return text?.type === 'text'
    ? text.text.match(/nonce verified: (metrora-[A-Za-z0-9-]+)/u)?.[1]
    : undefined
}

describe('exact model conformance', () => {
  it('requires a native Tool call, executes its validated nonce, and synthesizes on the same route', async () => {
    // Keep this fixture deterministic with respect to the nonce embedded in
    // the request text; the production verifier generates that nonce itself.
    const adapter = new ConformanceAdapter((request, index) => index === 1
      ? nonceCall((request.messages.find(message => message.source.kind === 'user')?.content.find(block => block.type === 'text')?.text.match(/nonce (metrora-[A-Za-z0-9-]+)/u)?.[1]) ?? 'missing')
      : finalAnswer(returnedNonce(request) ? `Round trip complete for ${returnedNonce(request)}.` : 'Missing Tool result.'))
    const result = await verifyToolCapableModel({ adapter, provider: 'metrora-local-ollama', model: 'qwen2.5-coder', reasoningEffort: 'high', routeFingerprint: 'http://127.0.0.1:8080' })
    expect(result.state, JSON.stringify(result)).toBe('verified')
    expect(result.toolCalling).toBe('verified')
    expect(result.fingerprint).toContain('qwen2.5-coder')
    expect(adapter.requests).toHaveLength(2)
    const second = adapter.requests[1]!
    expect(second.provider).toBe('metrora-local-ollama')
    expect(second.model).toBe('qwen2.5-coder')
    expect(second.reasoningEffort).toEqual(ReasoningEffortId('high'))
    expect(second.messages.some(message => message.source.kind === 'tool')).toBe(true)
  })

  it('reports chat-only models as Limited and invalid native arguments as failed conformance', async () => {
    const chatOnly = new ConformanceAdapter(() => finalAnswer('ordinary answer'))
    await expect(verifyToolCapableModel({ adapter: chatOnly, provider: 'metrora-local-lmstudio', model: 'chat-only' })).resolves.toMatchObject({ state: 'limited', toolCalling: 'unsupported' })

    const invalid = new ConformanceAdapter(() => [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'invalid-call' as ToolCallId, name: 'metrora_conformance_nonce', argumentsDelta: '{}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'invalid-call' as ToolCallId, name: 'metrora_conformance_nonce', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
    await expect(verifyToolCapableModel({ adapter: invalid, provider: 'metrora-local-lmstudio', model: 'bad-tool-model' })).resolves.toMatchObject({ state: 'failed-conformance', toolCalling: 'unsupported' })
    expect(invalid.requests).toHaveLength(2)
  })

  it('never verifies when the native call reaches a failing DSH ToolRuntime body', async () => {
    const adapter = new ConformanceAdapter((request, index) => index === 1
      ? nonceCall((request.messages.find(message => message.source.kind === 'user')?.content.find(block => block.type === 'text')?.text.match(/nonce (metrora-[A-Za-z0-9-]+)/u)?.[1]) ?? 'missing')
      : finalAnswer('The Tool failed.'))
    const result = await verifyToolCapableModelWithToolFailure({ adapter, provider: 'metrora-local-ollama', model: 'runtime-failure' })
    expect(result.state).toBe('failed-conformance')
    expect(result.toolCalling).toBe('unsupported')
    expect(adapter.requests).toHaveLength(2)
  })
})
