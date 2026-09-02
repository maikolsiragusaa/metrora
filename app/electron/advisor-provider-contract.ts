import type { AdvisorCredentialProvider, AdvisorCredentialState } from './advisor-credentials'


export type AdvisorHostedProviderId = AdvisorCredentialProvider
export type AdvisorHostedCredentialStatus = { provider: AdvisorHostedProviderId; state: AdvisorCredentialState }
export type AdvisorHostedModelState = 'discovered' | 'unverified' | 'verified' | 'limited' | 'unsupported' | 'failed-conformance'
export type AdvisorHostedProtocol = 'openai-responses' | 'openai-chat' | 'anthropic-messages' | 'gemini-content'
export type AdvisorHostedCapabilityState = 'supported' | 'unsupported' | 'unknown' | 'failed-conformance'
export type AdvisorReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'max'
export type AdvisorHostedReasoningParameter = 'openai-effort' | 'reasoning-object'
export type AdvisorHostedReasoningCapability = {
  efforts: readonly AdvisorReasoningEffort[]
  parameter: AdvisorHostedReasoningParameter
}
export type AdvisorHostedModelCapabilities = {
  conversational: 'available' | 'unavailable' | 'unknown'
  streaming: 'supported' | 'unsupported' | 'unknown'
  toolCall: AdvisorHostedCapabilityState
  reasoningEfforts?: readonly AdvisorReasoningEffort[]
}
export type AdvisorHostedModel = {
  id: string
  label: string
  state: AdvisorHostedModelState
  limitation: string | null
  capabilities?: AdvisorHostedModelCapabilities
}
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
export type AdvisorHostedToolDefinition = { type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }
/** Provider-neutral semantic history accepted at the Electron boundary. */
export type AdvisorHostedChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AdvisorHostedToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName?: string }
export type AdvisorHostedMessageMode = 'native' | 'flattened'
export type AdvisorHostedChatRequest = { provider: AdvisorHostedProviderId; model: string; messages: AdvisorHostedChatMessage[]; tools?: AdvisorHostedToolDefinition[]; stream?: boolean; consent: true; reasoningEffort?: AdvisorReasoningEffort; messageMode?: AdvisorHostedMessageMode; /** Set only for bounded Harness evidence/conformance calls. */ harnessConformance?: true }
export type AdvisorHostedChatResult = { provider: AdvisorHostedProviderId; model: string; message: { content: string; tool_calls: AdvisorHostedToolCall[] }; usage: AdvisorHostedUsage | null; streamed: boolean }
export type AdvisorHostedEnvelope = { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }

export type FetchLike = typeof fetch
export type CredentialReader = (provider: AdvisorHostedProviderId) => Promise<string | null>
export type CredentialStatusReader = (provider: AdvisorHostedProviderId) => Promise<AdvisorHostedCredentialStatus>
export type EventEmitter = (event: AdvisorHostedEvent) => void
export type AdvisorHostedModelListKind = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'opencode-zen'
export type AdvisorHostedProviderDescriptor = {
  origin: string
  modelsPath: string
  modelListKind: AdvisorHostedModelListKind
  protocolForModel: (model: string, metadata?: Record<string, unknown>) => AdvisorHostedProtocol | null
  chatPath: (model: string, stream: boolean, protocol: AdvisorHostedProtocol) => string
}

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

const OPENCODE_ZEN_PROTOCOLS: Readonly<Record<string, AdvisorHostedProtocol>> = {
  'gpt-5.6-sol': 'openai-responses',
  'gpt-5.6-terra': 'openai-responses',
  'gpt-5.6-luna': 'openai-responses',
  'gpt-5.5': 'openai-responses',
  'gpt-5.5-pro': 'openai-responses',
  'gpt-5.4': 'openai-responses',
  'gpt-5.4-pro': 'openai-responses',
  'gpt-5.4-mini': 'openai-responses',
  'gpt-5.4-nano': 'openai-responses',
  'gpt-5.3-codex': 'openai-responses',
  'gpt-5.3-codex-spark': 'openai-responses',
  'gpt-5.2': 'openai-responses',
  'gpt-5.2-codex': 'openai-responses',
  'gpt-5.1': 'openai-responses',
  'gpt-5.1-codex': 'openai-responses',
  'gpt-5.1-codex-max': 'openai-responses',
  'gpt-5.1-codex-mini': 'openai-responses',
  'gpt-5': 'openai-responses',
  'gpt-5-codex': 'openai-responses',
  'gpt-5-nano': 'openai-responses',
  'claude-fable-5': 'anthropic-messages',
  'claude-opus-5': 'anthropic-messages',
  'claude-opus-4-8': 'anthropic-messages',
  'claude-opus-4-7': 'anthropic-messages',
  'claude-opus-4-6': 'anthropic-messages',
  'claude-opus-4-5': 'anthropic-messages',
  'claude-sonnet-5': 'anthropic-messages',
  'claude-sonnet-4-6': 'anthropic-messages',
  'claude-sonnet-4-5': 'anthropic-messages',
  'claude-haiku-4-5': 'anthropic-messages',
  'gemini-3.7-flash': 'gemini-content',
  'gemini-3.6-flash': 'gemini-content',
  'gemini-3.5-flash': 'gemini-content',
  'gemini-3.5-flash-lite': 'gemini-content',
  'gemini-3.1-pro': 'gemini-content',
  'gemini-3-flash': 'gemini-content',
  'grok-4.6': 'openai-responses',
  'grok-4.5': 'openai-responses',
  'grok-build-0.1': 'openai-responses',
  'muse-spark-1.2': 'openai-responses',
  'qwen3.7-max': 'anthropic-messages',
  'qwen3.7-plus': 'anthropic-messages',
  'qwen3.6-plus': 'anthropic-messages',
  'qwen3.5-plus': 'anthropic-messages',
  'deepseek-v4-pro': 'openai-chat',
  'deepseek-v4-flash': 'openai-chat',
  'minimax-m3': 'openai-chat',
  'minimax-m2.7': 'openai-chat',
  'minimax-m2.5': 'openai-chat',
  'glm-5.2': 'openai-chat',
  'glm-5.1': 'openai-chat',
  'glm-5': 'openai-chat',
  'kimi-k2.5': 'openai-chat',
  'kimi-k2.6': 'openai-chat',
  'kimi-k2.7-code': 'openai-chat',
  'kimi-k3': 'openai-chat',
  'big-pickle': 'openai-chat',
  'mimo-v2.5-free': 'openai-chat',
  'hy3-free': 'openai-chat',
  'nemotron-3-ultra-free': 'openai-chat',
  'nemotron-3.5-lightning-free': 'openai-chat',
  'muse-spark-1.2-contributor-free': 'openai-responses',
}

function openCodeZenModelId(model: string): string { return model.replace(/^models\//u, '') }

/**
 * Resolve only the protocol vocabulary and endpoint paths implemented by the
 * provider adapter. An absent field returns undefined so the reviewed static
 * model map can remain the fallback; a present but unknown/malformed field
 * returns null so discovery fails closed instead of guessing.
 */
export function resolveOpenCodeZenProtocolFromMetadata(metadata: Record<string, unknown> | undefined): AdvisorHostedProtocol | null | undefined {
  if (!metadata) return undefined

  const protocolValues = ['protocol', 'protocol_id', 'protocolId']
    .filter(key => Object.prototype.hasOwnProperty.call(metadata, key))
    .map(key => metadata[key])
  const endpointValues = ['endpointPath', 'endpoint', 'chatPath']
    .filter(key => Object.prototype.hasOwnProperty.call(metadata, key))
    .map(key => metadata[key])
  if (protocolValues.length > 1 && protocolValues.some(value => value !== protocolValues[0])) return null
  if (endpointValues.length > 1 && endpointValues.some(value => value !== endpointValues[0])) return null
  if (protocolValues.some(value => value === undefined) || endpointValues.some(value => value === undefined)) return null

  const rawProtocol = protocolValues[0]
  const rawEndpoint = endpointValues[0]
  let protocol: AdvisorHostedProtocol | null | undefined
  if (rawProtocol !== undefined) {
    protocol = rawProtocol === 'openai-responses' || rawProtocol === 'openai-chat' || rawProtocol === 'anthropic-messages' || rawProtocol === 'gemini-content'
      ? rawProtocol
      : null
  }
  if (rawEndpoint !== undefined) {
    if (typeof rawEndpoint !== 'string') return null
    try {
      const parsed = new URL(rawEndpoint, 'https://opencode.ai')
      if (parsed.origin !== 'https://opencode.ai' || parsed.search || parsed.hash || parsed.username || parsed.password) return null
      const path = parsed.pathname
      const endpointProtocol = path === '/zen/v1/responses'
        ? 'openai-responses' as const
        : path === '/zen/v1/messages'
          ? 'anthropic-messages' as const
          : path === '/zen/v1/chat/completions'
            ? 'openai-chat' as const
            : /^\/zen\/v1\/models\/[^/]+:generateContent$/u.test(path)
              ? 'gemini-content' as const
              : null
      if (!endpointProtocol) return null
      if (protocol !== undefined && protocol !== endpointProtocol) return null
      protocol = endpointProtocol
    } catch {
      return null
    }
  }
  return protocol
}

const REASONING_EFFORTS = new Set<AdvisorReasoningEffort>(['default', 'low', 'medium', 'high', 'max'])
const REASONING_EFFORT_KEYS = ['reasoningEfforts', 'reasoning_efforts', 'supportedReasoningEfforts', 'supported_reasoning_efforts', 'reasoningEffortValues', 'reasoning_effort_values'] as const
const REASONING_PARAMETER_KEYS = ['reasoningParameter', 'reasoning_parameter', 'reasoningMode', 'reasoning_mode'] as const

function reasoningSources(metadata: Record<string, unknown>): Record<string, unknown>[] {
  const nested = metadata.capabilities
  return isRecordLike(nested) ? [metadata, nested] : [metadata]
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function declaredReasoningEfforts(sources: readonly Record<string, unknown>[]): AdvisorReasoningEffort[] | null | undefined {
  for (const source of sources) {
    for (const key of REASONING_EFFORT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue
      if (!Array.isArray(source[key])) return null
      const efforts = source[key]
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim().toLowerCase())
        .filter((value): value is AdvisorReasoningEffort => REASONING_EFFORTS.has(value as AdvisorReasoningEffort))
      if (!efforts.length) return null
      return Array.from(new Set(efforts))
    }
  }
  return undefined
}

function declaredReasoningParameter(sources: readonly Record<string, unknown>[], protocol: AdvisorHostedProtocol): AdvisorHostedReasoningParameter | null | undefined {
  if (protocol !== 'openai-responses' && protocol !== 'openai-chat') return null
  for (const source of sources) {
    for (const key of REASONING_PARAMETER_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue
      const value = source[key]
      if (value === 'openai-effort' || value === 'reasoning-object') return value
      if (value === 'reasoning_effort' || value === 'reasoning-effort') return protocol === 'openai-responses' ? 'reasoning-object' : 'openai-effort'
      if (value === 'reasoning' || value === 'thinking') return 'reasoning-object'
      return null
    }
    const parameters = source.supported_parameters
    if (!Array.isArray(parameters)) continue
    const names = parameters.filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase())
    if (names.includes('reasoning_effort') || names.includes('reasoning-effort')) return protocol === 'openai-responses' ? 'reasoning-object' : 'openai-effort'
    if (names.includes('reasoning') || names.includes('thinking')) return 'reasoning-object'
  }
  return undefined
}

/**
 * Read reasoning support only when the provider explicitly declares both a
 * usable parameter and its supported levels. An absent declaration is not a
 * capability; callers must keep the control at Default.
 */
export function reasoningCapabilityFromMetadata(metadata: Record<string, unknown> | undefined, protocol: AdvisorHostedProtocol | null): AdvisorHostedReasoningCapability | null {
  if (!metadata || !protocol) return null
  const sources = reasoningSources(metadata)
  const parameter = declaredReasoningParameter(sources, protocol)
  if (!parameter) return null
  const declared = declaredReasoningEfforts(sources)
  if (declared === null) return null
  // A provider parameter is not enough to invent a universal low/medium/high
  // scale.  Without explicit values the only truthful control is Default.
  const efforts = declared ?? ['default']
  if (!efforts.includes('default')) efforts.unshift('default')
  return { efforts: Array.from(new Set(efforts)), parameter }
}

function openCodeZenProtocol(model: string, metadata?: Record<string, unknown>): AdvisorHostedProtocol | null {
  const explicit = resolveOpenCodeZenProtocolFromMetadata(metadata)
  return explicit === undefined ? OPENCODE_ZEN_PROTOCOLS[openCodeZenModelId(model)] ?? null : explicit
}

function openCodeZenChatPath(model: string, stream: boolean, protocol: AdvisorHostedProtocol): string {
  if (protocol === 'openai-responses') return '/zen/v1/responses'
  if (protocol === 'anthropic-messages') return '/zen/v1/messages'
  if (protocol === 'openai-chat') return '/zen/v1/chat/completions'
  return '/zen/v1/models/' + encodeURIComponent(openCodeZenModelId(model)) + ':' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent')
}

export const DESCRIPTORS: Record<AdvisorHostedProviderId, AdvisorHostedProviderDescriptor> = {
  openai: { origin: 'https://api.openai.com', modelsPath: '/v1/models', modelListKind: 'openai', protocolForModel: () => 'openai-responses', chatPath: () => '/v1/responses' },
  anthropic: { origin: 'https://api.anthropic.com', modelsPath: '/v1/models', modelListKind: 'anthropic', protocolForModel: () => 'anthropic-messages', chatPath: () => '/v1/messages' },
  gemini: {
    origin: 'https://generativelanguage.googleapis.com',
    modelsPath: '/v1beta/models',
    modelListKind: 'gemini',
    protocolForModel: () => 'gemini-content',
    chatPath: (model, stream) => '/v1beta/models/' + encodeURIComponent(model.replace(/^models\//u, '')) + ':' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent'),
  },
  openrouter: {
    origin: 'https://openrouter.ai',
    modelsPath: '/api/v1/models?output_modalities=text',
    modelListKind: 'openrouter',
    protocolForModel: () => 'openai-chat',
    chatPath: () => '/api/v1/chat/completions',
  },
  'opencode-zen': {
    origin: 'https://opencode.ai',
    modelsPath: '/zen/v1/models',
    modelListKind: 'opencode-zen',
    protocolForModel: openCodeZenProtocol,
    chatPath: openCodeZenChatPath,
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
export function validProvider(value: unknown): value is AdvisorHostedProviderId {
  return value === 'openai' || value === 'anthropic' || value === 'gemini' || value === 'openrouter' || value === 'opencode-zen'
}
export function validRequestId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value) }
export function validModel(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u.test(value) }
export function safeModelLabel(value: string): string { return value.replace(/^models\//u, '') }
export function abortError(): Error {
  const error = new Error('Advisor request cancelled.')
  error.name = 'AbortError'
  return error
}
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(value => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
  })
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
export function authHeaders(provider: AdvisorHostedProviderId, secret: string, protocol?: AdvisorHostedProtocol): Record<string, string> {
  const resolved = protocol ?? DESCRIPTORS[provider].protocolForModel('')
  if (resolved === 'anthropic-messages') return { 'x-api-key': secret, 'anthropic-version': ANTHROPIC_VERSION }
  if (resolved === 'gemini-content') return { 'x-goog-api-key': secret }
  return { Authorization: 'Bearer ' + secret }
}
export function requestHeaders(provider: AdvisorHostedProviderId, secret: string, stream: boolean, protocol?: AdvisorHostedProtocol): Record<string, string> {
  return { Accept: stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json', ...authHeaders(provider, secret, protocol) }
}
export function timeoutRequest(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}
export async function fetchResponse(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, parent?: AbortSignal): Promise<{ response: Response; dispose: () => void; signal: AbortSignal }> {
  const timed = timeoutRequest(parent, timeoutMs)
  try {
    throwIfAborted(timed.signal)
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: timed.signal })
    throwIfAborted(timed.signal)
    return { response, dispose: timed.dispose, signal: timed.signal }
  } catch (error) {
    timed.dispose()
    if (timed.signal.aborted) throw abortError()
    throw error
  }
}
function bindReaderAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): () => void {
  if (!signal) return () => {}
  const onAbort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}
export async function readBoundedText(response: Response, signal?: AbortSignal): Promise<string> {
  if (signal) throwIfAborted(signal)
  const reader = response.body?.getReader()
  if (!reader) {
    if (!signal) {
      const text = await response.text()
      if (byteLength(text) > MAX_RESPONSE_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
      return text
    }
    let rejectAbort!: (reason: unknown) => void
    const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject })
    const onAbort = () => rejectAbort(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const text = await Promise.race([response.text(), abortPromise])
      throwIfAborted(signal)
      if (byteLength(text) > MAX_RESPONSE_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
      return text
    } finally { signal.removeEventListener('abort', onAbort) }
  }
  const disposeAbort = bindReaderAbort(reader, signal)
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      if (signal) throwIfAborted(signal)
      const part = await reader.read()
      if (signal) throwIfAborted(signal)
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new HostedAdapterError('response-too-large', 'The provider response was too large.')
      text += decoder.decode(part.value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    if (signal?.aborted) throw abortError()
    throw error
  } finally { disposeAbort() }
}
export async function readJson(response: Response, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const text = await readBoundedText(response, signal)
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
  const inputTokens = next.inputTokens ?? previous?.inputTokens ?? null
  const outputTokens = next.outputTokens ?? previous?.outputTokens ?? null
  const totalTokens = next.totalTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : previous?.totalTokens ?? null)
  return { inputTokens, outputTokens, totalTokens }
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
export function normalizeToolCall(id: unknown, name: unknown, args: unknown, fallbackId = 'tool-call'): AdvisorHostedToolCall {
  const normalizedName = toolName(name)
  if (!normalizedName || !TOOL_NAMES.has(normalizedName)) throw new HostedAdapterError('tool-unsupported', 'The provider returned an unsupported Metrora tool.')
  const normalizedId = typeof id === 'string' && id.trim() ? id : fallbackId
  return { id: boundedString(normalizedId, 128, 'The provider returned an invalid tool call id.'), name: normalizedName, arguments: toolArguments(args ?? '{}') }
}
export function emitToolCall(call: AdvisorHostedToolCall, requestId: string, provider: AdvisorHostedProviderId, model: string, emit: EventEmitter): void {
  emit({ requestId, provider, model, kind: 'tool-call-start', callId: call.id, name: call.name })
  emit({ requestId, provider, model, kind: 'tool-call-complete', callId: call.id, name: call.name, arguments: call.arguments })
}
export function normalizeTools(tools: unknown): AdvisorHostedToolDefinition[] {
  if (tools === undefined) return []
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw new HostedAdapterError('request-malformed', 'Metrora tools are malformed.')
  return tools.map(value => {
    if (!isRecord(value) || value.type !== 'function' || !isRecord(value.function)) throw new HostedAdapterError('request-malformed', 'Only Metrora function tools are supported.')
    const name = toolName(value.function.name)
    if (!name || !TOOL_NAMES.has(name)) throw new HostedAdapterError('tool-unsupported', 'Only Metrora read-only tools are supported.')
    const description = value.function.description === undefined ? undefined : boundedString(value.function.description, 1024, 'Metrora tool description is too large.')
    const parameters = value.function.parameters === undefined ? undefined : value.function.parameters
    if (parameters !== undefined && !isRecord(parameters)) throw new HostedAdapterError('request-malformed', 'Metrora tool parameters are malformed.')
    return { type: 'function', function: { name, ...(description ? { description } : {}), ...(parameters ? { parameters } : {}) } }
  })
}
