import { chatLMStudioMain, probeLMStudioMain } from './lmstudio-runtime'
import { chatLlamaServerMain, probeLlamaServerMain, validateLlamaServerPort, type LlamaServerRuntimeOptions } from './llama-server-runtime'
const LOOPBACK_ENDPOINT = 'http://127.0.0.1:11434'
const PROBE_TIMEOUT_MS = 1500
const CHAT_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_STREAM_CHUNKS = 512
const MAX_MALFORMED_CHUNKS = 16

export type AdvisorRuntimeProbe = { runtime?: 'ollama' | 'lmstudio' | 'llama-server'; available: boolean; models: string[]; modelLabels?: Record<string, string>; detail: string; discoveryState?: 'runtime-unavailable' | 'runtime-available' | 'no-models' | 'models-discovered'; capabilities?: Array<Record<string, unknown>> }
export type AdvisorRuntimeChatPayload = {
  model: string
  messages: Array<Record<string, unknown>>
  tools: Array<Record<string, unknown>>
  stream: boolean
}
export type AdvisorRuntimeChatResult = { message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean }
type FetchLike = typeof fetch

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
function boundedMessageContent(value: string): string {
  if (byteLength(value) > 32_000) throw new Error('Local runtime message exceeded the content limit.')
  return value
}

function boundedError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error)
  return new Error(raw.replace(/[\r\n]+/g, ' ').replace(/[A-Za-z]:\\[^ ]+|\/[^ ]+/g, '[local path]').slice(0, 240))
}
function validModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/.test(model)
}
function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}
function timeoutSignal(parent?: AbortSignal, timeoutMs = CHAT_TIMEOUT_MS): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('Local runtime response exceeded the safety limit.')
    return text
  }
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local runtime response exceeded the safety limit.')
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}
async function fetchJson(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, parent?: AbortSignal): Promise<Record<string, unknown>> {
  const timed = timeoutSignal(parent, timeoutMs)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: timed.signal })
    throwIfAborted(timed.signal)
    if (!response.ok) throw new Error('Local runtime returned HTTP ' + response.status + '.')
    const text = await boundedText(response)
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object') throw new Error('Local runtime returned invalid JSON.')
    return value as Record<string, unknown>
  } finally { timed.dispose() }
}
export async function probeOllamaMain(fetchImpl: FetchLike = fetch, parent?: AbortSignal): Promise<AdvisorRuntimeProbe> {
  if (!fetchImpl) return { available: false, models: [], detail: 'Node fetch is unavailable.' }
  try {
    const payload = await fetchJson(fetchImpl, LOOPBACK_ENDPOINT + '/api/tags', {}, PROBE_TIMEOUT_MS, parent)
    const rows = Array.isArray(payload.models) ? payload.models : []
    const models = rows.flatMap(row => row && typeof row === 'object' && typeof (row as { name?: unknown }).name === 'string' ? [(row as { name: string }).name] : [])
    const capabilities = models.map(modelId => ({ schemaVersion: 1, runtime: 'ollama', modelId, discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', limitation: 'Tool-call support is unknown until this model passes a bounded Advisor conformance check.' }))
    return models.length ? { available: true, models, detail: 'Local Ollama is reachable.', capabilities } : { available: false, models: [], detail: 'Ollama is reachable but has no local models.', capabilities: [] }
  } catch (error) {
    if (parent?.aborted) throw error
    return { available: false, models: [], detail: boundedError(error).message }
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function parseToolCalls(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Local runtime tool_calls must be an array.')
  return value.slice(0, 16).map(call => {
    if (!isRecord(call) || !isRecord(call.function) || typeof call.function.name !== 'string' || !call.function.name.trim()) {
      throw new Error('Local runtime returned a malformed tool call.')
    }
    const args = call.function.arguments
    if (args !== undefined && typeof args !== 'string' && !isRecord(args)) throw new Error('Local runtime returned malformed tool arguments.')
    return { function: { name: call.function.name, ...(args !== undefined ? { arguments: args } : {}) } }
  })
}
function messageResult(raw: Record<string, unknown>, streamed: boolean): AdvisorRuntimeChatResult {
  if (!isRecord(raw.message)) throw new Error('Local runtime returned a malformed message.')
  const message = raw.message
  if (message.content !== undefined && typeof message.content !== 'string') throw new Error('Local runtime returned malformed message content.')
  const toolCalls = parseToolCalls(message.tool_calls)
  if (message.content === undefined && toolCalls.length === 0) throw new Error('Local runtime returned an empty message.')
  return {
    message: {
      content: typeof message.content === 'string' ? boundedMessageContent(message.content) : '',
      tool_calls: toolCalls,
    },
    streamed,
  }
}
function parseNdjsonText(text: string, onDelta?: (text: string) => void): AdvisorRuntimeChatResult {
  let content = ''
  const toolCalls: Array<Record<string, unknown>> = []
  let malformed = 0
  let chunks = 0
  let validMessages = 0
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    chunks += 1
    if (chunks > MAX_STREAM_CHUNKS) throw new Error('Local runtime stream exceeded the chunk limit.')
    let value: unknown
    try { value = JSON.parse(line) as unknown } catch {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
      continue
    }
    if (!isRecord(value)) {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
      continue
    }
    const message = value.message
    if (message === undefined && value.done === true) continue
    if (!isRecord(message)) {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
      continue
    }
    validMessages += 1
    if (message.content !== undefined) {
      if (typeof message.content !== 'string') throw new Error('Local runtime returned malformed message content.')
      content += message.content
      onDelta?.(message.content)
      if (byteLength(content) > 32_000) throw new Error('Local runtime message exceeded the content limit.')
    }
    const calls = parseToolCalls(message.tool_calls)
    if (calls.length) toolCalls.push(...calls)
  }
  if (validMessages === 0) throw new Error('Local runtime stream contained no valid messages.')
  return { message: { content, tool_calls: toolCalls.slice(0, 16) }, streamed: true }
}
async function streamNdjsonResponse(response: Response, onDelta?: (text: string) => void): Promise<AdvisorRuntimeChatResult> {
  const reader = response.body?.getReader()
  if (!reader) return parseNdjsonText(await boundedText(response), onDelta)
  const decoder = new TextDecoder()
  let pending = ''
  let bytes = 0
  let chunks = 0
  let malformed = 0
  let validMessages = 0
  let content = ''
  const toolCalls: Array<Record<string, unknown>> = []
  const consume = (line: string) => {
    if (!line.trim()) return
    chunks += 1
    if (chunks > MAX_STREAM_CHUNKS) throw new Error('Local runtime stream exceeded the chunk limit.')
    let value: unknown
    try { value = JSON.parse(line) as unknown } catch {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
      return
    }
    if (!isRecord(value)) {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
      return
    }
    const message = value.message
    if (message === undefined && value.done === true) return
    if (!isRecord(message)) {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
      return
    }
    validMessages += 1
    if (message.content !== undefined) {
      if (typeof message.content !== 'string') throw new Error('Local runtime returned malformed message content.')
      content += message.content
      onDelta?.(message.content)
      if (byteLength(content) > 32_000) throw new Error('Local runtime message exceeded the content limit.')
    }
    const calls = parseToolCalls(message.tool_calls)
    if (calls.length) toolCalls.push(...calls)
  }
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local runtime response exceeded the safety limit.')
    pending += decoder.decode(part.value, { stream: true })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) consume(line)
  }
  pending += decoder.decode()
  consume(pending)
  if (validMessages === 0) throw new Error('Local runtime stream contained no valid messages.')
  return { message: { content, tool_calls: toolCalls.slice(0, 16) }, streamed: true }
}
const ADVISOR_MESSAGE_ROLES = new Set(['system', 'user', 'assistant'])

function validateChatPayload(value: unknown): asserts value is AdvisorRuntimeChatPayload {
  if (!isRecord(value) || typeof value.model !== 'string' || !validModel(value.model)) throw new Error('Local runtime model is invalid.')
  if (!Array.isArray(value.messages) || !Array.isArray(value.tools) || value.messages.length > 32 || value.tools.length > 12) {
    throw new Error('Local runtime request exceeded the safety limit.')
  }
  if (typeof value.stream !== 'boolean') throw new Error('Local runtime stream flag is invalid.')
  for (const message of value.messages) {
    if (!isRecord(message) || typeof message.role !== 'string' || !ADVISOR_MESSAGE_ROLES.has(message.role)) throw new Error('Local runtime request contains a malformed message.')
    if (typeof message.content !== 'string') throw new Error('Local runtime request contains malformed message content.')
    boundedMessageContent(message.content)
    if (message.tool_calls !== undefined || message.tool_name !== undefined) throw new Error('Local runtime provider-native tool continuation is not supported.')
  }
  for (const tool of value.tools) {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function) || typeof tool.function.name !== 'string' || !tool.function.name.trim()) {
      throw new Error('Local runtime request contains a malformed tool definition.')
    }
    if (tool.function.parameters !== undefined && !isRecord(tool.function.parameters)) throw new Error('Local runtime request contains malformed tool parameters.')
  }
}
async function chatOnce(fetchImpl: FetchLike, payload: AdvisorRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void): Promise<AdvisorRuntimeChatResult> {
  const timed = timeoutSignal(parent, CHAT_TIMEOUT_MS)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(LOOPBACK_ENDPOINT + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: timed.signal,
    })
    throwIfAborted(timed.signal)
    if (!response.ok) throw new Error('Local runtime returned HTTP ' + response.status + '.')
    if (payload.stream) return streamNdjsonResponse(response, onDelta)
    const text = await boundedText(response)
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object') throw new Error('Local runtime returned invalid JSON.')
    return messageResult(value as Record<string, unknown>, false)
  } finally { timed.dispose() }
}
export async function chatOllamaMain(fetchImpl: FetchLike, payload: AdvisorRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void): Promise<AdvisorRuntimeChatResult> {
  if (!fetchImpl) throw new Error('Node fetch is unavailable.')
  if (!payload || !validModel(payload.model)) throw new Error('Local runtime model is invalid.')
  validateChatPayload(payload)
  let encoded: string
  try { encoded = JSON.stringify(payload) } catch { throw new Error('Local runtime request is not JSON-safe.') }
  if (byteLength(encoded) > MAX_RESPONSE_BYTES) throw new Error('Local runtime request exceeded the safety limit.')
  return chatOnce(fetchImpl, payload, parent, onDelta)
}
function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}
type AdvisorRuntimeId = 'ollama' | 'lmstudio' | 'llama-server'
function validRuntime(value: unknown): value is AdvisorRuntimeId { return value === 'ollama' || value === 'lmstudio' || value === 'llama-server' }
function parseLlamaServerOptions(value: unknown): LlamaServerRuntimeOptions {
  if (value === undefined) return {}
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'port')) throw new Error('llama-server runtime options are invalid')
  return { port: validateLlamaServerPort(value.port) }
}
function ollamaProbeEnvelope(value: AdvisorRuntimeProbe): AdvisorRuntimeProbe {
  const discoveryState = value.models.length ? 'models-discovered' : value.detail.includes('has no local models') ? 'no-models' : 'runtime-unavailable'
  return { runtime: 'ollama', available: value.available, models: value.models, modelLabels: value.modelLabels, detail: value.detail, discoveryState, capabilities: value.capabilities }
}
export function createAdvisorRuntimeHandlers(fetchImpl: FetchLike = fetch, emitDelta: (event: { requestId: string; text: string }) => void = () => {}): Record<string, (...args: any[]) => Promise<{ ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }>> {
  const flights = new Map<string, AbortController>()
  const fail = (error: unknown, kind = 'runtime') => ({ ok: false as const, error: { kind, message: boundedError(error).message } })
  return {
    'metrora:advisorProbe': async (runtime: AdvisorRuntimeId = 'ollama', runtimeOptions?: unknown) => {
      if (!validRuntime(runtime)) return fail(new Error('Advisor runtime is invalid.'), 'validation')
      let llamaOptions: LlamaServerRuntimeOptions = {}
      try {
        if (runtime === 'llama-server') llamaOptions = parseLlamaServerOptions(runtimeOptions)
        else if (runtimeOptions !== undefined) throw new Error('Runtime options are only supported for llama-server.')
      } catch (error) { return fail(error, 'validation') }
      try {
        const value = runtime === 'lmstudio'
          ? await probeLMStudioMain(fetchImpl)
          : runtime === 'llama-server'
            ? await probeLlamaServerMain(fetchImpl, undefined, llamaOptions)
            : ollamaProbeEnvelope(await probeOllamaMain(fetchImpl))
        return { ok: true, value }
      } catch (error) { return fail(error) }
    },
    'metrora:advisorChat': async (requestId: string, payload: AdvisorRuntimeChatPayload, runtime: AdvisorRuntimeId | ((text: string) => void) = 'ollama', runtimeOptions?: unknown) => {
      const selectedRuntime = typeof runtime === 'function' ? 'ollama' : runtime
      if (!validRequestId(requestId) || !validRuntime(selectedRuntime)) return fail(new Error('Advisor request is invalid.'), 'validation')
      let llamaOptions: LlamaServerRuntimeOptions = {}
      try {
        if (selectedRuntime === 'llama-server') llamaOptions = parseLlamaServerOptions(runtimeOptions)
        else if (runtimeOptions !== undefined) throw new Error('Runtime options are only supported for llama-server.')
      } catch (error) { return fail(error, 'validation') }
      const controller = new AbortController()
      flights.set(requestId, controller)
      try {
        const value = selectedRuntime === 'lmstudio'
          ? await chatLMStudioMain(fetchImpl, payload, controller.signal, payload.stream ? text => emitDelta({ requestId, text }) : undefined)
          : selectedRuntime === 'llama-server'
            ? await chatLlamaServerMain(fetchImpl, payload, controller.signal, payload.stream ? text => emitDelta({ requestId, text }) : undefined, llamaOptions)
            : await chatOllamaMain(fetchImpl, payload, controller.signal, payload.stream ? text => emitDelta({ requestId, text }) : undefined)
        return { ok: true, value }
      } catch (error) {
        return controller.signal.aborted ? fail(new Error('Advisor request cancelled.'), 'cancelled') : fail(error)
      } finally { if (flights.get(requestId) === controller) flights.delete(requestId) }
    },
    'metrora:advisorCancel': async (requestId: string) => {
      if (!validRequestId(requestId)) return { ok: false as const, error: { kind: 'validation', message: 'Advisor request id is invalid.' } }
      const controller = flights.get(requestId)
      controller?.abort()
      return { ok: true, value: Boolean(controller) }
    },
  }
}
