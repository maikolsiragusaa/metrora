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
export type AdvisorHostedChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}
export type AdvisorHostedToolDefinition = { type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }
export type AdvisorHostedChatRequest = { provider: AdvisorHostedProviderId; model: string; messages: AdvisorHostedChatMessage[]; tools?: AdvisorHostedToolDefinition[]; stream?: boolean; consent: true }
export type AdvisorHostedChatResult = { provider: AdvisorHostedProviderId; model: string; message: { content: string; tool_calls: AdvisorHostedToolCall[] }; usage: AdvisorHostedUsage | null; streamed: boolean }
export type AdvisorHostedEnvelope = { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }

export type FetchLike = typeof fetch
export type CredentialReader = (provider: AdvisorHostedProviderId) => Promise<string | null>
export type CredentialStatusReader = (provider: AdvisorHostedProviderId) => Promise<AdvisorHostedCredentialStatus>
export type EventEmitter = (event: AdvisorHostedEvent) => void

export const MAX_REQUEST_BYTES = 128 * 1024
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_TEXT_BYTES = 32 * 1024
export const MAX_TOOL_ARGUMENT_BYTES = 8 * 1024
export const MAX_MESSAGES = 32
export const MAX_TOOLS = 7
export const MAX_TOOL_CALLS = 8
export const MAX_MODEL_PAGES = 8
export const MAX_MODEL_PAGE_SIZE = 64
export const MAX_PAGE_TOKEN_BYTES = 256
export const MAX_MODELS = 128
export const MAX_SSE_EVENTS = 512
export const REQUEST_TIMEOUT_MS = 120_000
export const PROBE_TIMEOUT_MS = 10_000
export const ANTHROPIC_VERSION = '2023-06-01'
export const TOOL_NAMES = new Set([
  'get_spend_snapshot',
  'get_model_efficiency',
  'get_quota_snapshot',
  'get_overview_snapshot',
  'get_project_drivers',
  'get_session_highlights',
  'get_coverage_report',
])

export const DESCRIPTORS: Record<AdvisorHostedProviderId, { origin: string; modelsPath: string; chatPath: (model: string, stream: boolean) => string }> = {
  openai: { origin: 'https://api.openai.com', modelsPath: '/v1/models', chatPath: () => '/v1/responses' },
  anthropic: { origin: 'https://api.anthropic.com', modelsPath: '/v1/models', chatPath: () => '/v1/messages' },
  gemini: {
    origin: 'https://generativelanguage.googleapis.com',
    modelsPath: '/v1beta/models',
    chatPath: (model, stream) => '/v1beta/models/' + encodeURIComponent(model.replace(/^models\//u, '')) + ':' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent'),
  },
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
export function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength }
export function boundedString(value: unknown, limit: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || byteLength(value) > limit) throw new HostedAdapterError('request-malformed', label)
  return value
}
export function validProvider(value: unknown): value is AdvisorHostedProviderId { return value === 'openai' || value === 'anthropic' || value === 'gemini' }
export function validRequestId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value) }
export function validModel(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u.test(value) }
export function safeModelLabel(value: string): string { return value.replace(/^models\//u, '') }
export function throwIfAborted(signal: AbortSignal): void {
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
export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof HostedAdapterError) return { code: error.code, message: error.message }
  if (error instanceof Error && error.name === 'AbortError') return { code: 'cancelled', message: 'Advisor request cancelled.' }
  return { code: 'provider-unavailable', message: 'The selected provider is unavailable.' }
}
export function providerHttpError(status: number): HostedAdapterError {
  if (status === 401) return new HostedAdapterError('credential-invalid', 'The provider rejected the saved credential.')
  if (status === 403) return new HostedAdapterError('provider-denied', 'The provider denied this request.')
  if (status === 404) return new HostedAdapterError('model-unavailable', 'The selected provider model is unavailable.')
  if (status === 429) return new HostedAdapterError('rate-limited', 'The provider rate-limited this request.')
  return new HostedAdapterError('provider-unavailable', 'The provider request failed.')
}
export function providerUrl(provider: AdvisorHostedProviderId, path: string): string {
  const url = new URL(path, DESCRIPTORS[provider].origin)
  if (url.protocol !== 'https:' || url.origin !== DESCRIPTORS[provider].origin) throw new HostedAdapterError('provider-unavailable', 'The provider endpoint is not approved.')
  return url.toString()
}
export function authHeaders(provider: AdvisorHostedProviderId, secret: string): Record<string, string> {
  if (provider === 'openai') return { Authorization: 'Bearer ' + secret }
  if (provider === 'anthropic') return { 'x-api-key': secret, 'anthropic-version': ANTHROPIC_VERSION }
  return { 'x-goog-api-key': secret }
}
export function requestHeaders(provider: AdvisorHostedProviderId, secret: string, stream: boolean): Record<string, string> {
  return { Accept: stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json', ...authHeaders(provider, secret) }
}
export function timeoutRequest(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}
export async function fetchResponse(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, parent?: AbortSignal): Promise<{ response: Response; dispose: () => void }> {
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
export async function readBoundedText(response: Response): Promise<string> {
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
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await readBoundedText(response)
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) throw new Error()
    return parsed
  } catch { throw new HostedAdapterError('response-malformed', 'The provider response was malformed.') }
}
export function statusCheck(response: Response): void { if (!response.ok) throw providerHttpError(response.status) }
export function boundedJson(value: unknown, message: string): string {
  let text: string
  try { text = JSON.stringify(value) } catch { throw new HostedAdapterError('request-malformed', message) }
  if (!text || byteLength(text) > MAX_REQUEST_BYTES) throw new HostedAdapterError('request-too-large', message)
  return text
}
export function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : null }
export function usageFrom(input: unknown, output: unknown, total: unknown = undefined): AdvisorHostedUsage | null {
  const inputTokens = numberOrNull(input)
  const outputTokens = numberOrNull(output)
  const totalTokens = numberOrNull(total) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null)
  return inputTokens === null && outputTokens === null && totalTokens === null ? null : { inputTokens, outputTokens, totalTokens }
}
export function mergeUsage(previous: AdvisorHostedUsage | null, next: AdvisorHostedUsage | null): AdvisorHostedUsage | null {
  if (!next) return previous
  return { inputTokens: next.inputTokens ?? previous?.inputTokens ?? null, outputTokens: next.outputTokens ?? previous?.outputTokens ?? null, totalTokens: next.totalTokens ?? previous?.totalTokens ?? null }
}
export function emitUsage(requestId: string, provider: AdvisorHostedProviderId, model: string, usage: AdvisorHostedUsage | null, emit: EventEmitter): void {
  if (usage) emit({ requestId, provider, model, kind: 'usage', usage })
}
export function toolName(value: unknown): string { return typeof value === 'string' && /^[A-Za-z0-9_:-]{1,96}$/u.test(value) ? value : '' }
export function toolArguments(value: unknown): string {
  if (typeof value === 'string') {
    if (byteLength(value) > MAX_TOOL_ARGUMENT_BYTES) throw new HostedAdapterError('tool-malformed', 'The provider returned oversized tool arguments.')
    try { JSON.parse(value) } catch { throw new HostedAdapterError('tool-malformed', 'The provider returned malformed tool arguments.') }
    return value
  }
  const text = boundedJson(value, 'The provider returned malformed tool arguments.')
  if (byteLength(text) > MAX_TOOL_ARGUMENT_BYTES) throw new HostedAdapterError('tool-malformed', 'The provider returned oversized tool arguments.')
  return text
}
export function normalizeToolCall(id: unknown, name: unknown, args: unknown): AdvisorHostedToolCall {
  const normalizedName = toolName(name)
  if (!normalizedName || !TOOL_NAMES.has(normalizedName)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Advisor tool.')
  return { id: boundedString(typeof id === 'string' ? id : 'tool-call', 128, 'The provider returned an invalid tool call id.'), name: normalizedName, arguments: toolArguments(args ?? '{}') }
}
export function emitToolCall(call: AdvisorHostedToolCall, requestId: string, provider: AdvisorHostedProviderId, model: string, emit: EventEmitter): void {
  emit({ requestId, provider, model, kind: 'tool-call-start', callId: call.id, name: call.name })
  emit({ requestId, provider, model, kind: 'tool-call-complete', callId: call.id, name: call.name, arguments: call.arguments })
}
export function normalizeTools(tools: unknown): AdvisorHostedToolDefinition[] {
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
