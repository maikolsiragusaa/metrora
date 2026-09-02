import type {
  AdvisorHostedChatMessage,
  AdvisorHostedChatRequest,
  AdvisorHostedChatResult,
  AdvisorHostedProviderId,
  AdvisorHostedToolCall,
  AdvisorHostedToolDefinition,
  AdvisorHostedUsage,
  EventEmitter,
  FetchLike,
} from './advisor-provider-contract'
import {
  HostedAdapterError,
  MAX_TEXT_BYTES,
  MAX_TOOL_CALLS,
  byteLength,
  emitToolCall,
  emitUsage,
  isRecord,
  normalizeToolCall,
  providerHttpError,
  usageFrom,
} from './advisor-provider-contract'
import {
  HOSTED_CONTINUATION_ADAPTER,
  normalizeHostedContinuationPayload,
  type AdvisorHostedContinuationPayload,
} from './advisor-provider-continuation'

/** The only AI SDK adapter currently enabled in the desktop runtime. */
export const AI_SDK_OPENAI_COMPATIBLE_ADAPTER = HOSTED_CONTINUATION_ADAPTER

/** Main-process result; `continuationPayload` is stripped before IPC returns. */
export type AdvisorHostedAiSdkStep = Omit<AdvisorHostedChatResult, 'continuation'> & {
  continuationPayload?: AdvisorHostedContinuationPayload
}

const AI_BASE_URLS: Partial<Record<AdvisorHostedProviderId, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  'opencode-zen': 'https://opencode.ai/zen/v1',
}

type AnyRecord = Record<string, any>

function providerBaseUrl(provider: AdvisorHostedProviderId): string {
  const base = AI_BASE_URLS[provider]
  if (!base) throw new HostedAdapterError('request-unsupported', 'This provider is not enabled for the OpenAI-compatible adapter.')
  return base
}

function parsedArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function aiMessages(messages: readonly AdvisorHostedChatMessage[], continuation?: AdvisorHostedContinuationPayload): AnyRecord[] {
  const continuationIds = new Set(
    continuation?.responseMessages.flatMap(message => {
      const content = message.content
      return Array.isArray(content)
        ? content.filter(part => isRecord(part) && part.type === 'tool-call' && typeof part.toolCallId === 'string').map(part => part.toolCallId as string)
        : []
    }) ?? [],
  )
  const replacementIndex = continuation && continuation.protocol === 'openai-chat'
    ? messages.findLastIndex(message => message.role === 'assistant' && Boolean(message.toolCalls?.some(call => continuationIds.has(call.id))))
    : -1
  const output: AnyRecord[] = []
  messages.forEach((message, index) => {
    if (index === replacementIndex && continuation) {
      output.push(...continuation.responseMessages.map(item => ({ ...item })))
      return
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: AnyRecord[] = []
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls) {
        content.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.arguments ? parsedArguments(call.arguments) : {} })
      }
      output.push({ role: 'assistant', content })
      return
    }
    if (message.role === 'tool') {
      output.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: message.toolCallId,
          toolName: message.toolName ?? 'metrora_tool',
          output: { type: 'text', value: message.content },
        }],
      })
      return
    }
    output.push({ role: message.role, content: message.content })
  })
  return output
}

function aiTools(definitions: readonly AdvisorHostedToolDefinition[], jsonSchema: (schema: AnyRecord) => unknown): AnyRecord | undefined {
  if (!definitions.length) return undefined
  const tools: AnyRecord = {}
  for (const definition of definitions) {
    tools[definition.function.name] = {
      ...(definition.function.description ? { description: definition.function.description } : {}),
      inputSchema: jsonSchema(definition.function.parameters ?? { type: 'object', properties: {}, additionalProperties: false }),
      // A schema-only tool is intentional: MetroraAgentLoop, not AI SDK, owns
      // execution, allowlists, concurrency, evidence, and continuation bounds.
      outputSchema: jsonSchema({ type: 'object', additionalProperties: true }),
    }
  }
  return tools
}

function transformRequestBody(args: AnyRecord): AnyRecord {
  const messages = Array.isArray(args.messages) ? args.messages : []
  const names = new Map<string, string>()
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      if (!isRecord(call) || typeof call.id !== 'string' || !isRecord(call.function) || typeof call.function.name !== 'string') continue
      names.set(call.id, call.function.name)
    }
  }
  return {
    ...args,
    messages: messages.map(message => {
      if (!isRecord(message) || message.role !== 'tool' || typeof message.tool_call_id !== 'string') return message
      const name = names.get(message.tool_call_id)
      return name ? { ...message, name } : message
    }),
  }
}

function providerOptions(request: AdvisorHostedChatRequest): AnyRecord | undefined {
  return request.reasoningEffort && request.reasoningEffort !== 'default'
    ? { openaiCompatible: { reasoningEffort: request.reasoningEffort } }
    : undefined
}

function usage(value: unknown): AdvisorHostedUsage | null {
  if (!isRecord(value)) return null
  return usageFrom(value.inputTokens, value.outputTokens, value.totalTokens)
}

function appendText(current: string, value: unknown): string {
  if (typeof value !== 'string' || !value) return current
  const next = current + value
  if (byteLength(next) > MAX_TEXT_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
  return next
}

function continuationPayloadFromResponse(
  provider: AdvisorHostedProviderId,
  model: string,
  responseMessages: unknown,
  calls: readonly AdvisorHostedToolCall[],
): AdvisorHostedContinuationPayload | undefined {
  if (!calls.length || !Array.isArray(responseMessages)) return undefined
  return normalizeHostedContinuationPayload({
    provider,
    model,
    protocol: 'openai-chat',
    adapter: AI_SDK_OPENAI_COMPATIBLE_ADAPTER,
    responseMessages,
  }) ?? undefined
}

function statusOf(error: unknown): number | null {
  if (!isRecord(error)) return null
  for (const key of ['statusCode', 'status']) {
    const value = error[key]
    if (typeof value === 'number' && Number.isInteger(value)) return value
  }
  return null
}

function mapError(error: unknown, signal: AbortSignal): never {
  if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new HostedAdapterError('cancelled', 'Advisor request cancelled.')
  if (error instanceof HostedAdapterError) throw error
  const status = statusOf(error)
  if (status !== null && [401, 403, 404, 429].includes(status)) throw providerHttpError(status)
  const name = error instanceof Error ? error.name.toLowerCase() : ''
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (name.includes('json') || name.includes('validation') || name.includes('data') || /malformed|invalid json|parse response|could not parse/.test(message)) {
    throw new HostedAdapterError('response-malformed', 'The provider response was malformed.')
  }
  throw new HostedAdapterError('provider-unavailable', 'The selected provider is unavailable.')
}

function normalizeCall(value: unknown, fallback: string): AdvisorHostedToolCall {
  if (!isRecord(value)) throw new HostedAdapterError('tool-malformed', 'The provider returned malformed tool calls.')
  return normalizeToolCall(value.toolCallId ?? value.id ?? fallback, value.toolName ?? value.name, value.input ?? value.arguments ?? {}, fallback)
}

function modelFor(request: AdvisorHostedChatRequest, secret: string, fetchImpl: FetchLike, createOpenAICompatible: (...args: any[]) => any) {
  const provider = createOpenAICompatible({
    name: 'metrora-openai-compatible',
    baseURL: providerBaseUrl(request.provider),
    apiKey: secret,
    fetch: fetchImpl as any,
    includeUsage: true,
    transformRequestBody,
  })
  return provider.chatModel(request.model)
}

export async function runOpenAiCompatibleStep(options: {
  provider: AdvisorHostedProviderId
  secret: string
  request: AdvisorHostedChatRequest
  requestId: string
  fetchImpl: FetchLike
  signal: AbortSignal
  emit: EventEmitter
  continuation?: AdvisorHostedContinuationPayload
}): Promise<AdvisorHostedAiSdkStep> {
  const { provider, secret, request, requestId, fetchImpl, signal, emit } = options
  if (request.messageMode === 'flattened' || (provider !== 'openrouter' && provider !== 'opencode-zen')) {
    throw new HostedAdapterError('request-unsupported', 'The OpenAI-compatible adapter requires native semantic messages.')
  }
  // The Electron main bundle is intentionally CommonJS. Load the ESM-only AI
  // SDK packages at the adapter boundary so the existing main/preload module
  // graph does not require a broad application-wide ESM migration.
  const [{ generateText, jsonSchema, streamText }, { createOpenAICompatible }] = await Promise.all([
    import('ai'),
    import('@ai-sdk/openai-compatible'),
  ])
  const model = modelFor(request, secret, fetchImpl, createOpenAICompatible)
  const messages = aiMessages(request.messages, options.continuation)
  const definitions = request.tools ?? []
  const settings: AnyRecord = {
    model,
    messages,
    tools: aiTools(definitions, jsonSchema as (schema: AnyRecord) => unknown),
    allowSystemInMessages: true,
    maxRetries: 0,
    abortSignal: signal,
    ...(providerOptions(request) ? { providerOptions: providerOptions(request) } : {}),
  }
  emit({ requestId, provider, model: request.model, kind: 'started' })
  try {
    let text = ''
    const calls: AdvisorHostedToolCall[] = []
    let responseMessages: unknown = []
    let resultUsage: AdvisorHostedUsage | null = null
    if (request.stream === true) {
      const result = streamText(settings as any)
      const started = new Set<string>()
      for await (const part of result.stream as AsyncIterable<AnyRecord>) {
        if (!isRecord(part)) continue
        if (part.type === 'text-delta') {
          const chunk = typeof part.text === 'string' ? part.text : ''
          const next = appendText(text, chunk)
          if (next !== text) {
            emit({ requestId, provider, model: request.model, kind: 'text-delta', text: chunk })
            text = next
          }
        } else if (part.type === 'tool-input-start' && typeof part.id === 'string' && typeof part.toolName === 'string') {
          started.add(part.id)
          emit({ requestId, provider, model: request.model, kind: 'tool-call-start', callId: part.id, name: part.toolName })
        } else if (part.type === 'tool-input-delta' && typeof part.id === 'string' && typeof part.delta === 'string') {
          emit({ requestId, provider, model: request.model, kind: 'tool-call-delta', callId: part.id, delta: part.delta })
        } else if (part.type === 'tool-call') {
          const call = normalizeCall(part, provider + '-tool-' + calls.length)
          if (calls.length >= MAX_TOOL_CALLS) throw new HostedAdapterError('tool-malformed', 'The provider returned too many tool calls.')
          if (!started.has(call.id)) emit({ requestId, provider, model: request.model, kind: 'tool-call-start', callId: call.id, name: call.name })
          calls.push(call)
          emit({ requestId, provider, model: request.model, kind: 'tool-call-complete', callId: call.id, name: call.name, arguments: call.arguments })
        } else if (part.type === 'error') {
          mapError(part.error, signal)
        }
      }
      if (!text) text = appendText('', await result.text)
      const streamedCalls = await result.toolCalls
      if (!calls.length) {
        for (const raw of streamedCalls) {
          const call = normalizeCall(raw, provider + '-tool-' + calls.length)
          if (calls.length >= MAX_TOOL_CALLS) throw new HostedAdapterError('tool-malformed', 'The provider returned too many tool calls.')
          emitToolCall(call, requestId, provider, request.model, emit)
          calls.push(call)
        }
      }
      responseMessages = await result.responseMessages
      resultUsage = usage(await result.usage)
    } else {
      const result = await generateText(settings as any)
      text = appendText('', result.text)
      for (const raw of result.toolCalls) {
        const call = normalizeCall(raw, provider + '-tool-' + calls.length)
        if (calls.length >= MAX_TOOL_CALLS) throw new HostedAdapterError('tool-malformed', 'The provider returned too many tool calls.')
        emitToolCall(call, requestId, provider, request.model, emit)
        calls.push(call)
      }
      responseMessages = result.responseMessages
      resultUsage = usage(result.usage)
    }
    if (!text && !calls.length) throw new HostedAdapterError('response-malformed', 'The provider returned no usable content.')
    const continuationPayload = continuationPayloadFromResponse(provider, request.model, responseMessages, calls)
    emitUsage(requestId, provider, request.model, resultUsage, emit)
    const value: AdvisorHostedAiSdkStep = {
      provider,
      model: request.model,
      message: { content: text, tool_calls: calls },
      usage: resultUsage,
      streamed: request.stream === true,
      ...(continuationPayload ? { continuationPayload } : {}),
    }
    emit({ requestId, provider, model: request.model, kind: 'completed', streamed: request.stream === true, usage: resultUsage, toolCalls: calls })
    return value
  } catch (error) {
    mapError(error, signal)
  }
}
