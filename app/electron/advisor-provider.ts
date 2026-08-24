import type { AdvisorCredentialProvider, AdvisorCredentialState } from './advisor-credentials'


export type AdvisorHostedProviderId = AdvisorCredentialProvider
export type AdvisorHostedCredentialStatus = { provider: AdvisorHostedProviderId; state: AdvisorCredentialState }
export type AdvisorHostedModelState = 'discovered' | 'unverified' | 'verified' | 'limited' | 'unsupported' | 'failed-conformance'
export type AdvisorHostedModel = { id: string; label: string; state: AdvisorHostedModelState; limitation: string | null }
export type AdvisorHostedProbe = { provider: AdvisorHostedProviderId; available: boolean; models: AdvisorHostedModel[]; detail: string; credentialState: AdvisorCredentialState }
export type AdvisorHostedUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
export type AdvisorHostedToolCall = { id: string; name: string; arguments: string }
export type AdvisorHostedEventKind = 'started' | 'text-delta' | 'tool-call-start' | 'tool-call-delta' | 'tool-call-complete' | 'usage' | 'completed' | 'failed' | 'cancelled'
export type AdvisorHostedEvent = {
  requestId: string
  provider: AdvisorHostedProviderId
  model: string
  kind: AdvisorHostedEventKind
  text?: string
  callId?: string
  name?: string
  delta?: string
  arguments?: string
  usage?: AdvisorHostedUsage | null
  streamed?: boolean
  toolCalls?: AdvisorHostedToolCall[]
  code?: string
  message?: string
}
export type AdvisorHostedChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; toolName?: string }
export type AdvisorHostedToolDefinition = { type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }
export type AdvisorHostedChatRequest = { provider: AdvisorHostedProviderId; model: string; messages: AdvisorHostedChatMessage[]; tools?: AdvisorHostedToolDefinition[]; stream?: boolean }
export type AdvisorHostedChatResult = { provider: AdvisorHostedProviderId; model: string; message: { content: string; tool_calls: AdvisorHostedToolCall[] }; usage: AdvisorHostedUsage | null; streamed: boolean }
export type AdvisorHostedEnvelope = { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }

type FetchLike = typeof fetch
type CredentialReader = (provider: AdvisorHostedProviderId) => Promise<string | null>
type CredentialStatusReader = (provider: AdvisorHostedProviderId) => Promise<AdvisorHostedCredentialStatus>
type EventEmitter = (event: AdvisorHostedEvent) => void

const MAX_REQUEST_BYTES = 128 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_BYTES = 32 * 1024
const MAX_TOOL_ARGUMENT_BYTES = 8 * 1024
const MAX_MESSAGES = 32
const MAX_TOOLS = 7
const MAX_TOOL_CALLS = 8
const MAX_MODELS = 128
const MAX_SSE_EVENTS = 512
const REQUEST_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 10_000
const ANTHROPIC_VERSION = '2023-06-01'
const TOOL_NAMES = new Set([
  'get_spend_snapshot',
  'get_model_efficiency',
  'get_quota_snapshot',
  'get_overview_snapshot',
  'get_project_drivers',
  'get_session_highlights',
  'get_coverage_report',
])

const DESCRIPTORS: Record<AdvisorHostedProviderId, { origin: string; modelsPath: string; chatPath: (model: string, stream: boolean) => string }> = {
  openai: { origin: 'https://api.openai.com', modelsPath: '/v1/models', chatPath: () => '/v1/responses' },
  anthropic: { origin: 'https://api.anthropic.com', modelsPath: '/v1/models', chatPath: () => '/v1/messages' },
  gemini: {
    origin: 'https://generativelanguage.googleapis.com',
    modelsPath: '/v1beta/models',
    chatPath: (model, stream) => '/v1beta/models/' + encodeURIComponent(model.replace(/^models\//u, '')) + ':' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent'),
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength }
function boundedString(value: unknown, limit: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || byteLength(value) > limit) throw new HostedAdapterError('request-malformed', label)
  return value
}
function validProvider(value: unknown): value is AdvisorHostedProviderId { return value === 'openai' || value === 'anthropic' || value === 'gemini' }
function validRequestId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value) }
function validModel(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u.test(value) }
function safeModelLabel(value: string): string { return value.replace(/^models\//u, '') }
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('Advisor request cancelled.')
    error.name = 'AbortError'
    throw error
  }
}

export class HostedAdapterError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'HostedAdapterError'; this.code = code }
}
function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof HostedAdapterError) return { code: error.code, message: error.message }
  if (error instanceof Error && error.name === 'AbortError') return { code: 'cancelled', message: 'Advisor request cancelled.' }
  return { code: 'provider-unavailable', message: 'The selected provider is unavailable.' }
}
function providerHttpError(status: number): HostedAdapterError {
  if (status === 401) return new HostedAdapterError('credential-invalid', 'The provider rejected the saved credential.')
  if (status === 403) return new HostedAdapterError('provider-denied', 'The provider denied this request.')
  if (status === 404) return new HostedAdapterError('model-unavailable', 'The selected provider model is unavailable.')
  if (status === 429) return new HostedAdapterError('rate-limited', 'The provider rate-limited this request.')
  return new HostedAdapterError('provider-unavailable', 'The provider request failed.')
}
function providerUrl(provider: AdvisorHostedProviderId, path: string): string {
  const url = new URL(path, DESCRIPTORS[provider].origin)
  if (url.protocol !== 'https:' || url.origin !== DESCRIPTORS[provider].origin) throw new HostedAdapterError('provider-unavailable', 'The provider endpoint is not approved.')
  return url.toString()
}
function authHeaders(provider: AdvisorHostedProviderId, secret: string): Record<string, string> {
  if (provider === 'openai') return { Authorization: 'Bearer ' + secret }
  if (provider === 'anthropic') return { 'x-api-key': secret, 'anthropic-version': ANTHROPIC_VERSION }
  return { 'x-goog-api-key': secret }
}
function requestHeaders(provider: AdvisorHostedProviderId, secret: string, stream: boolean): Record<string, string> {
  return { Accept: stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json', ...authHeaders(provider, secret) }
}
function timeoutRequest(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}
async function fetchResponse(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, parent?: AbortSignal): Promise<{ response: Response; dispose: () => void }> {
  const timed = timeoutRequest(parent, timeoutMs)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: timed.signal })
    throwIfAborted(timed.signal)
    return { response, dispose: timed.dispose }
  } catch (error) {
    timed.dispose()
    if (timed.signal.aborted) {
      const cancelled = new Error('Advisor request cancelled.')
      cancelled.name = 'AbortError'
      throw cancelled
    }
    throw error
  }
}
async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (byteLength(text) > MAX_RESPONSE_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
    return text
  }
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
    text += decoder.decode(part.value, { stream: true })
  }
  return text + decoder.decode()
}
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await readBoundedText(response)
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) throw new Error()
    return parsed
  } catch { throw new HostedAdapterError('response-malformed', 'The provider response was malformed.') }
}
function statusCheck(response: Response): void { if (!response.ok) throw providerHttpError(response.status) }
function boundedJson(value: unknown, message: string): string {
  let text: string
  try { text = JSON.stringify(value) } catch { throw new HostedAdapterError('request-malformed', message) }
  if (!text || byteLength(text) > MAX_REQUEST_BYTES) throw new HostedAdapterError('request-too-large', message)
  return text
}
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : null }
function usageFrom(input: unknown, output: unknown, total: unknown = undefined): AdvisorHostedUsage | null {
  const inputTokens = numberOrNull(input)
  const outputTokens = numberOrNull(output)
  const totalTokens = numberOrNull(total) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null)
  return inputTokens === null && outputTokens === null && totalTokens === null ? null : { inputTokens, outputTokens, totalTokens }
}
function mergeUsage(previous: AdvisorHostedUsage | null, next: AdvisorHostedUsage | null): AdvisorHostedUsage | null {
  if (!next) return previous
  return { inputTokens: next.inputTokens ?? previous?.inputTokens ?? null, outputTokens: next.outputTokens ?? previous?.outputTokens ?? null, totalTokens: next.totalTokens ?? previous?.totalTokens ?? null }
}
function emitUsage(requestId: string, provider: AdvisorHostedProviderId, model: string, usage: AdvisorHostedUsage | null, emit: EventEmitter): void {
  if (usage) emit({ requestId, provider, model, kind: 'usage', usage })
}
function toolName(value: unknown): string { return typeof value === 'string' && /^[A-Za-z0-9_:-]{1,96}$/u.test(value) ? value : '' }
function toolArguments(value: unknown): string {
  if (typeof value === 'string') {
    if (byteLength(value) > MAX_TOOL_ARGUMENT_BYTES) throw new HostedAdapterError('tool-malformed', 'The provider returned oversized tool arguments.')
    try { JSON.parse(value) } catch { throw new HostedAdapterError('tool-malformed', 'The provider returned malformed tool arguments.') }
    return value
  }
  const text = boundedJson(value, 'The provider returned malformed tool arguments.')
  if (byteLength(text) > MAX_TOOL_ARGUMENT_BYTES) throw new HostedAdapterError('tool-malformed', 'The provider returned oversized tool arguments.')
  return text
}
function normalizeToolCall(id: unknown, name: unknown, args: unknown): AdvisorHostedToolCall {
  const normalizedName = toolName(name)
  if (!normalizedName || !TOOL_NAMES.has(normalizedName)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
  return { id: boundedString(typeof id === 'string' ? id : 'tool-call', 128, 'The provider returned an invalid tool call id.'), name: normalizedName, arguments: toolArguments(args ?? '{}') }
}
function emitToolCall(call: AdvisorHostedToolCall, requestId: string, provider: AdvisorHostedProviderId, model: string, emit: EventEmitter): void {
  emit({ requestId, provider, model, kind: 'tool-call-start', callId: call.id, name: call.name })
  emit({ requestId, provider, model, kind: 'tool-call-complete', callId: call.id, name: call.name, arguments: call.arguments })
}
function normalizeTools(tools: unknown): AdvisorHostedToolDefinition[] {
  if (tools === undefined) return []
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw new HostedAdapterError('request-malformed', 'Advisor tools are malformed.')
  return tools.map(value => {
    if (!isRecord(value) || value.type !== 'function' || !isRecord(value.function)) throw new HostedAdapterError('request-malformed', 'Only Metrora function tools are supported.')
    const name = toolName(value.function.name)
    if (!name || !TOOL_NAMES.has(name)) throw new HostedAdapterError('tool-unsupported', 'Only Metrora read-only Advisor tools are supported.')
    const description = value.function.description === undefined ? undefined : boundedString(value.function.description, 1024, 'Advisor tool description is too large.')
    const parameters = value.function.parameters === undefined ? undefined : value.function.parameters
    if (parameters !== undefined && !isRecord(parameters)) throw new HostedAdapterError('request-malformed', 'Advisor tool parameters are malformed.')
    return { type: 'function', function: { name, ...(description ? { description } : {}), ...(parameters ? { parameters } : {}) } }
  })
}
function normalizeMessages(value: unknown): AdvisorHostedChatMessage[] {
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) throw new HostedAdapterError('request-malformed', 'Advisor messages are malformed.')
  return value.map(item => {
    if (!isRecord(item) || !['system', 'user', 'assistant', 'tool'].includes(String(item.role))) throw new HostedAdapterError('request-malformed', 'Advisor messages are malformed.')
    const role = item.role as AdvisorHostedChatMessage['role']
    const content = boundedString(item.content, 32_000, 'Advisor message content is too large.')
    const toolCallId = item.toolCallId === undefined ? undefined : boundedString(item.toolCallId, 128, 'Advisor tool call id is invalid.')
    const toolNameValue = item.toolName === undefined ? undefined : boundedString(item.toolName, 96, 'Advisor tool name is invalid.')
    if (role === 'tool' && !toolCallId) throw new HostedAdapterError('request-malformed', 'Advisor tool results require a call id.')
    return { role, content, ...(toolCallId ? { toolCallId } : {}), ...(toolNameValue ? { toolName: toolNameValue } : {}) }
  })
}
function parseChatRequest(requestId: unknown, value: unknown): { requestId: string; request: AdvisorHostedChatRequest } {
  if (!validRequestId(requestId) || !isRecord(value) || !validProvider(value.provider) || !validModel(value.model)) throw new HostedAdapterError('request-malformed', 'Advisor hosted request is invalid.')
  return {
    requestId,
    request: {
      provider: value.provider,
      model: value.model,
      messages: normalizeMessages(value.messages),
      tools: normalizeTools(value.tools),
      stream: value.stream === undefined ? true : value.stream === true,
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
  const input = request.messages.filter(message => message.role !== 'system').map(message => message.role === 'tool'
    ? { type: 'function_call_output', call_id: message.toolCallId, output: message.content }
    : { role: message.role, content: message.content })
  return { model: request.model, ...(system ? { instructions: system } : {}), input, ...(request.tools?.length ? { tools: openAiTools(request.tools) } : {}), stream: request.stream === true }
}
function anthropicBody(request: AdvisorHostedChatRequest): Record<string, unknown> {
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  const messages = request.messages.filter(message => message.role !== 'system').map(message => message.role === 'tool'
    ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }] }
    : { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content })
  return { model: request.model, max_tokens: 2048, ...(system ? { system } : {}), messages, ...(request.tools?.length ? { tools: anthropicTools(request.tools) } : {}), stream: request.stream === true }
}
function geminiBody(request: AdvisorHostedChatRequest): Record<string, unknown> {
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  const contents = request.messages.filter(message => message.role !== 'system').map(message => message.role === 'tool'
    ? { role: 'user', parts: [{ functionResponse: { name: message.toolName ?? message.toolCallId, response: { content: message.content } } }] }
    : { role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })
  return { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, ...(request.tools?.length ? { tools: geminiTools(request.tools) } : {}) }
}
function bodyFor(provider: AdvisorHostedProviderId, request: AdvisorHostedChatRequest): Record<string, unknown> {
  if (provider === 'openai') return openAiBody(request)
  if (provider === 'anthropic') return anthropicBody(request)
  return geminiBody(request)
}


function modelRows(provider: AdvisorHostedProviderId, payload: Record<string, unknown>): AdvisorHostedModel[] {
  const rows = provider === 'gemini' ? payload.models : payload.data
  if (!Array.isArray(rows)) throw new HostedAdapterError('response-malformed', 'The provider model listing was malformed.')
  const models: AdvisorHostedModel[] = []
  const seen = new Set<string>()
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
  return models
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
    const id = boundedString(typeof payload.item.call_id === 'string' ? payload.item.call_id : payload.item.id, 128, 'The provider returned an invalid tool call id.')
    const name = toolName(payload.item.name)
    if (!name || !TOOL_NAMES.has(name)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
    if (state.openCalls.has(id)) throw new HostedAdapterError('tool-malformed', 'The provider returned a duplicate tool call.')
    state.openCalls.set(id, { id, name, arguments: '' })
    state.openCallKeys.set(id, id)
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
  const request = await fetchResponse(fetchImpl, providerUrl(provider, descriptor.modelsPath), { method: 'GET', headers: { Accept: 'application/json', ...authHeaders(provider, secret) } }, PROBE_TIMEOUT_MS, parent)
  try {
    statusCheck(request.response)
    return modelRows(provider, await readJson(request.response))
  } finally { request.dispose() }
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
    'metrora:advisorHostedProbe': async (providerValue: unknown): Promise<AdvisorHostedEnvelope> => {
      if (!validProvider(providerValue)) return { ok: false, error: { kind: 'validation', message: 'Advisor hosted provider is invalid.' } }
      let status: AdvisorHostedCredentialStatus
      try { status = await options.credentialStatus(providerValue) } catch { status = { provider: providerValue, state: 'locked-unavailable' } }
      if (status.state !== 'ready') return { ok: true, value: { provider: providerValue, available: false, models: [], detail: credentialDetail(status), credentialState: status.state } satisfies AdvisorHostedProbe }
      let secret: string | null
      try { secret = await options.readCredential(providerValue) } catch { secret = null }
      if (!secret) return { ok: true, value: { provider: providerValue, available: false, models: [], detail: 'The saved provider credential needs to be entered again.', credentialState: 'needs-reentry' } satisfies AdvisorHostedProbe }
      try {
        const models = await discover(providerValue, secret, fetchImpl)
        return { ok: true, value: { provider: providerValue, available: true, models, detail: models.length ? providerDetail(providerValue) : 'The provider is reachable but returned no usable models.', credentialState: 'ready' } satisfies AdvisorHostedProbe }
      } catch (error) {
        const safe = safeError(error)
        const credentialState = error instanceof HostedAdapterError && safe.code === 'credential-invalid' ? 'invalid' : 'ready'
        return { ok: true, value: { provider: providerValue, available: false, models: [], detail: safe.message, credentialState } satisfies AdvisorHostedProbe }
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
