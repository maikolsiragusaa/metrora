import type {
  ContentBlock,
  GenerateOptions,
  LlmAdapter as LlmAdapterType,
  LlmModelInfo,
  LlmReasoningEffortInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  Message,
  ResolvedRetryPolicy,
  StreamChunk,
  ToolCallId,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

import { chatLMStudioMain, chatLlamaServerMain, chatOllamaMain, llamaServerEndpointFromPort } from './local-runtime.mjs'
import { hostedProviderFromRoute, hostedProviderRoute, MetroraHostedLlmAdapter } from './harness-hosted-adapter.mjs'
import type { HarnessHostedProvider, HarnessReasoningEffort, HarnessRuntimeId } from './harness-runtime-types.js'

type FetchLike = typeof fetch
type TextDelta = (event: { sessionId?: string; text: string }) => void
type ReasoningDelta = (event: { sessionId?: string; text: string }) => void

const LOCAL_ROUTES: Record<HarnessRuntimeId, string> = {
  ollama: 'metrora-local-ollama',
  lmstudio: 'metrora-local-lmstudio',
  'llama-server': 'metrora-local-llama-server',
}
const LOCAL_LABELS: Record<HarnessRuntimeId, string> = { ollama: 'Ollama · local', lmstudio: 'LM Studio · local', 'llama-server': 'llama.cpp · local' }
export const METRORA_HARNESS_CONTEXT_WINDOW = 32_768
const RETRY_POLICY: ResolvedRetryPolicy = { mode: 'normal', maxRetries: 2, retryableCodes: Object.freeze(['RATE_LIMIT', 'SERVER']), initialDelayMs: 250, maxDelayMs: 2_000, jitterRatio: 0.1 }

type ReasoningEffortResolver = (provider: string, model: string) => readonly HarnessReasoningEffort[] | undefined

function routeFor(provider: string): HarnessRuntimeId {
  const runtime = (Object.keys(LOCAL_ROUTES) as HarnessRuntimeId[]).find(candidate => LOCAL_ROUTES[candidate] === provider)
  if (!runtime) throw new Error('Unknown Metrora local Harness provider route.')
  return runtime
}
function validModel(model: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u.test(model) }
function textFromBlocks(blocks: readonly ContentBlock[]): string { return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
function resultText(blocks: readonly ContentBlock[]): string { return blocks.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('') }
function providerMessages(messages: readonly Message[]): Array<Record<string, unknown>> {
  return messages.map(message => {
    if (message.role === 'system') return { role: 'system', content: textFromBlocks(message.content) }
    if (message.source.kind === 'tool') return { role: 'tool', content: resultText(message.content), tool_call_id: message.source.callId }
    if (message.role === 'assistant') {
      const calls = message.content.flatMap((block, index) => block.type === 'tool-call' ? [{ id: block.id || `local-adapter-call-${index + 1}`, type: 'function', function: { name: block.name, arguments: block.arguments } }] : [])
      return { role: 'assistant', content: textFromBlocks(message.content), ...(calls.length ? { tool_calls: calls } : {}) }
    }
    return { role: 'user', content: textFromBlocks(message.content) }
  })
}
function providerTools(tools: readonly ToolSchema[] | undefined): Array<Record<string, unknown>> { return (tools ?? []).slice(0, 32).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) }
function failure(error: unknown): unknown {
  if (error instanceof Error && error.name === 'AbortError') return error
  const status = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : undefined
  if (status === 429) return new LlmError('The local provider rate-limited the request.', 'RATE_LIMIT')
  if (status !== undefined && status >= 500) return new LlmError('The local provider returned a temporary server error.', 'SERVER')
  return error
}

/** One DSH LlmAdapter covering every local route. Hosted routes are delegated
 * to the protected-transport adapter from `harness-hosted-adapter.mts`; both
 * are registered in the same DSH LlmRuntime and therefore share Session,
 * Agent, retry, Tool and reasoning semantics. */
export class MetroraLlmAdapter extends LlmAdapter {
  private readonly fetchImpl: FetchLike
  private readonly llamaPort: () => number
  private readonly hosted?: MetroraHostedLlmAdapter
  private readonly resolveReasoningEfforts?: ReasoningEffortResolver
  private readonly onTextDelta?: TextDelta
  private readonly onReasoningDelta?: ReasoningDelta

  constructor(options: { fetchImpl?: FetchLike; llamaPort?: () => number; hosted?: MetroraHostedLlmAdapter; onTextDelta?: TextDelta; onReasoningDelta?: ReasoningDelta; resolveReasoningEfforts?: ReasoningEffortResolver } = {}) {
    super(); this.fetchImpl = options.fetchImpl ?? fetch; this.llamaPort = options.llamaPort ?? (() => 8080); this.hosted = options.hosted; this.onTextDelta = options.onTextDelta; this.onReasoningDelta = options.onReasoningDelta; this.resolveReasoningEfforts = options.resolveReasoningEfforts
  }
  providerInfo(provider: string): LlmProviderInfo {
    const runtime = (Object.keys(LOCAL_ROUTES) as HarnessRuntimeId[]).find(candidate => LOCAL_ROUTES[candidate] === provider)
    if (runtime) return { id: provider, name: LOCAL_LABELS[runtime] }
    return this.hosted?.providerInfo(provider) ?? { id: provider, name: hostedProviderFromRoute(provider) ?? 'Hosted provider' }
  }
  providerRetryPolicy(provider: string): ResolvedRetryPolicy { return (this.hosted && hostedProviderFromRoute(provider)) ? this.hosted.providerRetryPolicy(provider) : RETRY_POLICY }
  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> { return [] }
  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (!validModel(model)) throw new Error('Harness model is invalid.')
    if (this.hosted && hostedProviderFromRoute(provider)) return this.withReasoning(await this.hosted.resolveModel(provider, model), provider, model)
    routeFor(provider)
    return this.withReasoning({ provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: METRORA_HARNESS_CONTEXT_WINDOW } }, provider, model)
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.hosted && hostedProviderFromRoute(options.provider)) { yield* this.hosted.stream(options); return }
    const runtime = routeFor(options.provider)
    const payload = { model: options.model, messages: providerMessages(options.messages), tools: providerTools(options.tools), stream: true, reasoningEffort: options.reasoningEffort ?? null }
    const text = (value: string) => this.onTextDelta?.({ sessionId: options.sessionId, text: value })
    const reasoning = (value: string) => this.onReasoningDelta?.({ sessionId: options.sessionId, text: value })
    try {
      const result = runtime === 'ollama'
        ? await chatOllamaMain(this.fetchImpl, payload, options.signal, text, reasoning)
        : runtime === 'lmstudio'
          ? await chatLMStudioMain(this.fetchImpl, payload, options.signal, text, reasoning)
          : await chatLlamaServerMain(this.fetchImpl, payload, options.signal, text, reasoning, llamaServerEndpointFromPort(this.llamaPort()))
      let index = 0
      if (result.message.reasoning) { yield { type: 'block-start', index, blockType: 'reasoning' }; yield { type: 'reasoning-delta', index, text: result.message.reasoning }; yield { type: 'block-end', index, block: { type: 'reasoning', text: result.message.reasoning } }; index += 1 }
      if (result.message.content) { yield { type: 'block-start', index, blockType: 'text' }; yield { type: 'text-delta', index, text: result.message.content }; yield { type: 'block-end', index, block: { type: 'text', text: result.message.content } }; index += 1 }
      for (const call of result.message.tool_calls) { yield { type: 'block-start', index, blockType: 'tool-call' }; yield { type: 'tool-call-delta', index, id: call.id as ToolCallId, name: call.name, argumentsDelta: call.arguments }; yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id as ToolCallId, name: call.name, arguments: call.arguments } }; index += 1 }
      if (result.usage) yield { type: 'usage', usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0, totalTokens: result.usage.totalTokens ?? 0 } }
      yield { type: 'finish', reason: result.message.tool_calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } }
    } catch (error) { throw failure(error) }
  }

  private withReasoning(info: LlmResolvedModelInfo, provider: string, model: string): LlmResolvedModelInfo {
    const efforts = this.resolveReasoningEfforts?.(provider, model)
    if (!efforts?.length) return info
    const unique = [...new Set(efforts)]
    const metadata: LlmReasoningEffortInfo[] = unique.map(effort => ({ id: ReasoningEffortId(effort), name: effort }))
    return { ...info, reasoning: { efforts: metadata } }
  }
}

export function harnessProviderRoute(runtime: HarnessRuntimeId): string { return LOCAL_ROUTES[runtime] }
export { hostedProviderRoute }
export type { LlmAdapterType }
