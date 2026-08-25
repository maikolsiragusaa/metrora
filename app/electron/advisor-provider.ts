import * as contract from './advisor-provider-contract'
import type {
  AdvisorHostedChatMessage,
  AdvisorHostedChatRequest,
  AdvisorHostedChatResult,
  AdvisorHostedCredentialStatus,
  AdvisorHostedEnvelope,
  AdvisorHostedEvent,
  AdvisorHostedModel,
  AdvisorHostedProbe,
  AdvisorHostedProviderId,
  AdvisorHostedToolCall,
  AdvisorHostedToolDefinition,
  AdvisorHostedUsage,
  CredentialReader,
  CredentialStatusReader,
  EventEmitter,
  FetchLike,
} from './advisor-provider-contract'
export type {
  AdvisorHostedChatMessage,
  AdvisorHostedChatRequest,
  AdvisorHostedChatResult,
  AdvisorHostedCredentialStatus,
  AdvisorHostedEnvelope,
  AdvisorHostedEvent,
  AdvisorHostedModel,
  AdvisorHostedModelState,
  AdvisorHostedProbe,
  AdvisorHostedProviderId,
  AdvisorHostedToolCall,
  AdvisorHostedToolDefinition,
  AdvisorHostedUsage,
} from './advisor-provider-contract'

const {
  ANTHROPIC_VERSION,
  DESCRIPTORS,
  MAX_MESSAGES,
  MAX_MODELS,
  MAX_MODEL_PAGE_SIZE,
  MAX_MODEL_PAGES,
  MAX_PAGE_TOKEN_BYTES,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_SSE_EVENTS,
  MAX_TEXT_BYTES,
  MAX_TOOL_ARGUMENT_BYTES,
  MAX_TOOL_CALLS,
  MAX_TOOLS,
  PROBE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  TOOL_NAMES,
  authHeaders,
  boundedJson,
  boundedString,
  byteLength,
  emitToolCall,
  emitUsage,
  fetchResponse,
  isRecord,
  mergeUsage,
  normalizeToolCall,
  normalizeTools,
  numberOrNull,
  providerHttpError,
  providerUrl,
  readBoundedText,
  readJson,
  requestHeaders,
  safeError,
  safeModelLabel,
  statusCheck,
  throwIfAborted,
  toolArguments,
  toolName,
  usageFrom,
  validModel,
  validProvider,
  validRequestId,
} = contract
const { HostedAdapterError } = contract
export { HostedAdapterError }

function normalizeMessages(value: unknown): AdvisorHostedChatMessage[] {
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) throw new HostedAdapterError('request-malformed', 'Advisor messages are malformed.')
  return value.map(item => {
    if (!isRecord(item) || !['system', 'user', 'assistant'].includes(String(item.role))) throw new HostedAdapterError('request-malformed', 'Advisor messages are malformed.')
    const role = item.role as AdvisorHostedChatMessage['role']
    if (Object.prototype.hasOwnProperty.call(item, 'toolCalls') || Object.prototype.hasOwnProperty.call(item, 'toolCallId') || Object.prototype.hasOwnProperty.call(item, 'toolName')) {
      throw new HostedAdapterError('request-malformed', 'Provider-native tool continuation is not supported by Advisor.')
    }
    return { role, content: boundedString(item.content, 32_000, 'Advisor message content is too large.') }
  })
}
function parseChatRequest(requestId: unknown, value: unknown): { requestId: string; request: AdvisorHostedChatRequest } {
  if (!validRequestId(requestId) || !isRecord(value) || value.consent !== true || !validProvider(value.provider) || !validModel(value.model)) throw new HostedAdapterError('request-malformed', 'Advisor hosted request is invalid.')
  return {
    requestId,
    request: {
      provider: value.provider,
      model: value.model,
      messages: normalizeMessages(value.messages),
      tools: normalizeTools(value.tools),
      stream: value.stream === undefined ? true : value.stream === true,
      consent: true,
    },
  }
}
function openAiTools(tools: AdvisorHostedToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({ type: 'function', name: tool.function.name, ...(tool.function.description ? { description: tool.function.description } : {}), ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}) }))
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
function bodyFor(provider: AdvisorHostedProviderId, request: AdvisorHostedChatRequest): Record<string, unknown> {
  if (provider === 'openai') return openAiBody(request)
  if (provider === 'anthropic') return anthropicBody(request)
  return geminiBody(request)
}


function modelRows(provider: AdvisorHostedProviderId, payload: Record<string, unknown>, models: AdvisorHostedModel[], seen: Set<string>): string | null {
  const rows = provider === 'gemini' ? payload.models : payload.data
  if (!Array.isArray(rows)) throw new HostedAdapterError('response-malformed', 'The provider model listing was malformed.')
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = provider === 'gemini' ? row.name : row.id
    if (!validModel(id) || seen.has(id)) continue
    const display = provider === 'anthropic' ? row.display_name : provider === 'gemini' ? row.displayName : id
    const label = typeof display === 'string' && display.length <= 160 ? display : safeModelLabel(id)
    const methods = provider === 'gemini' && Array.isArray(row.supportedGenerationMethods)
      ? row.supportedGenerationMethods.filter(item => typeof item === 'string')
      : []
    const supported = provider !== 'gemini' || methods.length === 0 || methods.includes('generateContent')
    models.push({
      id,
      label,
      state: supported ? 'discovered' : 'unsupported',
      limitation: supported ? 'Discovered from the provider model listing; Metrora Advisor compatibility is not verified.' : 'The provider listing does not report generateContent support.',
    })
    seen.add(id)
    if (models.length >= MAX_MODELS) break
  }
  if (provider === 'openai') return null
  if (provider === 'anthropic') {
    if (payload.has_more !== true) return null
    if (typeof payload.last_id !== 'string' || !payload.last_id.trim()) throw new HostedAdapterError('response-malformed', 'The provider model listing pagination was malformed.')
    return boundedString(payload.last_id, MAX_PAGE_TOKEN_BYTES, 'The provider model listing pagination token is too large.')
  }
  if (typeof payload.nextPageToken !== 'string' || !payload.nextPageToken.trim()) return null
  return boundedString(payload.nextPageToken, MAX_PAGE_TOKEN_BYTES, 'The provider model listing pagination token is too large.')
}
function providerDetail(provider: AdvisorHostedProviderId): string {
  return provider === 'openai' ? 'OpenAI is reachable.' : provider === 'anthropic' ? 'Anthropic is reachable.' : 'Google Gemini is reachable.'
}
function credentialDetail(status: AdvisorHostedCredentialStatus): string {
  if (status.state === 'not-configured') return 'Add your provider credential to use hosted Advisor.'
  if (status.state === 'locked-unavailable') return 'Secure credential storage is unavailable on this device.'
  if (status.state === 'invalid') return 'The saved provider credential is invalid; enter it again.'
  if (status.state === 'needs-reentry') return 'The saved provider credential needs to be entered again.'
  return 'The provider credential is unavailable.'
}

type StreamState = {
  content: string
  calls: AdvisorHostedToolCall[]
  usage: AdvisorHostedUsage | null
  openCalls: Map<string, { id: string; name: string; arguments: string }>
  openCallKeys: Map<string, string>
  completedCalls: Set<string>
}
function streamState(): StreamState {
  return { content: '', calls: [], usage: null, openCalls: new Map(), openCallKeys: new Map(), completedCalls: new Set() }
}
function appendText(state: StreamState, requestId: string, provider: AdvisorHostedProviderId, model: string, value: unknown, emit: EventEmitter): void {
  if (typeof value !== 'string' || !value) return
  if (byteLength(state.content + value) > MAX_TEXT_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
  state.content += value
  emit({ requestId, provider, model, kind: 'text-delta', text: value })
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
function completeTool(state: StreamState, requestId: string, provider: AdvisorHostedProviderId, model: string, key: string, name: unknown, args: unknown, emit: EventEmitter): void {
  const id = state.openCallKeys.get(key) ?? key
  if (state.completedCalls.has(id)) throw new HostedAdapterError('tool-malformed', 'The provider completed a tool call more than once.')
  const current = state.openCalls.get(id)
  const call = normalizeToolCall(current?.id ?? id, name ?? current?.name, args ?? current?.arguments ?? '{}')
  state.openCalls.delete(id)
  state.openCallKeys.delete(key)
  state.completedCalls.add(id)
  if (state.calls.length >= MAX_TOOL_CALLS) throw new HostedAdapterError('tool-malformed', 'The provider returned too many tool calls.')
  state.calls.push(call)
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
function parseOpenAiJson(payload: Record<string, unknown>, requestId: string, model: string, emit: EventEmitter): { content: string; calls: AdvisorHostedToolCall[]; usage: AdvisorHostedUsage | null } {
  const state = streamState()
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item)) continue
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) if (isRecord(part) && part.type === 'output_text') appendText(state, requestId, 'openai', model, part.text, emit)
      }
      if (item.type === 'function_call') {
        const call = normalizeToolCall(item.call_id ?? item.id, item.name, item.arguments)
        state.calls.push(call)
        emitToolCall(call, requestId, 'openai', model, emit)
      }
    }
  } else if (typeof payload.output_text === 'string') {
    appendText(state, requestId, 'openai', model, payload.output_text, emit)
  }
  return { content: state.content, calls: state.calls, usage: usageFromOpenAi(payload.usage) }
}
function parseAnthropicJson(payload: Record<string, unknown>, requestId: string, model: string, emit: EventEmitter): { content: string; calls: AdvisorHostedToolCall[]; usage: AdvisorHostedUsage | null } {
  const state = streamState()
  if (Array.isArray(payload.content)) {
    for (const block of payload.content) {
      if (!isRecord(block)) continue
      if (block.type === 'text') appendText(state, requestId, 'anthropic', model, block.text, emit)
      if (block.type === 'tool_use') {
        const call = normalizeToolCall(block.id, block.name, block.input)
        state.calls.push(call)
        emitToolCall(call, requestId, 'anthropic', model, emit)
      }
    }
  }
  return { content: state.content, calls: state.calls, usage: usageFromAnthropic(payload.usage) }
}
function parseGeminiJson(payload: Record<string, unknown>, requestId: string, model: string, emit: EventEmitter): { content: string; calls: AdvisorHostedToolCall[]; usage: AdvisorHostedUsage | null } {
  const state = streamState()
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue
    for (const part of candidate.content.parts) {
      if (!isRecord(part)) continue
      if (typeof part.text === 'string') appendText(state, requestId, 'gemini', model, part.text, emit)
      if (isRecord(part.functionCall)) {
        const call = normalizeToolCall(part.functionCall.id ?? 'gemini-tool-' + state.calls.length, part.functionCall.name, part.functionCall.args)
        state.calls.push(call)
        emitToolCall(call, requestId, 'gemini', model, emit)
      }
    }
  }
  return { content: state.content, calls: state.calls, usage: usageFromGemini(payload.usageMetadata) }
}
function parseJsonByProvider(provider: AdvisorHostedProviderId, payload: Record<string, unknown>, requestId: string, model: string, emit: EventEmitter): { content: string; calls: AdvisorHostedToolCall[]; usage: AdvisorHostedUsage | null } {
  if (provider === 'openai') return parseOpenAiJson(payload, requestId, model, emit)
  if (provider === 'anthropic') return parseAnthropicJson(payload, requestId, model, emit)
  return parseGeminiJson(payload, requestId, model, emit)
}
function parseOpenAiStream(payload: Record<string, unknown>, state: StreamState, requestId: string, model: string, emit: EventEmitter): void {
  if (payload.type === 'response.output_text.delta') appendText(state, requestId, 'openai', model, payload.delta, emit)
  else if (payload.type === 'response.output_item.added' && isRecord(payload.item) && payload.item.type === 'function_call') {
    const itemId = boundedString(payload.item.id, 128, 'The provider returned an invalid tool call item id.')
    const id = boundedString(payload.item.call_id, 128, 'The provider returned an invalid tool call id.')
    const name = toolName(payload.item.name)
    if (!name || !TOOL_NAMES.has(name)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
    if (state.openCalls.has(id)) throw new HostedAdapterError('tool-malformed', 'The provider returned a duplicate tool call.')
    state.openCalls.set(id, { id, name, arguments: '' })
    state.openCallKeys.set(itemId, id)
    emit({ requestId, provider: 'openai', model, kind: 'tool-call-start', callId: id, name })
  } else if (payload.type === 'response.function_call_arguments.delta') {
    appendToolDelta(state, requestId, 'openai', model, boundedString(payload.item_id, 128, 'The provider returned an invalid tool call id.'), payload.delta, emit)
  } else if (payload.type === 'response.function_call_arguments.done') {
    completeTool(state, requestId, 'openai', model, boundedString(payload.item_id, 128, 'The provider returned an invalid tool call id.'), payload.name, payload.arguments, emit)
  } else if (payload.type === 'response.completed' && isRecord(payload.response)) {
    state.usage = mergeUsage(state.usage, usageFromOpenAi(payload.response.usage))
  }
}
function parseAnthropicStream(payload: Record<string, unknown>, state: StreamState, requestId: string, model: string, emit: EventEmitter): void {
  if (payload.type === 'content_block_start' && isRecord(payload.content_block) && payload.content_block.type === 'tool_use') {
    const key = String(payload.index)
    const id = boundedString(payload.content_block.id, 128, 'The provider returned an invalid tool call id.')
    const name = toolName(payload.content_block.name)
    if (!name || !TOOL_NAMES.has(name)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
    state.openCalls.set(id, { id, name, arguments: '' })
    state.openCallKeys.set(key, id)
    emit({ requestId, provider: 'anthropic', model, kind: 'tool-call-start', callId: id, name })
  } else if (payload.type === 'content_block_delta' && isRecord(payload.delta)) {
    if (payload.delta.type === 'text_delta') appendText(state, requestId, 'anthropic', model, payload.delta.text, emit)
    else if (payload.delta.type === 'input_json_delta') appendToolDelta(state, requestId, 'anthropic', model, String(payload.index), payload.delta.partial_json, emit)
  } else if (payload.type === 'message_start' && isRecord(payload.message)) {
    state.usage = mergeUsage(state.usage, usageFromAnthropic(payload.message.usage))
  } else if (payload.type === 'message_delta' && isRecord(payload.usage)) {
    state.usage = mergeUsage(state.usage, usageFromAnthropic(payload.usage))
  } else if (payload.type === 'content_block_stop') {
    const key = String(payload.index)
    if (!state.openCallKeys.has(key)) return
    completeTool(state, requestId, 'anthropic', model, String(payload.index), undefined, undefined, emit)
  }
}
function parseGeminiStream(payload: Record<string, unknown>, state: StreamState, requestId: string, model: string, emit: EventEmitter): void {
  const parsed = parseGeminiJson(payload, requestId, model, emit)
  state.content += parsed.content
  if (byteLength(state.content) > MAX_TEXT_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
  state.usage = mergeUsage(state.usage, parsed.usage)
  for (const call of parsed.calls) {
    if (!state.calls.some(existing => existing.id === call.id && existing.name === call.name)) state.calls.push(call)
  }
}


function parseStreamByProvider(provider: AdvisorHostedProviderId, payload: Record<string, unknown>, state: StreamState, requestId: string, model: string, emit: EventEmitter): void {
  if (provider === 'openai') parseOpenAiStream(payload, state, requestId, model, emit)
  else if (provider === 'anthropic') parseAnthropicStream(payload, state, requestId, model, emit)
  else parseGeminiStream(payload, state, requestId, model, emit)
}
function parseSseLine(line: string, data: string[]): void {
  if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
}
async function readSse(response: Response, onPayload: (payload: Record<string, unknown>) => void): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    onPayload(await readJson(response))
    return
  }
  const decoder = new TextDecoder()
  let pending = ''
  let bytes = 0
  let events = 0
  let data: string[] = []
  const dispatch = () => {
    if (!data.length) return
    const joined = data.join('\n')
    data = []
    if (joined === '[DONE]') return
    let payload: unknown
    try { payload = JSON.parse(joined) } catch { throw new HostedAdapterError('response-malformed', 'The provider stream was malformed.') }
    if (!isRecord(payload)) throw new HostedAdapterError('response-malformed', 'The provider stream was malformed.')
    events += 1
    if (events > MAX_SSE_EVENTS) throw new HostedAdapterError('response-too-large', 'The provider stream exceeded the event limit.')
    onPayload(payload)
  }
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
    pending += decoder.decode(part.value, { stream: true })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) dispatch()
      else parseSseLine(line, data)
    }
  }
  pending += decoder.decode()
  if (pending.trim()) parseSseLine(pending, data)
  dispatch()
}
async function discover(provider: AdvisorHostedProviderId, secret: string, fetchImpl: FetchLike, parent?: AbortSignal): Promise<AdvisorHostedModel[]> {
  const descriptor = DESCRIPTORS[provider]
  const models: AdvisorHostedModel[] = []
  const seen = new Set<string>()
  const seenTokens = new Set<string>()
  let nextToken: string | null = null
  for (let page = 0; page < MAX_MODEL_PAGES && models.length < MAX_MODELS; page += 1) {
    const url = new URL(descriptor.modelsPath, descriptor.origin)
    if (provider === 'anthropic') {
      url.searchParams.set('limit', String(MAX_MODEL_PAGE_SIZE))
      if (nextToken) url.searchParams.set('after_id', nextToken)
    } else if (provider === 'gemini') {
      url.searchParams.set('pageSize', String(MAX_MODEL_PAGE_SIZE))
      if (nextToken) url.searchParams.set('pageToken', nextToken)
    }
    const request = await fetchResponse(fetchImpl, providerUrl(provider, url.pathname + url.search), { method: 'GET', headers: { Accept: 'application/json', ...authHeaders(provider, secret) } }, PROBE_TIMEOUT_MS, parent)
    try {
      statusCheck(request.response)
      nextToken = modelRows(provider, await readJson(request.response), models, seen)
    } finally { request.dispose() }
    if (!nextToken || seenTokens.has(nextToken)) break
    seenTokens.add(nextToken)
  }
  return models
}
async function hostedChat(provider: AdvisorHostedProviderId, secret: string, requestId: string, request: AdvisorHostedChatRequest, fetchImpl: FetchLike, emit: EventEmitter, parent?: AbortSignal): Promise<AdvisorHostedChatResult> {
  const stream = request.stream === true
  const result = await fetchResponse(fetchImpl, providerUrl(provider, DESCRIPTORS[provider].chatPath(request.model, stream)), {
    method: 'POST',
    headers: requestHeaders(provider, secret, stream),
    body: boundedJson(bodyFor(provider, request), 'Advisor hosted request exceeded the safety limit.'),
  }, REQUEST_TIMEOUT_MS, parent)
  emit({ requestId, provider, model: request.model, kind: 'started' })
  try {
    statusCheck(result.response)
    const state = streamState()
    let usage: AdvisorHostedUsage | null = null
    const contentType = result.response.headers.get('content-type') ?? ''
    if (stream && (!contentType || contentType.includes('text/event-stream'))) {
      await readSse(result.response, payload => parseStreamByProvider(provider, payload, state, requestId, request.model, emit))
      usage = state.usage
    } else {
      const parsed = parseJsonByProvider(provider, await readJson(result.response), requestId, request.model, emit)
      state.content = parsed.content
      state.calls = parsed.calls
      usage = parsed.usage
    }
    if (!state.content && !state.calls.length) throw new HostedAdapterError('response-malformed', 'The provider returned no usable content.')
    emitUsage(requestId, provider, request.model, usage, emit)
    const value: AdvisorHostedChatResult = {
      provider,
      model: request.model,
      message: { content: state.content, tool_calls: state.calls.slice(0, MAX_TOOL_CALLS) },
      usage,
      streamed: stream,
    }
    emit({ requestId, provider, model: request.model, kind: 'completed', streamed: stream, usage, toolCalls: value.message.tool_calls })
    return value
  } finally { result.dispose() }
}

export function createAdvisorHostedHandlers(options: {
  fetchImpl?: FetchLike
  credentialStatus: CredentialStatusReader
  readCredential: CredentialReader
  emitEvent?: EventEmitter
}): Record<string, (...args: any[]) => Promise<AdvisorHostedEnvelope>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const emitEvent = options.emitEvent ?? (() => {})
  const flights = new Map<string, AbortController>()
  const fail = (error: unknown, fallback: string): AdvisorHostedEnvelope => {
    const safe = safeError(error)
    return { ok: false, error: { kind: error instanceof HostedAdapterError ? safe.code : fallback, message: safe.message } }
  }
  return {
    'metrora:advisorHostedProbe': async (providerValue: unknown, requestIdValue?: unknown): Promise<AdvisorHostedEnvelope> => {
      if (!validProvider(providerValue)) return { ok: false, error: { kind: 'validation', message: 'Advisor hosted provider is invalid.' } }
      if (requestIdValue !== undefined && !validRequestId(requestIdValue)) return { ok: false, error: { kind: 'validation', message: 'Advisor request id is invalid.' } }
      const probeRequestId = typeof requestIdValue === 'string' ? requestIdValue : null
      let status: AdvisorHostedCredentialStatus
      try { status = await options.credentialStatus(providerValue) } catch { status = { provider: providerValue, state: 'locked-unavailable' } }
      if (status.state !== 'ready') return { ok: true, value: { provider: providerValue, available: false, models: [], detail: credentialDetail(status), credentialState: status.state } satisfies AdvisorHostedProbe }
      let secret: string | null
      try { secret = await options.readCredential(providerValue) } catch { secret = null }
      if (!secret) return { ok: true, value: { provider: providerValue, available: false, models: [], detail: 'The saved provider credential needs to be entered again.', credentialState: 'needs-reentry' } satisfies AdvisorHostedProbe }
      const controller = probeRequestId ? new AbortController() : null
      if (controller && probeRequestId) flights.set(probeRequestId, controller)
      try {
        const models = await discover(providerValue, secret, fetchImpl, controller?.signal)
        return { ok: true, value: { provider: providerValue, available: true, models, detail: models.length ? providerDetail(providerValue) : 'The provider is reachable but returned no usable models.', credentialState: 'ready' } satisfies AdvisorHostedProbe }
      } catch (error) {
        if (controller?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return { ok: false, error: { kind: 'cancelled', message: 'Advisor request cancelled.' } }
        const safe = safeError(error)
        const credentialState = error instanceof HostedAdapterError && safe.code === 'credential-invalid' ? 'invalid' : 'ready'
        return { ok: true, value: { provider: providerValue, available: false, models: [], detail: safe.message, credentialState } satisfies AdvisorHostedProbe }
      } finally {
        if (controller && probeRequestId && flights.get(probeRequestId) === controller) flights.delete(probeRequestId)
      }
    },
    'metrora:advisorHostedChat': async (requestIdValue: unknown, requestValue: unknown): Promise<AdvisorHostedEnvelope> => {
      let parsed: { requestId: string; request: AdvisorHostedChatRequest }
      try { parsed = parseChatRequest(requestIdValue, requestValue) } catch (error) { return fail(error, 'validation') }
      let status: AdvisorHostedCredentialStatus
      try { status = await options.credentialStatus(parsed.request.provider) } catch { status = { provider: parsed.request.provider, state: 'locked-unavailable' } }
      if (status.state !== 'ready') return { ok: false, error: { kind: 'credential-unavailable', message: credentialDetail(status) } }
      let secret: string | null
      try { secret = await options.readCredential(parsed.request.provider) } catch { secret = null }
      if (!secret) return { ok: false, error: { kind: 'credential-unavailable', message: 'The saved provider credential needs to be entered again.' } }
      const controller = new AbortController()
      flights.set(parsed.requestId, controller)
      const emit = (event: AdvisorHostedEvent) => emitEvent({ ...event, requestId: parsed.requestId })
      try {
        return { ok: true, value: await hostedChat(parsed.request.provider, secret, parsed.requestId, parsed.request, fetchImpl, emit, controller.signal) }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          emit({ requestId: parsed.requestId, provider: parsed.request.provider, model: parsed.request.model, kind: 'cancelled' })
          return { ok: false, error: { kind: 'cancelled', message: 'Advisor request cancelled.' } }
        }
        const safe = safeError(error)
        emit({ requestId: parsed.requestId, provider: parsed.request.provider, model: parsed.request.model, kind: 'failed', code: safe.code, message: safe.message })
        return { ok: false, error: { kind: safe.code, message: safe.message } }
      } finally {
        if (flights.get(parsed.requestId) === controller) flights.delete(parsed.requestId)
      }
    },
    'metrora:advisorHostedCancel': async (requestIdValue: unknown): Promise<AdvisorHostedEnvelope> => {
      if (!validRequestId(requestIdValue)) return { ok: false, error: { kind: 'validation', message: 'Advisor request id is invalid.' } }
      const controller = flights.get(requestIdValue)
      controller?.abort()
      return { ok: true, value: Boolean(controller) }
    },
  }
}

export const advisorHostedProviderDescriptors = {
  openai: { origin: DESCRIPTORS.openai.origin, modelsPath: DESCRIPTORS.openai.modelsPath, chatPath: '/v1/responses' },
  anthropic: { origin: DESCRIPTORS.anthropic.origin, modelsPath: DESCRIPTORS.anthropic.modelsPath, chatPath: '/v1/messages', anthropicVersion: ANTHROPIC_VERSION },
  gemini: { origin: DESCRIPTORS.gemini.origin, modelsPath: DESCRIPTORS.gemini.modelsPath, chatPath: '/v1beta/models/{model}:generateContent', streamPath: '/v1beta/models/{model}:streamGenerateContent?alt=sse' },
} as const
