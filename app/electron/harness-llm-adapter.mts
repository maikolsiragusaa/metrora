import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  Message,
  StreamChunk,
  ToolCallId,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'

import { chatLMStudioMain } from './lmstudio-runtime.js'
import { chatLlamaServerMain } from './llama-server-runtime.js'
import { chatOllamaMain, type AdvisorRuntimeChatPayload } from './advisor-runtime.js'
import type { HarnessRuntimeId } from './harness-runtime-types.js'

type FetchLike = typeof fetch
type TextDelta = (event: { sessionId?: string; text: string }) => void

const ROUTES: Record<HarnessRuntimeId, string> = {
  ollama: 'metrora-local-ollama',
  lmstudio: 'metrora-local-lmstudio',
  'llama-server': 'metrora-local-llama-server',
}

const PROVIDER_LABELS: Record<HarnessRuntimeId, string> = {
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
  'llama-server': 'llama-server (local)',
}

// DSH compaction needs an adapter-owned capacity even when a local endpoint
// does not expose one. This is an operational safety cap for replay and
// compaction, not a claim about every installed model's native context.
export const METRORA_HARNESS_CONTEXT_WINDOW = 32_768

const METRORA_LOCAL_RETRY_POLICY: ResolvedRetryPolicy = {
  mode: 'normal',
  maxRetries: 2,
  retryableCodes: Object.freeze(['RATE_LIMIT', 'SERVER']),
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.1,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function textFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function toolResultText(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool-result') return toolResultText(block.content)
    return JSON.stringify(block)
  }).join('')
}

function providerMessages(messages: readonly Message[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'system') {
      result.push({ role: 'system', content: textFromBlocks(message.content) })
      continue
    }
    if (message.source.kind === 'tool') {
      result.push({
        role: 'tool',
        content: toolResultText(message.content),
        tool_call_id: message.source.callId,
      })
      continue
    }
    if (message.role === 'assistant') {
      const toolCalls = message.content.flatMap((block, index) => block.type === 'tool-call'
        ? [{ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } }]
        : [])
      result.push({
        role: 'assistant',
        content: textFromBlocks(message.content),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    result.push({ role: 'user', content: textFromBlocks(message.content) })
  }
  return result
}

function providerTools(tools: readonly ToolSchema[] | undefined): Array<Record<string, unknown>> {
  return (tools ?? []).slice(0, 32).map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function modelFromCall(value: unknown, index: number): { id: ToolCallId; name: string; arguments: string } {
  const record = isRecord(value) ? value : {}
  const fn = isRecord(record.function) ? record.function : {}
  const name = typeof fn.name === 'string' && fn.name.trim() ? fn.name : 'unknown_tool'
  const rawArgs = fn.arguments
  const args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {})
  const rawId = typeof record.id === 'string' && record.id.trim() ? record.id : `metrora_call_${index + 1}`
  return { id: rawId as ToolCallId, name, arguments: args }
}

function routeFor(provider: string): HarnessRuntimeId {
  const match = (Object.keys(ROUTES) as HarnessRuntimeId[]).find(runtime => ROUTES[runtime] === provider)
  if (!match) throw new Error('Unknown Metrora local Harness provider route.')
  return match
}

function validModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u.test(model)
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { status?: unknown }).status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) return status
  const message = error instanceof Error ? error.message : ''
  const match = /HTTP (\d{3})/u.exec(message)
  return match ? Number(match[1]) : undefined
}

function providerFailure(error: unknown): unknown {
  if (error instanceof Error && error.name === 'AbortError') return error
  const status = errorStatus(error)
  if (status === 429) return new LlmError('Local provider rate-limited the request.', 'RATE_LIMIT', { status })
  if (status !== undefined && status >= 500) return new LlmError('Local provider returned a temporary server error.', 'SERVER', { status })
  return error
}

function messageChunks(message: { content: string; tool_calls?: Array<Record<string, unknown>> }): StreamChunk[] {
  const chunks: StreamChunk[] = []
  let index = 0
  if (message.content) {
    chunks.push({ type: 'block-start', index, blockType: 'text' })
    chunks.push({ type: 'text-delta', index, text: message.content })
    chunks.push({ type: 'block-end', index, block: { type: 'text', text: message.content } })
    index += 1
  }
  const calls = (message.tool_calls ?? []).map(modelFromCall)
  for (const call of calls) {
    chunks.push({ type: 'block-start', index, blockType: 'tool-call' })
    chunks.push({ type: 'tool-call-delta', index, id: call.id, name: call.name, argumentsDelta: call.arguments })
    chunks.push({ type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments } })
    index += 1
  }
  chunks.push({ type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } })
  return chunks
}

/**
 * Provider-neutral DSH adapter over the three existing loopback runtimes.
 * The wire parsers remain in their existing runtime modules; DSH owns the
 * message/session/tool lifecycle above this seam.
 */
export class MetroraLocalLlmAdapter extends LlmAdapter {
  private readonly fetchImpl: FetchLike
  private readonly onTextDelta?: TextDelta

  constructor(options: { fetchImpl?: FetchLike; onTextDelta?: TextDelta } = {}) {
    super()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.onTextDelta = options.onTextDelta
  }

  providerInfo(provider: string): LlmProviderInfo {
    const runtime = routeFor(provider)
    return { id: provider, name: PROVIDER_LABELS[runtime] }
  }

  providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return METRORA_LOCAL_RETRY_POLICY
  }

  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    // Discovery stays owned by the existing Metrora runtime probes. DSH model
    // catalog membership is advisory, so an exact selected id remains valid.
    return []
  }

  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (!routeFor(provider) || !validModel(model)) throw new Error('Local Harness model is invalid.')
    return {
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      context: { contextWindow: METRORA_HARNESS_CONTEXT_WINDOW },
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!validModel(options.model)) throw new Error('Local Harness model is invalid.')
    const runtime = routeFor(options.provider)
    const payload: AdvisorRuntimeChatPayload = {
      model: options.model,
      messages: providerMessages(options.messages),
      tools: providerTools(options.tools),
      stream: true,
    }
    const onDelta = (text: string) => this.onTextDelta?.({ sessionId: options.sessionId as string | undefined, text })
    let value: Awaited<ReturnType<typeof chatOllamaMain>>
    try {
      value = runtime === 'lmstudio'
        ? await chatLMStudioMain(this.fetchImpl, payload, options.signal, onDelta)
        : runtime === 'llama-server'
          ? await chatLlamaServerMain(this.fetchImpl, payload, options.signal, onDelta)
          : await chatOllamaMain(this.fetchImpl, payload, options.signal, onDelta)
    } catch (error) {
      throw providerFailure(error)
    }
    for (const chunk of messageChunks(value.message)) yield chunk
  }
}

export function harnessProviderRoute(runtime: HarnessRuntimeId): string {
  return ROUTES[runtime]
}
