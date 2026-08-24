const LOOPBACK_ENDPOINT = 'http://127.0.0.1:1234'
const PROBE_TIMEOUT_MS = 1500
const CHAT_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_STREAM_CHUNKS = 512
const MAX_MALFORMED_CHUNKS = 16
const MAX_MESSAGE_BYTES = 32_000
const MAX_TOOL_CALLS = 16

export type LMStudioRuntimeProbe = {
  runtime: 'lmstudio'
  available: boolean
  models: string[]
  detail: string
  discoveryState: 'runtime-unavailable' | 'runtime-available' | 'no-models' | 'models-discovered'
  capabilities: Array<{
    schemaVersion: 1
    runtime: 'lmstudio'
    modelId: string
    discovery: 'discovered'
    conversational: 'available'
    toolCall: 'unknown'
    streaming: 'supported'
    limitation: string
  }>
}
type FetchLike = typeof fetch
type ChatPayload = import('./advisor-runtime').AdvisorRuntimeChatPayload
type ChatResult = import('./advisor-runtime').AdvisorRuntimeChatResult

type RecordValue = Record<string, unknown>
function isRecord(value: unknown): value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength }
function boundedMessageContent(value: string): string {
  if (byteLength(value) > MAX_MESSAGE_BYTES) throw new Error('Local runtime message exceeded the content limit.')
  return value
}
function validModel(model: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/.test(model) }
function boundedError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error)
  return new Error(raw.replace(/[\r\n]+/g, ' ').replace(/[A-Za-z]:\\[^ ]+|\/[^ ]+/g, '[local path]').slice(0, 240))
}
function abortError(): Error { const error = new Error('The operation was aborted.'); error.name = 'AbortError'; return error }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError() }
function timeoutSignal(parent?: AbortSignal, timeoutMs = CHAT_TIMEOUT_MS): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}
async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('Local runtime response exceeded the safety limit.')
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
async function fetchJson(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, parent?: AbortSignal): Promise<RecordValue> {
  const timed = timeoutSignal(parent, timeoutMs)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(url, { ...init, signal: timed.signal })
    throwIfAborted(timed.signal)
    if (!response.ok) throw new Error('Local LM Studio server returned HTTP ' + response.status + '.')
    const text = await boundedText(response)
    const value = JSON.parse(text) as unknown
    if (!isRecord(value)) throw new Error('Local LM Studio server returned invalid JSON.')
    return value
  } finally { timed.dispose() }
}
function capability(modelId: string): LMStudioRuntimeProbe['capabilities'][number] {
  return { schemaVersion: 1, runtime: 'lmstudio', modelId, discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', limitation: 'Tool support varies by model and has not been verified in this session.' }
}
export async function probeLMStudioMain(fetchImpl: FetchLike = fetch, parent?: AbortSignal): Promise<LMStudioRuntimeProbe> {
  if (parent?.aborted) throw abortError()
  if (!fetchImpl) return { runtime: 'lmstudio', available: false, models: [], detail: 'Node fetch is unavailable.', discoveryState: 'runtime-unavailable', capabilities: [] }
  try {
    const payload = await fetchJson(fetchImpl, LOOPBACK_ENDPOINT + '/api/v1/models', {}, PROBE_TIMEOUT_MS, parent)
    const rows = Array.isArray(payload.models) ? payload.models : []
    const models = Array.from(new Set(rows.flatMap(row => {
      if (!isRecord(row) || row.type !== 'llm' || typeof row.key !== 'string' || !validModel(row.key)) return []
      return [row.key]
    })))
    if (!models.length) return { runtime: 'lmstudio', available: false, models: [], detail: 'LM Studio is reachable but has no local language models.', discoveryState: 'no-models', capabilities: [] }
    return { runtime: 'lmstudio', available: true, models, detail: 'Local LM Studio is reachable.', discoveryState: 'models-discovered', capabilities: models.map(capability) }
  } catch (error) {
    if (parent?.aborted) throw error
    return { runtime: 'lmstudio', available: false, models: [], detail: boundedError(error).message, discoveryState: 'runtime-unavailable', capabilities: [] }
  }
}
function parseToolCalls(value: unknown): Array<RecordValue> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Local runtime tool_calls must be an array.')
  return value.slice(0, MAX_TOOL_CALLS).map(call => {
    if (!isRecord(call) || !isRecord(call.function) || typeof call.function.name !== 'string' || !call.function.name.trim()) throw new Error('Local runtime returned a malformed tool call.')
    const args = call.function.arguments
    if (args !== undefined && typeof args !== 'string' && !isRecord(args)) throw new Error('Local runtime returned malformed tool arguments.')
    if (typeof args === 'string' && byteLength(args) > MAX_MESSAGE_BYTES) throw new Error('Local runtime tool arguments exceeded the content limit.')
    return { function: { name: call.function.name, ...(args !== undefined ? { arguments: args } : {}) } }
  })
}
function normalizeMessage(message: RecordValue): ChatResult['message'] {
  if (message.content !== undefined && typeof message.content !== 'string') throw new Error('Local runtime returned malformed message content.')
  const toolCalls = parseToolCalls(message.tool_calls)
  if (message.content === undefined && toolCalls.length === 0) throw new Error('Local runtime returned an empty message.')
  return { content: typeof message.content === 'string' ? boundedMessageContent(message.content) : '', tool_calls: toolCalls }
}
function openAIMessageList(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const callIds: string[] = []
  let nextId = 0
  return messages.map(message => {
    if (!isRecord(message)) throw new Error('Local runtime request contains a malformed message.')
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      const toolCalls = message.tool_calls.slice(0, MAX_TOOL_CALLS).map(call => {
        if (!isRecord(call) || !isRecord(call.function) || typeof call.function.name !== 'string') throw new Error('Local runtime request contains a malformed tool call.')
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
function validatePayload(value: unknown): asserts value is ChatPayload {
  if (!isRecord(value) || typeof value.model !== 'string' || !validModel(value.model)) throw new Error('Local runtime model is invalid.')
  if (!Array.isArray(value.messages) || !Array.isArray(value.tools) || value.messages.length > 32 || value.tools.length > 12) throw new Error('Local runtime request exceeded the safety limit.')
  if (typeof value.stream !== 'boolean') throw new Error('Local runtime stream flag is invalid.')
  for (const message of value.messages) {
    if (!isRecord(message) || typeof message.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('Local runtime request contains a malformed message.')
    if (typeof message.content !== 'string') throw new Error('Local runtime request contains malformed message content.')
    boundedMessageContent(message.content)
    if (message.tool_calls !== undefined) parseToolCalls(message.tool_calls)
  }
  for (const tool of value.tools) {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function) || typeof tool.function.name !== 'string' || !tool.function.name.trim()) throw new Error('Local runtime request contains a malformed tool definition.')
    if (tool.function.parameters !== undefined && !isRecord(tool.function.parameters)) throw new Error('Local runtime request contains malformed tool parameters.')
  }
}
function parseChatResponse(value: unknown): ChatResult {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) throw new Error('Local LM Studio response was malformed.')
  const choice = value.choices[0]
  if (!isRecord(choice.message)) throw new Error('Local LM Studio response message was malformed.')
  return { message: normalizeMessage(choice.message), streamed: false }
}
function parseSseText(text: string): ChatResult {
  let content = ''
  const toolCalls: Array<RecordValue> = []
  let chunks = 0
  let malformed = 0
  let valid = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    chunks += 1
    if (chunks > MAX_STREAM_CHUNKS) throw new Error('Local runtime stream exceeded the chunk limit.')
    let value: unknown
    try { value = JSON.parse(data) } catch { malformed += 1; if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.'); continue }
    if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) { malformed += 1; if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained malformed events.'); continue }
    const delta = isRecord(value.choices[0].delta) ? value.choices[0].delta : null
    if (!delta) continue
    valid = true
    if (typeof delta.content === 'string') { content += delta.content; boundedMessageContent(content) }
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls.slice(0, MAX_TOOL_CALLS)) {
        if (!isRecord(call) || typeof call.index !== 'number') throw new Error('Local runtime returned malformed streaming tool calls.')
        const index = Math.max(0, Math.floor(call.index))
        const current = toolCalls[index] ?? { function: { name: '', arguments: '' } }
        const fn = isRecord(call.function) ? call.function : {}
        if (typeof fn.name === 'string') current.function = { ...(isRecord(current.function) ? current.function : {}), name: fn.name }
        if (typeof fn.arguments === 'string') current.function = { ...(isRecord(current.function) ? current.function : {}), arguments: String(isRecord(current.function) && typeof current.function.arguments === 'string' ? current.function.arguments : '') + fn.arguments }
        toolCalls[index] = current
      }
    }
  }
  if (!valid) throw new Error('Local runtime stream contained no valid messages.')
  return { message: { content, tool_calls: parseToolCalls(toolCalls.filter(Boolean)) }, streamed: true }
}
async function streamResponse(response: Response): Promise<ChatResult> {
  const reader = response.body?.getReader()
  if (!reader) return parseSseText(await boundedText(response))
  const decoder = new TextDecoder()
  let pending = ''
  let bytes = 0
  let text = ''
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local runtime response exceeded the safety limit.')
    text += decoder.decode(part.value, { stream: true })
  }
  text += decoder.decode()
  return parseSseText(text)
}
export async function chatLMStudioMain(fetchImpl: FetchLike, payload: ChatPayload, parent?: AbortSignal): Promise<ChatResult> {
  if (!fetchImpl) throw new Error('Node fetch is unavailable.')
  validatePayload(payload)
  const body = { model: payload.model, messages: openAIMessageList(payload.messages), ...(payload.tools.length ? { tools: payload.tools } : {}), stream: payload.stream }
  const encoded = JSON.stringify(body)
  if (byteLength(encoded) > MAX_RESPONSE_BYTES) throw new Error('Local runtime request exceeded the safety limit.')
  const timed = timeoutSignal(parent, CHAT_TIMEOUT_MS)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(LOOPBACK_ENDPOINT + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encoded, signal: timed.signal })
    throwIfAborted(timed.signal)
    if (!response.ok) throw new Error('Local LM Studio server returned HTTP ' + response.status + '.')
    return payload.stream ? await streamResponse(response) : parseChatResponse(JSON.parse(await boundedText(response)) as unknown)
  } finally { timed.dispose() }
}
