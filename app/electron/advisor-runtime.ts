const LOOPBACK_ENDPOINT = 'http://127.0.0.1:11434'
const PROBE_TIMEOUT_MS = 1500
const CHAT_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_STREAM_CHUNKS = 512
const MAX_MALFORMED_CHUNKS = 16

export type AdvisorRuntimeProbe = { available: boolean; models: string[]; detail: string }
export type AdvisorRuntimeChatPayload = {
  model: string
  messages: Array<Record<string, unknown>>
  tools: Array<Record<string, unknown>>
  stream: boolean
}
export type AdvisorRuntimeChatResult = { message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean }
type FetchLike = typeof fetch

function boundedError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error)
  return new Error(raw.replace(/[\r\n]+/g, ' ').replace(/[A-Za-z]:\\[^ ]+|\/[^ ]+/g, '[local path]').slice(0, 240))
}
function validModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/.test(model)
}
function timeoutSignal(parent?: AbortSignal, timeoutMs = CHAT_TIMEOUT_MS): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}
async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, MAX_RESPONSE_BYTES)
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
    const response = await fetchImpl(url, { ...init, signal: timed.signal })
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
    return models.length ? { available: true, models, detail: 'Local Ollama is reachable.' } : { available: false, models: [], detail: 'Ollama is reachable but has no local models.' }
  } catch (error) {
    if (parent?.aborted) throw error
    return { available: false, models: [], detail: boundedError(error).message }
  }
}
function parseToolCalls(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(row => row && typeof row === 'object').slice(0, 16) as Array<Record<string, unknown>>
}
function messageResult(raw: Record<string, unknown>, streamed: boolean): AdvisorRuntimeChatResult {
  const message = raw.message && typeof raw.message === 'object' ? raw.message as Record<string, unknown> : {}
  return {
    message: {
      content: typeof message.content === 'string' ? message.content.slice(0, 32_000) : '',
      tool_calls: parseToolCalls(message.tool_calls),
    },
    streamed,
  }
}
function parseNdjsonText(text: string, onDelta?: (text: string) => void): AdvisorRuntimeChatResult {
  let content = ''
  const toolCalls: Array<Record<string, unknown>> = []
  let malformed = 0
  let chunks = 0
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    chunks += 1
    if (chunks > MAX_STREAM_CHUNKS) throw new Error('Local runtime stream exceeded the chunk limit.')
    try {
      const value = JSON.parse(line) as unknown
      if (!value || typeof value !== 'object') throw new Error('not an object')
      const message = (value as { message?: unknown }).message
      if (!message || typeof message !== 'object') continue
      const row = message as Record<string, unknown>
      if (typeof row.content === 'string') {
        content += row.content
        if (content.length > 32_000) throw new Error('Local runtime message exceeded the content limit.')
        onDelta?.(content)
      }
      const calls = parseToolCalls(row.tool_calls)
      if (calls.length) toolCalls.push(...calls)
    } catch {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
    }
  }
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
  let content = ''
  const toolCalls: Array<Record<string, unknown>> = []
  const consume = (line: string) => {
    if (!line.trim()) return
    chunks += 1
    if (chunks > MAX_STREAM_CHUNKS) throw new Error('Local runtime stream exceeded the chunk limit.')
    try {
      const value = JSON.parse(line) as unknown
      if (!value || typeof value !== 'object') throw new Error('not an object')
      const message = (value as { message?: unknown }).message
      if (!message || typeof message !== 'object') return
      const row = message as Record<string, unknown>
      if (typeof row.content === 'string') {
        content += row.content
        if (content.length > 32_000) throw new Error('Local runtime message exceeded the content limit.')
        onDelta?.(content)
      }
      const calls = parseToolCalls(row.tool_calls)
      if (calls.length) toolCalls.push(...calls)
    } catch {
      malformed += 1
      if (malformed > MAX_MALFORMED_CHUNKS) throw new Error('Local runtime stream contained too many malformed chunks.')
    }
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
  return { message: { content, tool_calls: toolCalls.slice(0, 16) }, streamed: true }
}
async function chatOnce(fetchImpl: FetchLike, payload: AdvisorRuntimeChatPayload, parent?: AbortSignal, onDelta?: (text: string) => void): Promise<AdvisorRuntimeChatResult> {
  const timed = timeoutSignal(parent, CHAT_TIMEOUT_MS)
  try {
    const response = await fetchImpl(LOOPBACK_ENDPOINT + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: timed.signal,
    })
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
  if (!Array.isArray(payload.messages) || !Array.isArray(payload.tools) || payload.messages.length > 32 || payload.tools.length > 12) throw new Error('Local runtime request exceeded the safety limit.')
  const encoded = JSON.stringify(payload)
  if (encoded.length > MAX_RESPONSE_BYTES) throw new Error('Local runtime request exceeded the safety limit.')
  return chatOnce(fetchImpl, { ...payload, stream: Boolean(payload.stream) }, parent, onDelta)
}
function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}
export function createAdvisorRuntimeHandlers(fetchImpl: FetchLike = fetch): Record<string, (...args: any[]) => Promise<{ ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }>> {
  const flights = new Map<string, AbortController>()
  const fail = (error: unknown, kind = 'runtime') => ({ ok: false as const, error: { kind, message: boundedError(error).message } })
  return {
    'metrora:advisorProbe': async () => {
      try { return { ok: true, value: await probeOllamaMain(fetchImpl) } } catch (error) { return fail(error) }
    },
    'metrora:advisorChat': async (requestId: string, payload: AdvisorRuntimeChatPayload, onDelta?: (text: string) => void) => {
      if (!validRequestId(requestId)) return fail(new Error('Advisor request id is invalid.'), 'validation')
      const controller = new AbortController()
      flights.set(requestId, controller)
      try {
        const value = await chatOllamaMain(fetchImpl, payload, controller.signal, typeof onDelta === 'function' ? onDelta : undefined)
        return { ok: true, value }
      } catch (error) {
        return controller.signal.aborted ? fail(new Error('Advisor request cancelled.'), 'cancelled') : fail(error)
      } finally { flights.delete(requestId) }
    },
    'metrora:advisorCancel': async (requestId: string) => {
      if (!validRequestId(requestId)) return { ok: false as const, error: { kind: 'validation', message: 'Advisor request id is invalid.' } }
      const controller = flights.get(requestId)
      controller?.abort()
      return { ok: true, value: Boolean(controller) }
    },
  }
}
