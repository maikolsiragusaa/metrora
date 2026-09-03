import { createHash } from 'node:crypto'

import { reasoningMetadata, type HarnessLocalProbe, type HarnessReasoningEffort, type HarnessRuntimeId } from './harness-runtime-types.js'

const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'
const LMSTUDIO_ENDPOINT = 'http://127.0.0.1:1234'
export const LLAMA_SERVER_DEFAULT_PORT = 8080
export const LLAMA_SERVER_DEFAULT_ENDPOINT = `http://127.0.0.1:${LLAMA_SERVER_DEFAULT_PORT}`
const PROBE_TIMEOUT_MS = 2_000
const CHAT_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MESSAGE_BYTES = 32_000
const MAX_MESSAGES = 64
const MAX_TOOLS = 32
const MAX_TOOL_CALLS = 16
const MAX_STREAM_CHUNKS = 1_024

export type LocalRuntimeToolCall = { id: string; name: string; arguments: string }
export type LocalRuntimeMessage = { content: string; tool_calls: LocalRuntimeToolCall[]; reasoning?: string }
export type LocalRuntimeChatPayload = {
  model: string
  messages: Array<Record<string, unknown>>
  tools: Array<Record<string, unknown>>
  stream: boolean
  reasoningEffort?: string | null
}
export type LocalRuntimeChatResult = { message: LocalRuntimeMessage; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null; streamed: boolean }
type FetchLike = typeof fetch
type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength }
function bounded(value: string, label: string): string { if (byteLength(value) > MAX_MESSAGE_BYTES) throw new Error(label); return value }
function validModel(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u.test(value) }
function abortError(): Error { const error = new Error('The Harness request was cancelled.'); error.name = 'AbortError'; return error }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw abortError() }
function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}
function safeError(error: unknown): Error {
  if (error instanceof Error && error.name === 'AbortError') return error
  const raw = error instanceof Error ? error.message : String(error)
  return new Error(raw.replace(/[\r\n]+/gu, ' ').replace(/[A-Za-z]:\\[^ ]+|\/[^ ]+/gu, '[local path]').slice(0, 240))
}
async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const value = await response.text()
    if (byteLength(value) > MAX_RESPONSE_BYTES) throw new Error('Local provider response exceeded the safety limit.')
    return value
  }
  const decoder = new TextDecoder()
  let output = ''
  let bytes = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local provider response exceeded the safety limit.')
    output += decoder.decode(part.value, { stream: true })
  }
  return output + decoder.decode()
}
async function request<T>(fetchImpl: FetchLike, url: string, init: RequestInit, parent: AbortSignal | undefined, timeoutMs: number, consume: (response: Response) => Promise<T>): Promise<T> {
  const timed = timeoutSignal(parent, timeoutMs)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: timed.signal })
    throwIfAborted(timed.signal)
    return await consume(response)
  } catch (error) {
    if (timed.signal.aborted) throw abortError()
    throw safeError(error)
  } finally { timed.dispose() }
}

function toolCalls(value: unknown): LocalRuntimeToolCall[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Local provider returned malformed tool calls.')
  return value.slice(0, MAX_TOOL_CALLS).map((item, index) => {
    if (!isRecord(item)) throw new Error('Local provider returned malformed tool call.')
    const fn = isRecord(item.function) ? item.function : item
    const name = typeof fn.name === 'string' && fn.name.trim() ? fn.name.trim() : ''
    if (!name) throw new Error('Local provider returned a tool call without a name.')
    const rawArguments = fn.arguments
    const args = typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments ?? {})
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : `local-adapter-call-${index + 1}`
    return { id, name, arguments: bounded(args, 'Local provider tool arguments exceeded the safety limit.') }
  })
}

function usage(value: unknown): LocalRuntimeChatResult['usage'] {
  if (!isRecord(value)) return null
  const inputTokens = typeof value.prompt_eval_count === 'number' ? value.prompt_eval_count : typeof value.input_tokens === 'number' ? value.input_tokens : null
  const outputTokens = typeof value.eval_count === 'number' ? value.eval_count : typeof value.output_tokens === 'number' ? value.output_tokens : null
  const totalTokens = typeof value.total_tokens === 'number' ? value.total_tokens : inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  return inputTokens !== null || outputTokens !== null || totalTokens !== null ? { inputTokens, outputTokens, totalTokens } : null
}

function normalizeMessage(value: unknown): LocalRuntimeMessage {
  if (!isRecord(value)) throw new Error('Local provider returned a malformed message.')
  const content = value.content === undefined ? '' : typeof value.content === 'string' ? bounded(value.content, 'Local provider message exceeded the safety limit.') : ''
  const reasoningValue = typeof value.thinking === 'string' ? value.thinking : typeof value.reasoning === 'string' ? value.reasoning : typeof value.reasoning_content === 'string' ? value.reasoning_content : ''
  const calls = toolCalls(value.tool_calls)
  if (!content && !reasoningValue && calls.length === 0) throw new Error('Local provider returned an empty message.')
  return { content, tool_calls: calls, ...(reasoningValue ? { reasoning: bounded(reasoningValue, 'Local provider reasoning exceeded the safety limit.') } : {}) }
}

function validatePayload(payload: LocalRuntimeChatPayload): void {
  if (!payload || !validModel(payload.model) || !Array.isArray(payload.messages) || !Array.isArray(payload.tools) || payload.messages.length > MAX_MESSAGES || payload.tools.length > MAX_TOOLS) throw new Error('Local Harness request is invalid.')
  for (const message of payload.messages) {
    if (!isRecord(message) || typeof message.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') throw new Error('Local Harness message is invalid.')
    bounded(message.content, 'Local Harness message exceeded the safety limit.')
  }
}

function preserveCallIds(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const fallbackByIndex = new Map<number, string>()
  let callIndex = 0
  return messages.map(message => {
    if (!isRecord(message)) throw new Error('Local Harness message is invalid.')
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls.slice(0, MAX_TOOL_CALLS).map(call => {
        if (!isRecord(call) || !isRecord(call.function) || typeof call.function.name !== 'string') throw new Error('Local Harness tool call is invalid.')
        const id = typeof call.id === 'string' && call.id.trim() ? call.id : `local-adapter-call-${callIndex + 1}`
        fallbackByIndex.set(callIndex, id)
        callIndex += 1
        const args = typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments ?? {})
        return { id, type: 'function', function: { name: call.function.name, arguments: bounded(args, 'Local Harness tool arguments exceeded the safety limit.') } }
      })
      return { role: 'assistant', content: typeof message.content === 'string' ? message.content : '', tool_calls: calls }
    }
    if (message.role === 'tool') {
      const id = typeof message.tool_call_id === 'string' && message.tool_call_id ? message.tool_call_id : fallbackByIndex.get(Math.max(0, callIndex - 1)) ?? `local-adapter-call-${callIndex + 1}`
      return { role: 'tool', content: typeof message.content === 'string' ? bounded(message.content, 'Local Harness tool result exceeded the safety limit.') : '', tool_call_id: id }
    }
    return { role: message.role, content: message.content }
  })
}

function openAiBody(payload: LocalRuntimeChatPayload): Record<string, unknown> {
  return { model: payload.model, messages: preserveCallIds(payload.messages), ...(payload.tools.length ? { tools: payload.tools } : {}), stream: payload.stream, ...(payload.reasoningEffort ? { reasoning_effort: payload.reasoningEffort } : {}) }
}

function parseOpenAi(value: unknown): LocalRuntimeChatResult {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0]) || !isRecord(value.choices[0].message)) throw new Error('Local OpenAI-compatible response was malformed.')
  return { message: normalizeMessage(value.choices[0].message), usage: usage(value.usage), streamed: false }
}

async function parseOpenAiStream(response: Response, onDelta?: (text: string) => void, onReasoning?: (text: string) => void): Promise<LocalRuntimeChatResult> {
  const text = await boundedText(response)
  let content = ''
  let reasoningText = ''
  const calls: Array<Record<string, unknown>> = []
  let lastUsage: LocalRuntimeChatResult['usage'] = null
  let chunks = 0
  for (const line of text.split(/\r?\n/gu)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    if (++chunks > MAX_STREAM_CHUNKS) throw new Error('Local provider stream exceeded the safety limit.')
    let parsed: unknown
    try { parsed = JSON.parse(data) } catch { continue }
    if (!isRecord(parsed)) continue
    lastUsage = usage(parsed.usage) ?? lastUsage
    const choice = Array.isArray(parsed.choices) && isRecord(parsed.choices[0]) ? parsed.choices[0] : null
    const delta = choice && isRecord(choice.delta) ? choice.delta : null
    if (!delta) continue
    if (typeof delta.content === 'string') { content += delta.content; bounded(content, 'Local provider response exceeded the safety limit.'); onDelta?.(delta.content) }
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : ''
    if (reasoning) { reasoningText += reasoning; bounded(reasoningText, 'Local provider reasoning exceeded the safety limit.'); onReasoning?.(reasoning) }
    if (Array.isArray(delta.tool_calls)) for (const call of delta.tool_calls) {
      if (!isRecord(call) || typeof call.index !== 'number') continue
      const index = Math.max(0, Math.min(MAX_TOOL_CALLS - 1, Math.floor(call.index)))
      const current = calls[index] ?? { id: '', function: { name: '', arguments: '' } }
      if (typeof call.id === 'string' && call.id) current.id = call.id
      const fn = isRecord(call.function) ? call.function : {}
      const currentFn = isRecord(current.function) ? current.function : {}
      current.function = { ...currentFn, ...(typeof fn.name === 'string' ? { name: fn.name } : {}), ...(typeof fn.arguments === 'string' ? { arguments: String(currentFn.arguments ?? '') + fn.arguments } : {}) }
      calls[index] = current
    }
  }
  return { message: { content, tool_calls: toolCalls(calls.filter(Boolean)), ...(reasoningText ? { reasoning: reasoningText } : {}) }, usage: lastUsage, streamed: true }
}

async function chatOpenAiCompatible(fetchImpl: FetchLike, endpoint: string, payload: LocalRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void, onReasoning?: (text: string) => void): Promise<LocalRuntimeChatResult> {
  validatePayload(payload)
  const body = JSON.stringify(openAiBody(payload))
  if (byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('Local Harness request exceeded the safety limit.')
  return request(fetchImpl, endpoint + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, parent, CHAT_TIMEOUT_MS, async response => {
    if (!response.ok) throw new Error('Local provider returned HTTP ' + response.status + '.')
    return payload.stream ? parseOpenAiStream(response, onDelta, onReasoning) : parseOpenAi(JSON.parse(await boundedText(response)) as unknown)
  })
}

function probeCapabilities(runtime: HarnessRuntimeId, models: string[], detail: string, endpoint: string, reasoningByModel: ReadonlyMap<string, HarnessReasoningEffort[]> = new Map()): HarnessLocalProbe {
  return { runtime, endpoint, available: models.length > 0, models, detail, discoveryState: models.length ? 'models-discovered' : 'no-models', capabilities: models.map(modelId => ({ schemaVersion: 1, runtime, modelId, discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', ...(reasoningByModel.has(modelId) ? { reasoningEfforts: reasoningByModel.get(modelId) ?? [], reasoningMetadataPresent: true } : {}), limitation: 'Native Tool and reasoning conformance is checked separately for this exact model.' })) }
}

export async function probeOllamaMain(fetchImpl: FetchLike = fetch, parent?: AbortSignal): Promise<HarnessLocalProbe> {
  try {
    return await request(fetchImpl, OLLAMA_ENDPOINT + '/api/tags', { method: 'GET' }, parent, PROBE_TIMEOUT_MS, async response => {
      if (!response.ok) throw new Error('Ollama returned HTTP ' + response.status + '.')
      const payload = JSON.parse(await boundedText(response)) as unknown
      const rows = isRecord(payload) && Array.isArray(payload.models) ? payload.models : []
      const reasoningByModel = new Map<string, HarnessReasoningEffort[]>()
      const models = rows.flatMap(row => {
        if (!isRecord(row) || typeof row.name !== 'string' || !validModel(row.name)) return []
        const metadata = reasoningMetadata(row)
        if (metadata.present) reasoningByModel.set(row.name, metadata.efforts)
        return [row.name]
      })
      return probeCapabilities('ollama', [...new Set(models)].slice(0, 64), 'Local Ollama is reachable.', OLLAMA_ENDPOINT, reasoningByModel)
    })
  } catch (error) { if (parent?.aborted) throw error; return { ...probeCapabilities('ollama', [], safeError(error).message, OLLAMA_ENDPOINT), available: false, discoveryState: 'runtime-unavailable' } }
}

export async function chatOllamaMain(fetchImpl: FetchLike, payload: LocalRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void, onReasoning?: (text: string) => void): Promise<LocalRuntimeChatResult> {
  validatePayload(payload)
  // Ollama's native wire field accepts the provider-declared thinking id. Do
  // not collapse an exact capability into a generic boolean.
  const body: Record<string, unknown> = { model: payload.model, messages: preserveCallIds(payload.messages), ...(payload.tools.length ? { tools: payload.tools } : {}), stream: payload.stream, ...(payload.reasoningEffort ? { think: payload.reasoningEffort } : {}) }
  const encoded = JSON.stringify(body)
  if (byteLength(encoded) > MAX_RESPONSE_BYTES) throw new Error('Local Harness request exceeded the safety limit.')
  return request(fetchImpl, OLLAMA_ENDPOINT + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encoded }, parent, CHAT_TIMEOUT_MS, async response => {
    if (!response.ok) throw new Error('Ollama returned HTTP ' + response.status + '.')
    if (!payload.stream) {
      const value = JSON.parse(await boundedText(response)) as unknown
      if (!isRecord(value)) throw new Error('Ollama returned a malformed response.')
      return { message: normalizeMessage(value.message), usage: usage(value), streamed: false }
    }
    const text = await boundedText(response)
    let content = ''; let reasoning = ''; const allCalls: RecordValue[] = []; let lastUsage: LocalRuntimeChatResult['usage'] = null
    for (const line of text.split(/\r?\n/gu)) {
      if (!line.trim()) continue
      let value: unknown; try { value = JSON.parse(line) } catch { continue }
      if (!isRecord(value)) continue
      lastUsage = usage(value) ?? lastUsage
      const message = isRecord(value.message) ? value.message : null
      if (!message) continue
      if (typeof message.content === 'string') { content += message.content; bounded(content, 'Ollama response exceeded the safety limit.'); onDelta?.(message.content) }
      const part = typeof message.thinking === 'string' ? message.thinking : typeof message.reasoning === 'string' ? message.reasoning : ''
      if (part) { reasoning += part; bounded(reasoning, 'Ollama reasoning exceeded the safety limit.'); onReasoning?.(part) }
      if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) if (isRecord(call)) allCalls.push(call)
    }
    return { message: { content, tool_calls: toolCalls(allCalls), ...(reasoning ? { reasoning } : {}) }, usage: lastUsage, streamed: true }
  })
}

export async function probeLMStudioMain(fetchImpl: FetchLike = fetch, parent?: AbortSignal): Promise<HarnessLocalProbe> {
  try {
    return await request(fetchImpl, LMSTUDIO_ENDPOINT + '/api/v1/models', { method: 'GET' }, parent, PROBE_TIMEOUT_MS, async response => {
      if (!response.ok) throw new Error('LM Studio returned HTTP ' + response.status + '.')
      const payload = JSON.parse(await boundedText(response)) as unknown
      const rows = isRecord(payload) && Array.isArray(payload.models) ? payload.models : []
      const reasoningByModel = new Map<string, HarnessReasoningEffort[]>()
      const models = rows.flatMap(row => {
        if (!isRecord(row) || row.type !== 'llm' || typeof row.key !== 'string' || !validModel(row.key)) return []
        const metadata = reasoningMetadata(row)
        if (metadata.present) reasoningByModel.set(row.key, metadata.efforts)
        return [row.key]
      })
      return probeCapabilities('lmstudio', [...new Set(models)].slice(0, 64), 'Local LM Studio is reachable.', LMSTUDIO_ENDPOINT, reasoningByModel)
    })
  } catch (error) { if (parent?.aborted) throw error; return { ...probeCapabilities('lmstudio', [], safeError(error).message, LMSTUDIO_ENDPOINT), available: false, discoveryState: 'runtime-unavailable' } }
}
export async function chatLMStudioMain(fetchImpl: FetchLike, payload: LocalRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void, onReasoning?: (text: string) => void): Promise<LocalRuntimeChatResult> {
  return chatOpenAiCompatible(fetchImpl, LMSTUDIO_ENDPOINT, payload, parent, onDelta, onReasoning)
}

export function validateLlamaServerEndpoint(endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): string {
  if (typeof endpoint !== 'string' || endpoint.length > 256) throw new Error('llama.cpp endpoint is invalid.')
  let parsed: URL; try { parsed = new URL(endpoint) } catch { throw new Error('llama.cpp endpoint is invalid.') }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) throw new Error('llama.cpp endpoint must be loopback-only.')
  const port = parsed.port ? Number(parsed.port) : LLAMA_SERVER_DEFAULT_PORT
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('llama.cpp port must be between 1 and 65535.')
  return `http://${hostname === '::1' ? '[::1]' : hostname}:${port}`
}
export function llamaServerEndpointFromPort(port: unknown): string { if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('llama.cpp port must be between 1 and 65535.'); return validateLlamaServerEndpoint(`http://127.0.0.1:${port}`) }

export async function probeLlamaServerMain(fetchImpl: FetchLike = fetch, parent?: AbortSignal, endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): Promise<HarnessLocalProbe> {
  const safeEndpoint = validateLlamaServerEndpoint(endpoint)
  try {
    const healthStatus = await request(fetchImpl, safeEndpoint + '/health', { method: 'GET' }, parent, PROBE_TIMEOUT_MS, async response => response.status)
    if (healthStatus !== 200 && healthStatus !== 503) throw new Error('llama.cpp returned HTTP ' + healthStatus + '.')
    return await request(fetchImpl, safeEndpoint + '/v1/models', { method: 'GET' }, parent, PROBE_TIMEOUT_MS, async response => {
      if (!response.ok) throw new Error('llama.cpp returned HTTP ' + response.status + '.')
      const payload = JSON.parse(await boundedText(response)) as unknown
      const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
      const reasoningByModel = new Map<string, HarnessReasoningEffort[]>()
      const models = rows.flatMap(row => {
        if (!isRecord(row) || typeof row.id !== 'string' || !validModel(row.id)) return []
        const metadata = reasoningMetadata(row)
        if (metadata.present) reasoningByModel.set(row.id, metadata.efforts)
        return [row.id]
      })
      return { ...probeCapabilities('llama-server', [...new Set(models)].slice(0, 64), 'Local llama.cpp server is reachable on loopback.', safeEndpoint, reasoningByModel), endpoint: safeEndpoint }
    })
  } catch (error) { if (parent?.aborted) throw error; return { ...probeCapabilities('llama-server', [], safeError(error).message, safeEndpoint), endpoint: safeEndpoint, available: false, discoveryState: 'runtime-unavailable' } }
}
export async function chatLlamaServerMain(fetchImpl: FetchLike, payload: LocalRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void, onReasoning?: (text: string) => void, endpoint: string = LLAMA_SERVER_DEFAULT_ENDPOINT): Promise<LocalRuntimeChatResult> {
  return chatOpenAiCompatible(fetchImpl, validateLlamaServerEndpoint(endpoint), payload, parent, onDelta, onReasoning)
}

export function modelFingerprint(runtime: HarnessRuntimeId, model: string, endpoint: string): string {
  return createHash('sha256').update(JSON.stringify({ runtime, model, endpoint, protocol: 'native-dsh-adapter-v1' })).digest('hex')
}
