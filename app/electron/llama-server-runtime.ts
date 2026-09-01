import { createHash } from 'node:crypto'
import type { AdvisorRuntimeChatPayload, AdvisorRuntimeChatResult } from './advisor-runtime'

export const LLAMA_SERVER_RUNTIME_ID = 'llama-server' as const
export const LLAMA_SERVER_DEFAULT_PORT = 8080
export const LLAMA_SERVER_DEFAULT_ENDPOINT = 'http://127.0.0.1:8080' as const

export type LlamaServerRuntimeOptions = { port?: number }

export function validateLlamaServerPort(value: unknown = LLAMA_SERVER_DEFAULT_PORT): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error('llama-server port must be an integer between 1 and 65535')
  }
  return value
}

export function resolveLlamaServerEndpoint(options: LlamaServerRuntimeOptions = {}): string {
  return 'http://127.0.0.1:' + validateLlamaServerPort(options.port)
}

const PROBE_TIMEOUT_MS = 1_500
const CHAT_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MESSAGE_BYTES = 32_000
const MAX_STREAM_CHUNKS = 512
const MAX_MALFORMED_CHUNKS = 16
const MAX_TOOL_CALLS = 16
// A model handle is only meaningful for the endpoint that advertised it. Do
// not let a probe on one local port replace or reuse the trusted raw-id route
// belonging to another port.
const modelRoutes = new Map<string, Map<string, string>>()

export type LlamaServerRuntimeProbe = {
  runtime: typeof LLAMA_SERVER_RUNTIME_ID
  available: boolean
  models: string[]
  modelLabels: Record<string, string>
  detail: string
  discoveryState: 'runtime-unavailable' | 'runtime-available' | 'no-models' | 'models-discovered'
  capabilities: Array<{
    schemaVersion: 1
    runtime: typeof LLAMA_SERVER_RUNTIME_ID
    modelId: string
    discovery: 'discovered'
    conversational: 'available'
    toolCall: 'unknown' | 'supported'
    streaming: 'supported'
    limitation: string
  }>
}

type FetchLike = typeof fetch
type RecordValue = Record<string, unknown>

class LlamaServerHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super('Local llama-server returned HTTP ' + status + '.')
    this.name = 'LlamaServerHttpError'
    this.status = status
  }
}

class LlamaServerTimeoutError extends Error {
  constructor() {
    super('Local llama-server request timed out.')
    this.name = 'LlamaServerTimeoutError'
  }
}

export function validateLlamaServerEndpoint(endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): string {
  if (typeof endpoint !== 'string' || endpoint.length > 256 || /[\u0000-\u001f\u007f]/u.test(endpoint)) throw new Error('llama-server endpoint is invalid')
  let parsed: URL
  try { parsed = new URL(endpoint) } catch { throw new Error('llama-server endpoint is invalid') }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(hostname)) throw new Error('llama-server endpoint must use an allowed loopback host')
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) throw new Error('llama-server endpoint must not contain credentials, query, fragment, or path')
  const port = parsed.port ? Number(parsed.port) : LLAMA_SERVER_DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('llama-server endpoint port is invalid')
  const displayHost = hostname === '::1' ? '[::1]' : hostname
  return `http://${displayHost}:${port}`
}

function endpointUrl(path: string, endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): string {
  const base = validateLlamaServerEndpoint(endpoint)
  if (!/^\/[A-Za-z0-9._~:/-]{1,80}$/u.test(path)) throw new Error('llama-server path is invalid')
  return new URL(path, base).toString()
}

function isRecord(value: unknown): value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength }

function boundedMessageContent(value: string): string {
  if (byteLength(value) > MAX_MESSAGE_BYTES) throw new Error('Local llama-server message exceeded the content limit.')
  return value
}

function abortError(): Error { const error = new Error('The operation was aborted.'); error.name = 'AbortError'; return error }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError() }

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; didTimeout: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, didTimeout: () => timedOut, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('Local llama-server response exceeded the safety limit.')
    return text
  }
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local llama-server response exceeded the safety limit.')
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

async function fetchJson(fetchImpl: FetchLike, path: string, init: RequestInit, timeoutMs: number, parent?: AbortSignal, endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): Promise<RecordValue> {
  const timed = timeoutSignal(parent, timeoutMs)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(endpointUrl(path, endpoint), { ...init, redirect: 'error', signal: timed.signal })
    throwIfAborted(timed.signal)
    if (!response.ok) throw new LlamaServerHttpError(response.status)
    const text = await boundedText(response)
    const value = JSON.parse(text) as unknown
    if (!isRecord(value)) throw new Error('Local llama-server returned invalid JSON.')
    return value
  } catch (error) {
    if (timed.didTimeout() && !parent?.aborted) throw new LlamaServerTimeoutError()
    throw error
  } finally { timed.dispose() }
}

function validModelId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && byteLength(value) <= 200 && !/[\u0000-\u001f\u007f]/u.test(value)
}

function safeModelAlias(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)
}

function modelLabel(rawId: string): string {
  if (safeModelAlias(rawId)) return rawId
  const leaf = rawId.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? ''
  const safe = leaf.replace(/[^A-Za-z0-9._:@+-]/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 96)
  return safe && safe !== '.' && safe !== '..' ? safe : 'Local model'
}

function modelHandle(rawId: string): string {
  if (safeModelAlias(rawId)) return rawId
  return 'llama-server:model:' + createHash('sha256').update(rawId).digest('hex').slice(0, 24)
}

function modelRows(payload: RecordValue, endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): { models: string[]; labels: Record<string, string> } {
  const routes = new Map<string, string>()
  modelRoutes.set(endpoint, routes)
  if (!Array.isArray(payload.data)) return { models: [], labels: {} }
  const projected = new Map<string, string>()
  for (const row of payload.data) {
    if (!isRecord(row) || !validModelId(row.id)) continue
    const rawId = row.id.trim()
    const handle = modelHandle(rawId)
    if (!projected.has(handle)) projected.set(handle, modelLabel(rawId))
    routes.set(handle, rawId)
  }
  const entries = [...projected.entries()].slice(0, 32)
  return { models: entries.map(([handle]) => handle), labels: Object.fromEntries(entries) }
}

function capability(modelId: string): LlamaServerRuntimeProbe['capabilities'][number] {
  return {
    schemaVersion: 1,
    runtime: LLAMA_SERVER_RUNTIME_ID,
    modelId,
    discovery: 'discovered',
    conversational: 'available',
    toolCall: 'unknown',
    streaming: 'supported',
    limitation: 'Streaming is supported by the OpenAI-compatible endpoint. Tool-call support depends on the loaded chat template and parser and remains unverified in this session.',
  }
}

type ProbeStage = 'health' | 'models'

function loopbackLocation(endpoint: string): string {
  const parsed = new URL(endpoint)
  const host = parsed.hostname === '::1' ? '[::1]' : parsed.hostname
  return `${host}:${parsed.port || String(LLAMA_SERVER_DEFAULT_PORT)}`
}

function nestedErrorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object') return ''
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return ''
}

function isLoopbackConnectionFailure(error: unknown): boolean {
  const code = nestedErrorCode(error)
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return true
  const message = error instanceof Error ? error.message : String(error)
  return /fetch failed|connection refused|connection reset|host unreachable|network is unreachable|could not connect/iu.test(message)
}

function probeFailureDetail(error: unknown, stage: ProbeStage, endpoint: string): string {
  const location = loopbackLocation(endpoint)
  const label = stage === 'health' ? 'llama-server health check' : 'llama-server model listing'
  if (error instanceof LlamaServerTimeoutError) return `${label} timed out on loopback ${location}.`
  if (error instanceof LlamaServerHttpError) {
    if (stage === 'health' && error.status === 503) return `llama-server is reachable on loopback ${location} but is still loading a model.`
    return `${label} returned HTTP ${error.status} on loopback ${location}.`
  }
  if (isLoopbackConnectionFailure(error)) return `Could not connect to llama-server at loopback ${location}; check that the server is running.`
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid JSON/iu.test(message)) return `${label} returned invalid JSON on loopback ${location}.`
  return `${label} failed on loopback ${location}.`
}

export async function probeLlamaServerMain(fetchImpl: FetchLike = fetch, parent?: AbortSignal, options: LlamaServerRuntimeOptions = {}): Promise<LlamaServerRuntimeProbe> {
  const endpoint = resolveLlamaServerEndpoint(options)
  // A failed or empty reprobe must not leave a previous model handle usable
  // on the same port. The route map is rebuilt only from the current model
  // listing.
  modelRoutes.delete(endpoint)
  if (!fetchImpl) return { runtime: LLAMA_SERVER_RUNTIME_ID, available: false, models: [], modelLabels: {}, detail: 'Node fetch is unavailable.', discoveryState: 'runtime-unavailable', capabilities: [] }
  let stage: ProbeStage = 'health'
  try {
    await fetchJson(fetchImpl, '/health', { method: 'GET' }, PROBE_TIMEOUT_MS, parent, endpoint)
    stage = 'models'
    const modelsPayload = await fetchJson(fetchImpl, '/v1/models', { method: 'GET' }, PROBE_TIMEOUT_MS, parent, endpoint)
    const projected = modelRows(modelsPayload, endpoint)
    if (!projected.models.length) return { runtime: LLAMA_SERVER_RUNTIME_ID, available: false, models: [], modelLabels: {}, detail: 'llama-server is reachable but has no loaded model.', discoveryState: 'no-models', capabilities: [] }
    return { runtime: LLAMA_SERVER_RUNTIME_ID, available: true, models: projected.models, modelLabels: projected.labels, detail: 'Local llama-server is reachable on loopback.', discoveryState: 'models-discovered', capabilities: projected.models.map(capability) }
  } catch (error) {
    if (parent?.aborted) throw error
    const detail = probeFailureDetail(error, stage, endpoint)
    return { runtime: LLAMA_SERVER_RUNTIME_ID, available: false, models: [], modelLabels: {}, detail, discoveryState: 'runtime-unavailable', capabilities: [] }
  }
}

function parseToolCalls(value: unknown): Array<RecordValue> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Local llama-server tool_calls must be an array.')
  return value.slice(0, MAX_TOOL_CALLS).map(call => {
    if (!isRecord(call) || !isRecord(call.function) || typeof call.function.name !== 'string' || !call.function.name.trim()) throw new Error('Local llama-server returned a malformed tool call.')
    const args = call.function.arguments
    if (args !== undefined && typeof args !== 'string' && !isRecord(args)) throw new Error('Local llama-server returned malformed tool arguments.')
    if (typeof args === 'string' && byteLength(args) > MAX_MESSAGE_BYTES) throw new Error('Local llama-server tool arguments exceeded the content limit.')
    return { function: { name: call.function.name, ...(args !== undefined ? { arguments: args } : {}) } }
  })
}

function normalizeMessage(message: RecordValue): AdvisorRuntimeChatResult['message'] {
  if (message.content !== undefined && typeof message.content !== 'string') throw new Error('Local llama-server returned malformed message content.')
  const toolCalls = parseToolCalls(message.tool_calls)
  if (message.content === undefined && toolCalls.length === 0) throw new Error('Local llama-server returned an empty message.')
  return { content: typeof message.content === 'string' ? boundedMessageContent(message.content) : '', tool_calls: toolCalls }
}

function parseChatResponse(value: unknown): AdvisorRuntimeChatResult {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) throw new Error('Local llama-server response was malformed.')
  const choice = value.choices[0]
  if (!isRecord(choice.message)) throw new Error('Local llama-server response message was malformed.')
  return { message: normalizeMessage(choice.message), streamed: false }
}

function parseSseEvent(data: string, state: { content: string; toolCalls: Array<RecordValue>; malformed: number; valid: boolean }, onDelta?: (text: string) => void): void {
  if (!data || data === '[DONE]') return
  let value: unknown
  try { value = JSON.parse(data) as unknown } catch {
    state.malformed += 1
    if (state.malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local llama-server stream contained too many malformed chunks.')
    return
  }
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) {
    state.malformed += 1
    if (state.malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local llama-server stream contained malformed events.')
    return
  }
  const delta = isRecord(value.choices[0].delta) ? value.choices[0].delta : null
  if (!delta) return
  state.valid = true
  if (typeof delta.content === 'string') {
    state.content += delta.content
    boundedMessageContent(state.content)
    onDelta?.(delta.content)
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      if (!isRecord(call) || typeof call.index !== 'number' || !Number.isSafeInteger(call.index) || call.index < 0 || call.index >= MAX_TOOL_CALLS) throw new Error('Local llama-server returned malformed streaming tool calls.')
      const index = call.index
      const current = state.toolCalls[index] ?? { function: { name: '', arguments: '' } }
      const fn = isRecord(call.function) ? call.function : {}
      const currentFunction = isRecord(current.function) ? current.function : {}
      const nextFunction = {
        ...currentFunction,
        ...(typeof fn.name === 'string' ? { name: fn.name } : {}),
        ...(typeof fn.arguments === 'string' ? { arguments: String(currentFunction.arguments ?? '') + fn.arguments } : {}),
      }
      current.function = nextFunction
      state.toolCalls[index] = current
    }
  }
}

async function streamResponse(response: Response, onDelta?: (text: string) => void): Promise<AdvisorRuntimeChatResult> {
  const reader = response.body?.getReader()
  if (!reader) {
    const state = { content: '', toolCalls: [], malformed: 0, valid: false }
    for (const line of (await boundedText(response)).split(/\r?\n/gu)) if (line.startsWith('data:')) parseSseEvent(line.slice(5).trim(), state, onDelta)
    if (!state.valid) throw new Error('Local llama-server stream contained no valid messages.')
    return { message: { content: state.content, tool_calls: parseToolCalls(state.toolCalls.filter(Boolean)) }, streamed: true }
  }
  const decoder = new TextDecoder()
  const state = { content: '', toolCalls: [] as Array<RecordValue>, malformed: 0, valid: false }
  let pending = ''
  let bytes = 0
  let chunks = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local llama-server response exceeded the safety limit.')
    pending += decoder.decode(part.value, { stream: true })
    const lines = pending.split(/\r?\n/gu)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      chunks += 1
      if (chunks > MAX_STREAM_CHUNKS) throw new Error('Local llama-server stream exceeded the chunk limit.')
      parseSseEvent(line.slice(5).trim(), state, onDelta)
    }
  }
  pending += decoder.decode()
  if (pending.startsWith('data:')) parseSseEvent(pending.slice(5).trim(), state, onDelta)
  if (!state.valid) throw new Error('Local llama-server stream contained no valid messages.')
  return { message: { content: state.content, tool_calls: parseToolCalls(state.toolCalls.filter(Boolean)) }, streamed: true }
}

function openAIMessageList(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const callIds: string[] = []
  let nextId = 0
  return messages.map(message => {
    if (!isRecord(message)) throw new Error('Local llama-server request contains a malformed message.')
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      const toolCalls = message.tool_calls.slice(0, MAX_TOOL_CALLS).map(call => {
        if (!isRecord(call) || !isRecord(call.function) || typeof call.function.name !== 'string') throw new Error('Local llama-server request contains a malformed tool call.')
        const id = 'metrora_call_' + nextId++
        callIds.push(id)
        const args = typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments ?? {})
        return { id, type: 'function', function: { name: call.function.name, arguments: args } }
      })
      return { role: 'assistant', content: typeof message.content === 'string' ? message.content : '', tool_calls: toolCalls }
    }
    if (message.role === 'tool') {
      const toolCallId = callIds.shift() ?? 'metrora_call_' + nextId++
      return { role: 'tool', content: typeof message.content === 'string' ? message.content : '', tool_call_id: toolCallId }
    }
    return { role: message.role, content: message.content }
  })
}

function validatePayload(value: unknown): asserts value is AdvisorRuntimeChatPayload {
  if (!isRecord(value) || !validModelId(value.model)) throw new Error('Local llama-server model is invalid.')
  if (!Array.isArray(value.messages) || !Array.isArray(value.tools) || value.messages.length > 32 || value.tools.length > 12) throw new Error('Local llama-server request exceeded the safety limit.')
  if (typeof value.stream !== 'boolean') throw new Error('Local llama-server stream flag is invalid.')
  for (const message of value.messages) {
    if (!isRecord(message) || typeof message.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('Local llama-server request contains a malformed message.')
    if (typeof message.content !== 'string') throw new Error('Local llama-server request contains malformed message content.')
    boundedMessageContent(message.content)
    if (message.tool_calls !== undefined) parseToolCalls(message.tool_calls)
  }
  for (const tool of value.tools) {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function) || typeof tool.function.name !== 'string' || !tool.function.name.trim()) throw new Error('Local llama-server request contains a malformed tool definition.')
    if (tool.function.parameters !== undefined && !isRecord(tool.function.parameters)) throw new Error('Local llama-server request contains malformed tool parameters.')
  }
}

function resolveModelRoute(value: string, endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): string {
  const model = value.trim()
  const trusted = modelRoutes.get(endpoint)?.get(model)
  if (trusted) return trusted
  if (model.startsWith('llama-server:model:')) throw new Error('Local llama-server model must be a discovered safe handle for the selected endpoint.')
  if (safeModelAlias(model)) return model
  throw new Error('Local llama-server model must be a discovered safe handle or bounded alias.')
}

export async function chatLlamaServerMain(fetchImpl: FetchLike, payload: AdvisorRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void, options: LlamaServerRuntimeOptions = {}): Promise<AdvisorRuntimeChatResult> {
  if (!fetchImpl) throw new Error('Node fetch is unavailable.')
  const endpoint = resolveLlamaServerEndpoint(options)
  validatePayload(payload)
  const routedModel = resolveModelRoute(payload.model, endpoint)
  const body = {
    model: routedModel,
    messages: openAIMessageList(payload.messages),
    ...(payload.tools.length ? { tools: payload.tools } : {}),
    stream: payload.stream,
  }
  const encoded = JSON.stringify(body)
  if (byteLength(encoded) > MAX_RESPONSE_BYTES) throw new Error('Local llama-server request exceeded the safety limit.')
  const timed = timeoutSignal(parent, CHAT_TIMEOUT_MS)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(endpointUrl('/v1/chat/completions', endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: encoded,
      redirect: 'error',
      signal: timed.signal,
    })
    throwIfAborted(timed.signal)
    if (!response.ok) throw new LlamaServerHttpError(response.status)
    return payload.stream ? await streamResponse(response, onDelta) : parseChatResponse(JSON.parse(await boundedText(response)) as unknown)
  } finally { timed.dispose() }
}
