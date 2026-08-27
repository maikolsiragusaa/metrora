import type {
  AdvisorHostedChatRequest,
  AdvisorHostedProtocol,
  AdvisorHostedProviderId,
  AdvisorHostedToolCall,
  AdvisorHostedToolDefinition,
  AdvisorHostedUsage,
  EventEmitter,
} from './advisor-provider-contract'
import {
  HostedAdapterError,
  MAX_TEXT_BYTES,
  MAX_TOOL_ARGUMENT_BYTES,
  MAX_TOOL_CALLS,
  TOOL_NAMES,
  boundedString,
  byteLength,
  emitToolCall,
  isRecord,
  mergeUsage,
  normalizeToolCall,
  toolName,
  usageFrom,
} from './advisor-provider-contract'

export type ParsedChat = { content: string; calls: AdvisorHostedToolCall[]; usage: AdvisorHostedUsage | null }
export type StreamState = {
  content: string
  calls: AdvisorHostedToolCall[]
  usage: AdvisorHostedUsage | null
  terminal: boolean
  openCalls: Map<string, { id: string; name: string; arguments: string }>
  openCallKeys: Map<string, string>
  startedCalls: Set<string>
  completedCalls: Set<string>
}
export type StreamParser = (payload: Record<string, unknown>, state: StreamState, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter) => void
export type JsonParser = (payload: Record<string, unknown>, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter) => ParsedChat
export type HostedProtocolAdapter = { buildBody: (request: AdvisorHostedChatRequest, provider: AdvisorHostedProviderId) => Record<string, unknown>; parseJson: JsonParser; parseStream: StreamParser }

function openAiTools(tools: AdvisorHostedToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({ type: 'function', name: tool.function.name, ...(tool.function.description ? { description: tool.function.description } : {}), ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}) }))
}
function openAiChatTools(tools: AdvisorHostedToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({ type: 'function', function: { name: tool.function.name, ...(tool.function.description ? { description: tool.function.description } : {}), ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}) } }))
}
function anthropicTools(tools: AdvisorHostedToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({ name: tool.function.name, ...(tool.function.description ? { description: tool.function.description } : {}), input_schema: tool.function.parameters ?? { type: 'object', properties: {}, additionalProperties: false } }))
}
function geminiTools(tools: AdvisorHostedToolDefinition[]): Array<Record<string, unknown>> {
  return tools.length ? [{ functionDeclarations: tools.map(tool => ({ name: tool.function.name, ...(tool.function.description ? { description: tool.function.description } : {}), parameters: tool.function.parameters ?? { type: 'object', properties: {}, additionalProperties: false } })) }] : []
}
function openAiBody(request: AdvisorHostedChatRequest): Record<string, unknown> {
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  const input: Array<Record<string, unknown>> = []
  for (const message of request.messages) {
    if (message.role === 'system') continue
    input.push({ role: message.role, content: message.content })
  }
  return { model: request.model, ...(system ? { instructions: system } : {}), input, ...(request.tools?.length ? { tools: openAiTools(request.tools) } : {}), stream: request.stream === true, store: false }
}
function openAiChatBody(request: AdvisorHostedChatRequest, includeUsage: boolean): Record<string, unknown> {
  const messages = request.messages.map(message => ({ role: message.role, content: message.content }))
  return {
    model: request.model,
    messages,
    ...(request.tools?.length ? { tools: openAiChatTools(request.tools) } : {}),
    stream: request.stream === true,
    ...(request.stream === true && includeUsage ? { stream_options: { include_usage: true } } : {}),
  }
}
function anthropicBody(request: AdvisorHostedChatRequest): Record<string, unknown> {
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  const messages = request.messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }))
  return { model: request.model, max_tokens: 2048, ...(system ? { system } : {}), messages, ...(request.tools?.length ? { tools: anthropicTools(request.tools) } : {}), stream: request.stream === true }
}
function geminiBody(request: AdvisorHostedChatRequest): Record<string, unknown> {
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  const contents = request.messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }))
  return { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, ...(request.tools?.length ? { tools: geminiTools(request.tools) } : {}) }
}

function appendText(state: StreamState, requestId: string, provider: AdvisorHostedProviderId, model: string, value: unknown, emit: EventEmitter): void {
  if (typeof value !== 'string' || !value) return
  if (byteLength(state.content + value) > MAX_TEXT_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
  state.content += value
  emit({ requestId, provider, model, kind: 'text-delta', text: value })
}
function ensureToolCallCapacity(state: StreamState): void {
  if (state.calls.length + state.openCalls.size >= MAX_TOOL_CALLS) throw new HostedAdapterError('tool-malformed', 'The provider returned too many tool calls.')
}
function appendToolCall(state: StreamState, call: AdvisorHostedToolCall): void {
  if (state.calls.length >= MAX_TOOL_CALLS) throw new HostedAdapterError('tool-malformed', 'The provider returned too many tool calls.')
  state.calls.push(call)
}
function appendToolDelta(state: StreamState, requestId: string, provider: AdvisorHostedProviderId, model: string, key: string, value: unknown, emit: EventEmitter): void {
  if (typeof value !== 'string' || !value) return
  const id = state.openCallKeys.get(key) ?? key
  const current = state.openCalls.get(id)
  if (!current) throw new HostedAdapterError('tool-malformed', 'The provider returned a tool delta without a tool call.')
  if (byteLength(current.arguments + value) > MAX_TOOL_ARGUMENT_BYTES) throw new HostedAdapterError('tool-malformed', 'The provider returned oversized tool arguments.')
  current.arguments += value
  emit({ requestId, provider, model, kind: 'tool-call-delta', callId: id, delta: value })
}
function completeTool(state: StreamState, requestId: string, provider: AdvisorHostedProviderId, model: string, key: string, name: unknown, args: unknown, emit: EventEmitter, requireCompleteArguments = false): void {
  const id = state.openCallKeys.get(key) ?? key
  if (state.completedCalls.has(id)) throw new HostedAdapterError('tool-malformed', 'The provider completed a tool call more than once.')
  const current = state.openCalls.get(id)
  const rawArguments = args ?? current?.arguments
  if (requireCompleteArguments && (typeof rawArguments !== 'string' || !rawArguments.trim())) throw new HostedAdapterError('tool-malformed', 'The provider ended a tool call before returning its arguments.')
  const call = normalizeToolCall(current?.id ?? id, name ?? current?.name, rawArguments ?? '{}', provider + '-tool-' + state.calls.length)
  if (!state.startedCalls.has(id)) {
    state.startedCalls.add(id)
    emit({ requestId, provider, model, kind: 'tool-call-start', callId: call.id, name: call.name })
  }
  state.openCalls.delete(id)
  state.openCallKeys.delete(key)
  state.completedCalls.add(id)
  appendToolCall(state, call)
  emit({ requestId, provider, model, kind: 'tool-call-complete', callId: call.id, name: call.name, arguments: call.arguments })
}
function usageFromOpenAi(value: unknown): AdvisorHostedUsage | null {
  if (!isRecord(value)) return null
  return usageFrom(value.input_tokens, value.output_tokens, value.total_tokens)
}
function usageFromAnthropic(value: unknown): AdvisorHostedUsage | null {
  if (!isRecord(value)) return null
  return usageFrom(value.input_tokens, value.output_tokens)
}
function usageFromGemini(value: unknown): AdvisorHostedUsage | null {
  if (!isRecord(value)) return null
  return usageFrom(value.promptTokenCount, value.candidatesTokenCount, value.totalTokenCount)
}
function usageFromOpenAiChat(value: unknown): AdvisorHostedUsage | null {
  if (!isRecord(value)) return null
  return usageFrom(value.prompt_tokens, value.completion_tokens, value.total_tokens)
}

function parseOpenAiJson(payload: Record<string, unknown>, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): ParsedChat {
  const state = streamState()
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item)) continue
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) if (isRecord(part) && part.type === 'output_text') appendText(state, requestId, provider, model, part.text, emit)
      }
      if (item.type === 'function_call') {
        const call = normalizeToolCall(item.call_id ?? item.id, item.name, item.arguments, 'openai-tool-' + state.calls.length)
        appendToolCall(state, call)
        emitToolCall(call, requestId, provider, model, emit)
      }
    }
  } else if (typeof payload.output_text === 'string') {
    appendText(state, requestId, provider, model, payload.output_text, emit)
  }
  return { content: state.content, calls: state.calls, usage: usageFromOpenAi(payload.usage) }
}
function parseOpenAiChatJson(payload: Record<string, unknown>, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): ParsedChat {
  const state = streamState()
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) continue
    appendText(state, requestId, provider, model, choice.message.content, emit)
    const toolCalls = Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : []
    for (const toolCall of toolCalls) {
      if (!isRecord(toolCall)) continue
      const fn = isRecord(toolCall.function) ? toolCall.function : {}
      const call = normalizeToolCall(toolCall.id, fn.name, fn.arguments, provider + '-tool-' + state.calls.length)
      appendToolCall(state, call)
      emitToolCall(call, requestId, provider, model, emit)
    }
  }
  return { content: state.content, calls: state.calls, usage: usageFromOpenAiChat(payload.usage) }
}
function parseAnthropicJson(payload: Record<string, unknown>, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): ParsedChat {
  const state = streamState()
  if (Array.isArray(payload.content)) {
    for (const block of payload.content) {
      if (!isRecord(block)) continue
      if (block.type === 'text') appendText(state, requestId, provider, model, block.text, emit)
      if (block.type === 'tool_use') {
        const call = normalizeToolCall(block.id, block.name, block.input, provider + '-tool-' + state.calls.length)
        appendToolCall(state, call)
        emitToolCall(call, requestId, provider, model, emit)
      }
    }
  }
  return { content: state.content, calls: state.calls, usage: usageFromAnthropic(payload.usage) }
}
function parseGeminiJson(payload: Record<string, unknown>, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): ParsedChat {
  const state = streamState()
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue
    for (const part of candidate.content.parts) {
      if (!isRecord(part)) continue
      if (typeof part.text === 'string') appendText(state, requestId, provider, model, part.text, emit)
      if (isRecord(part.functionCall)) {
        const call = normalizeToolCall(part.functionCall.id, part.functionCall.name, part.functionCall.args, 'gemini-tool-' + state.calls.length)
        appendToolCall(state, call)
        emitToolCall(call, requestId, provider, model, emit)
      }
    }
  }
  return { content: state.content, calls: state.calls, usage: usageFromGemini(payload.usageMetadata) }
}

function parseOpenAiStream(payload: Record<string, unknown>, state: StreamState, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): void {
  if (payload.type === 'response.output_text.delta') appendText(state, requestId, provider, model, payload.delta, emit)
  else if (payload.type === 'response.output_item.added' && isRecord(payload.item) && payload.item.type === 'function_call') {
    const itemId = boundedString(payload.item.id, 128, 'The provider returned an invalid tool call item id.')
    const id = boundedString(payload.item.call_id ?? itemId, 128, 'The provider returned an invalid tool call id.')
    const name = toolName(payload.item.name)
    if (!name || !TOOL_NAMES.has(name)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
    if (state.openCalls.has(id)) throw new HostedAdapterError('tool-malformed', 'The provider returned a duplicate tool call.')
    ensureToolCallCapacity(state)
    state.openCalls.set(id, { id, name, arguments: '' })
    state.openCallKeys.set(itemId, id)
    state.startedCalls.add(id)
    emit({ requestId, provider, model, kind: 'tool-call-start', callId: id, name })
  } else if (payload.type === 'response.function_call_arguments.delta') {
    appendToolDelta(state, requestId, provider, model, boundedString(payload.item_id, 128, 'The provider returned an invalid tool call id.'), payload.delta, emit)
  } else if (payload.type === 'response.function_call_arguments.done') {
    completeTool(state, requestId, provider, model, boundedString(payload.item_id, 128, 'The provider returned an invalid tool call id.'), payload.name, payload.arguments, emit)
  } else if (payload.type === 'response.completed' && isRecord(payload.response)) {
    state.terminal = true
    state.usage = mergeUsage(state.usage, usageFromOpenAi(payload.response.usage))
  }
}
function parseAnthropicStream(payload: Record<string, unknown>, state: StreamState, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): void {
  if (payload.type === 'content_block_start' && isRecord(payload.content_block) && payload.content_block.type === 'tool_use') {
    const key = String(payload.index)
    const id = boundedString(payload.content_block.id, 128, 'The provider returned an invalid tool call id.')
    const name = toolName(payload.content_block.name)
    if (!name || !TOOL_NAMES.has(name)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
    if (state.openCallKeys.has(key)) throw new HostedAdapterError('tool-malformed', 'The provider returned a duplicate tool call.')
    ensureToolCallCapacity(state)
    state.openCalls.set(id, { id, name, arguments: '' })
    state.openCallKeys.set(key, id)
    state.startedCalls.add(id)
    emit({ requestId, provider, model, kind: 'tool-call-start', callId: id, name })
  } else if (payload.type === 'content_block_delta' && isRecord(payload.delta)) {
    if (payload.delta.type === 'text_delta') appendText(state, requestId, provider, model, payload.delta.text, emit)
    else if (payload.delta.type === 'input_json_delta') appendToolDelta(state, requestId, provider, model, String(payload.index), payload.delta.partial_json, emit)
  } else if (payload.type === 'message_start' && isRecord(payload.message)) {
    state.usage = mergeUsage(state.usage, usageFromAnthropic(payload.message.usage))
  } else if (payload.type === 'message_delta' && isRecord(payload.usage)) {
    state.usage = mergeUsage(state.usage, usageFromAnthropic(payload.usage))
  } else if (payload.type === 'message_stop') {
    state.terminal = true
  } else if (payload.type === 'content_block_stop') {
    const key = String(payload.index)
    if (!state.openCallKeys.has(key)) return
    completeTool(state, requestId, provider, model, key, undefined, undefined, emit)
  }
}
function parseGeminiStream(payload: Record<string, unknown>, state: StreamState, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): void {
  if (Array.isArray(payload.candidates) && payload.candidates.some(candidate => isRecord(candidate) && typeof candidate.finishReason === 'string' && candidate.finishReason.trim())) state.terminal = true
  const parsed = parseGeminiJson(payload, provider, requestId, model, emit)
  state.content += parsed.content
  if (byteLength(state.content) > MAX_TEXT_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
  state.usage = mergeUsage(state.usage, parsed.usage)
  for (const call of parsed.calls) {
    if (!state.calls.some(existing => existing.id === call.id && existing.name === call.name)) appendToolCall(state, call)
  }
}

function startChatTool(state: StreamState, requestId: string, provider: AdvisorHostedProviderId, model: string, key: string, id: string, name: string, emit: EventEmitter): void {
  if (state.openCallKeys.has(key) && state.openCallKeys.get(key) !== id) throw new HostedAdapterError('tool-malformed', 'The provider changed a tool call id mid-stream.')
  state.openCallKeys.set(key, id)
  if (!state.openCalls.has(id)) {
    ensureToolCallCapacity(state)
    state.openCalls.set(id, { id, name, arguments: '' })
  }
  const current = state.openCalls.get(id)!
  if (name) current.name = name
  const normalizedName = toolName(current.name)
  if (current.name && (!normalizedName || !TOOL_NAMES.has(normalizedName))) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
  if (normalizedName && !state.startedCalls.has(id)) {
    state.startedCalls.add(id)
    emit({ requestId, provider, model, kind: 'tool-call-start', callId: id, name: normalizedName })
  }
}
function parseOpenAiChatStream(payload: Record<string, unknown>, state: StreamState, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter): void {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  for (const choice of choices) {
    if (!isRecord(choice)) continue
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) state.terminal = true
    if (!isRecord(choice.delta)) continue
    appendText(state, requestId, provider, model, choice.delta.content, emit)
    const toolCalls = Array.isArray(choice.delta.tool_calls) ? choice.delta.tool_calls : []
    for (const toolCall of toolCalls) {
      if (!isRecord(toolCall)) continue
      const key = typeof toolCall.index === 'number' && Number.isInteger(toolCall.index) ? String(toolCall.index) : '0'
      const existingId = state.openCallKeys.get(key)
      const explicitId = typeof toolCall.id === 'string' && toolCall.id
        ? boundedString(toolCall.id, 128, 'The provider returned an invalid tool call id.')
        : null
      if (existingId && explicitId && existingId !== explicitId && !existingId.startsWith(provider + '-tool-')) {
        throw new HostedAdapterError('tool-malformed', 'The provider changed a tool call id mid-stream.')
      }
      const id = existingId ?? explicitId ?? provider + '-tool-' + key
      const fn = isRecord(toolCall.function) ? toolCall.function : {}
      startChatTool(state, requestId, provider, model, key, id, typeof fn.name === 'string' ? fn.name : '', emit)
      if (typeof fn.arguments === 'string' && fn.arguments) appendToolDelta(state, requestId, provider, model, key, fn.arguments, emit)
    }
    if (choice.finish_reason === 'tool_calls') {
      for (const key of [...state.openCallKeys.keys()]) completeTool(state, requestId, provider, model, key, undefined, undefined, emit)
    }
  }
  state.usage = mergeUsage(state.usage, usageFromOpenAiChat(payload.usage))
}

function newStreamState(): StreamState {
  return { content: '', calls: [], usage: null, terminal: false, openCalls: new Map(), openCallKeys: new Map(), startedCalls: new Set(), completedCalls: new Set() }
}

export function streamState(): StreamState {
  return newStreamState()
}

const PROTOCOL_ADAPTERS: Record<AdvisorHostedProtocol, HostedProtocolAdapter> = {
  'openai-responses': { buildBody: request => openAiBody(request), parseJson: parseOpenAiJson, parseStream: parseOpenAiStream },
  'openai-chat': { buildBody: (request, provider) => openAiChatBody(request, provider === 'openrouter'), parseJson: parseOpenAiChatJson, parseStream: parseOpenAiChatStream },
  'anthropic-messages': { buildBody: request => anthropicBody(request), parseJson: parseAnthropicJson, parseStream: parseAnthropicStream },
  'gemini-content': { buildBody: request => geminiBody(request), parseJson: parseGeminiJson, parseStream: parseGeminiStream },
}

export function bodyFor(provider: AdvisorHostedProviderId, protocol: AdvisorHostedProtocol, request: AdvisorHostedChatRequest): Record<string, unknown> {
  return PROTOCOL_ADAPTERS[protocol].buildBody(request, provider)
}

export function protocolAdapter(protocol: AdvisorHostedProtocol): HostedProtocolAdapter {
  return PROTOCOL_ADAPTERS[protocol]
}

export function finalizeOpenToolCalls(state: StreamState, provider: AdvisorHostedProviderId, requestId: string, model: string, emit: EventEmitter, requireCompleteArguments = false): void {
  for (const key of [...state.openCallKeys.keys()]) completeTool(state, requestId, provider, model, key, undefined, undefined, emit, requireCompleteArguments)
}
