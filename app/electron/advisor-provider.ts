import * as contract from './advisor-provider-contract'
import type {
  AdvisorHostedChatMessage,
  AdvisorHostedChatRequest,
  AdvisorHostedChatResult,
  AdvisorHostedCapabilityState,
  AdvisorHostedCredentialStatus,
  AdvisorHostedEnvelope,
  AdvisorHostedEvent,
  AdvisorHostedModel,
  AdvisorHostedModelCapabilities,
  AdvisorHostedProtocol,
  AdvisorHostedProbe,
  AdvisorHostedProviderId,
  AdvisorHostedReasoningCapability,
  AdvisorReasoningEffort,
  AdvisorHostedUsage,
  CredentialReader,
  CredentialStatusReader,
  EventEmitter,
  FetchLike,
} from './advisor-provider-contract'
import { bodyFor, finalizeOpenToolCalls, protocolAdapter, streamState } from './advisor-provider-adapters'
export type {
  AdvisorHostedChatMessage,
  AdvisorHostedChatRequest,
  AdvisorHostedChatResult,
  AdvisorHostedCapabilityState,
  AdvisorHostedCredentialStatus,
  AdvisorHostedEnvelope,
  AdvisorHostedEvent,
  AdvisorHostedModel,
  AdvisorHostedModelCapabilities,
  AdvisorHostedModelState,
  AdvisorHostedProbe,
  AdvisorHostedProtocol,
  AdvisorHostedProviderId,
  AdvisorHostedReasoningCapability,
  AdvisorReasoningEffort,
  AdvisorHostedToolCall,
  AdvisorHostedToolDefinition,
  AdvisorHostedUsage,
} from './advisor-provider-contract'

const {
  ANTHROPIC_VERSION,
  abortError,
  abortable,
  DESCRIPTORS,
  MAX_MESSAGES,
  MAX_MODELS,
  MAX_MODEL_PAGE_SIZE,
  MAX_MODEL_PAGES,
  MAX_PAGE_TOKEN_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_SSE_EVENTS,
  MAX_TOOL_CALLS,
  PROBE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  authHeaders,
  boundedJson,
  boundedString,
  emitUsage,
  fetchResponse,
  isRecord,
  normalizeTools,
  providerUrl,
  readJson,
  requestHeaders,
  safeError,
  safeModelLabel,
  statusCheck,
  throwIfAborted,
  validModel,
  validProvider,
  validRequestId,
  reasoningCapabilityFromMetadata,
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
  const reasoningEffort = value.reasoningEffort
  if (reasoningEffort !== undefined && !['default', 'low', 'medium', 'high', 'max'].includes(String(reasoningEffort))) throw new HostedAdapterError('request-malformed', 'Advisor reasoning effort is invalid.')
  return {
    requestId,
    request: {
      provider: value.provider,
      model: value.model,
      messages: normalizeMessages(value.messages),
      tools: normalizeTools(value.tools),
      stream: value.stream === undefined ? true : value.stream === true,
      consent: true,
      ...(reasoningEffort !== undefined ? { reasoningEffort: reasoningEffort as AdvisorReasoningEffort } : {}),
      ...(value.harnessConformance === true ? { harnessConformance: true as const } : {}),
    },
  }
}
function baseCapabilities(
  conversational: AdvisorHostedModelCapabilities['conversational'] = 'unknown',
  streaming: AdvisorHostedModelCapabilities['streaming'] = 'unknown',
  toolCall: AdvisorHostedCapabilityState = 'unknown',
): AdvisorHostedModelCapabilities {
  return { conversational, streaming, toolCall }
}

function unsupportedCapabilities(): AdvisorHostedModelCapabilities {
  return { conversational: 'unavailable', streaming: 'unsupported', toolCall: 'unsupported' }
}

type HostedProtocolRegistry = Map<string, AdvisorHostedProtocol | null>
type HostedReasoningRegistry = Map<string, AdvisorHostedReasoningCapability | null>
type HostedConformanceRecord = {
  state: 'verified' | 'failed-conformance'
  toolCall: AdvisorHostedCapabilityState
  protocol: AdvisorHostedProtocol
}
type HostedConformanceRegistry = Map<string, HostedConformanceRecord>

function modelKey(provider: AdvisorHostedProviderId, model: string): string {
  return provider + '\u0000' + model
}

function conformanceKey(provider: AdvisorHostedProviderId, model: string, protocol: AdvisorHostedProtocol): string {
  return modelKey(provider, model) + '\u0000' + protocol
}

function conformanceFailureCode(error: unknown): boolean {
  if (!(error instanceof HostedAdapterError)) return false
  return error.code === 'response-malformed' || error.code === 'tool-malformed' || error.code === 'tool-unsupported' || error.code === 'response-too-large'
}

function modelRows(
  provider: AdvisorHostedProviderId,
  payload: Record<string, unknown>,
  models: AdvisorHostedModel[],
  seen: Set<string>,
  protocols: HostedProtocolRegistry,
  reasoning: HostedReasoningRegistry,
  conformance: HostedConformanceRegistry,
): string | null {
  const kind = DESCRIPTORS[provider].modelListKind
  const rows = kind === 'gemini' ? payload.models : payload.data
  if (!Array.isArray(rows)) throw new HostedAdapterError('response-malformed', 'The provider model listing was malformed.')
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = kind === 'gemini' ? row.name : row.id
    if (!validModel(id) || seen.has(id)) continue
    const display = kind === 'anthropic' ? row.display_name : kind === 'gemini' ? row.displayName : kind === 'openrouter' ? row.name : id
    const label = typeof display === 'string' && display.length <= 160 ? display : safeModelLabel(id)
    const methods = kind === 'gemini' && Array.isArray(row.supportedGenerationMethods)
      ? row.supportedGenerationMethods.filter(item => typeof item === 'string')
      : []
    const key = modelKey(provider, id)
    const protocol = DESCRIPTORS[provider].protocolForModel(id, row)
    const previousProtocol = protocols.get(key)
    if (protocols.has(key) && previousProtocol !== protocol && previousProtocol) {
      conformance.delete(conformanceKey(provider, id, previousProtocol))
    }
    protocols.set(key, protocol)
    const reasoningCapability = protocol ? reasoningCapabilityFromMetadata(row, protocol) : null
    reasoning.set(key, reasoningCapability)
    const conformanceRecord = protocol ? conformance.get(conformanceKey(provider, id, protocol)) : undefined
    const supported = kind !== 'gemini' || methods.length === 0 || methods.includes('generateContent')
    const openRouterParameters = kind === 'openrouter' && Array.isArray(row.supported_parameters)
      ? row.supported_parameters.filter(item => typeof item === 'string')
      : null
    const openRouterToolsAdvertised = openRouterParameters?.includes('tools') === true
    const conversational: AdvisorHostedModelCapabilities['conversational'] = kind === 'gemini'
      ? methods.length === 0 ? 'unknown' : supported ? 'available' : 'unavailable'
      : kind === 'openrouter' || kind === 'opencode-zen' ? 'available' : 'unknown'
    const streaming: AdvisorHostedModelCapabilities['streaming'] = kind === 'gemini'
      ? methods.length === 0 ? 'unknown' : methods.includes('streamGenerateContent') ? 'supported' : 'unsupported'
      : 'unknown'
    const advertisedToolCall = kind === 'openrouter'
      ? openRouterParameters === null ? 'unknown' : openRouterToolsAdvertised ? 'unknown' : 'unsupported'
      : kind === 'opencode-zen' ? protocol ? 'unknown' : 'unsupported'
        : 'unknown'
    const toolCall = conformanceRecord?.state === 'verified'
      ? conformanceRecord.toolCall
      : conformanceRecord?.state === 'failed-conformance'
        ? 'failed-conformance'
        : advertisedToolCall
    const capabilities = supported && protocol
      ? {
          ...baseCapabilities(conformanceRecord?.state === 'verified' ? 'available' : conversational, streaming, toolCall as AdvisorHostedCapabilityState),
          ...(reasoningCapability ? { reasoningEfforts: reasoningCapability.efforts } : {}),
        }
      : unsupportedCapabilities()
    const state: AdvisorHostedModel['state'] = !supported
      ? 'unsupported'
      : kind === 'opencode-zen' && !protocol
        ? 'unsupported'
        : conformanceRecord?.state === 'failed-conformance'
          ? 'failed-conformance'
          : conformanceRecord?.state === 'verified'
            ? 'verified'
        : kind === 'openrouter' && toolCall === 'unsupported'
          ? 'limited'
          : kind === 'openrouter' && toolCall === 'unknown'
            ? 'unverified'
            : kind === 'opencode-zen'
              ? 'unverified'
              : 'discovered'
    const limitation = !supported
      ? 'The provider listing does not report the required text generation capability.'
      : kind === 'opencode-zen' && !protocol
        ? 'OpenCode Zen did not publish a reviewed protocol mapping for this model.'
        : conformanceRecord?.state === 'failed-conformance'
          ? 'This exact model failed a bounded Metrora Harness response check; it is not eligible for hosted Harness use until reverified.'
          : conformanceRecord?.state === 'verified'
            ? 'This exact model passed a bounded Metrora Harness request; deterministic evidence retrieval remains authoritative.'
        : kind === 'openrouter' && toolCall === 'unsupported'
          ? 'This model does not advertise tool calls; Advisor can use deterministic evidence retrieval plus hosted synthesis.'
        : kind === 'openrouter' && toolCall === 'unknown'
          ? openRouterToolsAdvertised
            ? 'This model advertises tool calls, but Metrora Harness conformance is not verified; deterministic evidence retrieval remains authoritative.'
            : 'OpenRouter did not report tool-call capability for this model; Advisor will use deterministic evidence retrieval plus hosted synthesis until verified.'
          : kind === 'opencode-zen'
            ? 'Discovered from OpenCode Zen; the model protocol is documented, but Metrora Harness conformance and tool capability are not verified.'
            : 'Discovered from the provider model listing; Metrora Harness compatibility is not verified.'
    models.push({
      id,
      label,
      state,
      limitation,
      capabilities,
    })
    seen.add(id)
    if (models.length >= MAX_MODELS) break
  }
  if (kind === 'openai' || kind === 'openrouter' || kind === 'opencode-zen') return null
  if (kind === 'anthropic') {
    if (payload.has_more !== true) return null
    if (typeof payload.last_id !== 'string' || !payload.last_id.trim()) throw new HostedAdapterError('response-malformed', 'The provider model listing pagination was malformed.')
    return boundedString(payload.last_id, MAX_PAGE_TOKEN_BYTES, 'The provider model listing pagination token is too large.')
  }
  if (typeof payload.nextPageToken !== 'string' || !payload.nextPageToken.trim()) return null
  return boundedString(payload.nextPageToken, MAX_PAGE_TOKEN_BYTES, 'The provider model listing pagination token is too large.')
}
const PROVIDER_LABELS: Record<AdvisorHostedProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  'opencode-zen': 'OpenCode Zen',
}
function providerDetail(provider: AdvisorHostedProviderId): string { return PROVIDER_LABELS[provider] + ' is reachable.' }
function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Advisor request cancelled.')
  error.name = 'AbortError'
  throw error
}
function withOptionalAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  return signal ? abortable(operation, signal) : operation
}
function credentialDetail(status: AdvisorHostedCredentialStatus): string {
  if (status.state === 'not-configured') return 'Add your provider credential to use hosted Advisor.'
  if (status.state === 'locked-unavailable') return 'Secure credential storage is unavailable on this device.'
  if (status.state === 'invalid') return 'The saved provider credential is invalid; enter it again.'
  if (status.state === 'needs-reentry') return 'The saved provider credential needs to be entered again.'
  return 'The provider credential is unavailable.'
}

function parseSseLine(line: string, data: string[]): void {
  if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
}
type SseReadResult = { sawDone: boolean; payloadCount: number }
function rejectProviderStreamError(payload: Record<string, unknown>): void {
  if ((payload.error !== undefined && payload.error !== null) || payload.type === 'error' || payload.type === 'response.failed' || payload.type === 'response.incomplete' || payload.type === 'response.cancelled') {
    throw new HostedAdapterError('provider-unavailable', 'The provider stream reported an error.')
  }
}
async function readSse(response: Response, onPayload: (payload: Record<string, unknown>) => void, signal?: AbortSignal): Promise<SseReadResult> {
  if (signal) throwIfAborted(signal)
  const reader = response.body?.getReader()
  if (!reader) {
    const payload = await readJson(response, signal)
    rejectProviderStreamError(payload)
    onPayload(payload)
    return { sawDone: false, payloadCount: 1 }
  }
  const onAbort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })
  const decoder = new TextDecoder()
  let pending = ''
  let bytes = 0
  let events = 0
  let payloadCount = 0
  let sawDone = false
  let data: string[] = []
  const dispatch = () => {
    if (!data.length) return
    const joined = data.join('\n')
    data = []
    if (joined === '[DONE]') {
      sawDone = true
      return
    }
    let payload: unknown
    try { payload = JSON.parse(joined) } catch { throw new HostedAdapterError('response-malformed', 'The provider stream was malformed.') }
    if (!isRecord(payload)) throw new HostedAdapterError('response-malformed', 'The provider stream was malformed.')
    events += 1
    if (events > MAX_SSE_EVENTS) throw new HostedAdapterError('response-too-large', 'The provider stream exceeded the event limit.')
    payloadCount += 1
    rejectProviderStreamError(payload)
    onPayload(payload)
  }
  try {
    while (true) {
      if (signal) throwIfAborted(signal)
      const part = await reader.read()
      if (signal) throwIfAborted(signal)
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
    return { sawDone, payloadCount }
  } catch (error) {
    if (signal?.aborted) throw abortError()
    throw error
  } finally { signal?.removeEventListener('abort', onAbort) }
}
async function discover(
  provider: AdvisorHostedProviderId,
  secret: string,
  fetchImpl: FetchLike,
  parent: AbortSignal | undefined,
  protocols: HostedProtocolRegistry,
  reasoning: HostedReasoningRegistry,
  conformance: HostedConformanceRegistry,
): Promise<AdvisorHostedModel[]> {
  const descriptor = DESCRIPTORS[provider]
  const models: AdvisorHostedModel[] = []
  const seen = new Set<string>()
  const seenTokens = new Set<string>()
  let nextToken: string | null = null
  for (let page = 0; page < MAX_MODEL_PAGES && models.length < MAX_MODELS; page += 1) {
    const url = new URL(descriptor.modelsPath, descriptor.origin)
    if (descriptor.modelListKind === 'anthropic') {
      url.searchParams.set('limit', String(MAX_MODEL_PAGE_SIZE))
      if (nextToken) url.searchParams.set('after_id', nextToken)
    } else if (descriptor.modelListKind === 'gemini') {
      url.searchParams.set('pageSize', String(MAX_MODEL_PAGE_SIZE))
      if (nextToken) url.searchParams.set('pageToken', nextToken)
    }
    const request = await fetchResponse(fetchImpl, providerUrl(provider, url.pathname + url.search), { method: 'GET', headers: { Accept: 'application/json', ...authHeaders(provider, secret) } }, PROBE_TIMEOUT_MS, parent)
    try {
      statusCheck(request.response)
      nextToken = modelRows(provider, await readJson(request.response, request.signal), models, seen, protocols, reasoning, conformance)
    } finally { request.dispose() }
    if (!nextToken || seenTokens.has(nextToken)) break
    seenTokens.add(nextToken)
  }
  return models
}
async function hostedChat(
  provider: AdvisorHostedProviderId,
  secret: string,
  requestId: string,
  request: AdvisorHostedChatRequest,
  fetchImpl: FetchLike,
  emit: EventEmitter,
  parent: AbortSignal | undefined,
  protocols: HostedProtocolRegistry,
  reasoning: HostedReasoningRegistry,
  conformance: HostedConformanceRegistry,
): Promise<AdvisorHostedChatResult> {
  const stream = request.stream === true
  const key = modelKey(provider, request.model)
  // An exact model discovered from provider metadata owns its resolved
  // protocol for the lifetime of this handler. An explicit null is also
  // retained, so an unknown listing cannot fall back to a name guess.
  const protocol = protocols.has(key) ? protocols.get(key) ?? null : DESCRIPTORS[provider].protocolForModel(request.model)
  if (!protocol) throw new HostedAdapterError('model-unavailable', 'The selected provider model has no approved Advisor protocol.')
  const reasoningCapability = reasoning.has(key) ? reasoning.get(key) ?? null : null
  const selectedEffort = request.reasoningEffort ?? 'default'
  if (selectedEffort !== 'default' && (!reasoningCapability || !reasoningCapability.efforts.includes(selectedEffort))) {
    throw new HostedAdapterError('request-unsupported', 'The selected model does not advertise this reasoning level.')
  }
  const adapter = protocolAdapter(protocol)
  const result = await fetchResponse(fetchImpl, providerUrl(provider, DESCRIPTORS[provider].chatPath(request.model, stream, protocol)), {
    method: 'POST',
    headers: requestHeaders(provider, secret, stream, protocol),
    body: boundedJson(bodyFor(provider, protocol, request, reasoningCapability?.parameter), 'Advisor hosted request exceeded the safety limit.'),
  }, REQUEST_TIMEOUT_MS, parent)
  emit({ requestId, provider, model: request.model, kind: 'started' })
  try {
    statusCheck(result.response)
    const state = streamState()
    let usage: AdvisorHostedUsage | null = null
    const contentType = result.response.headers.get('content-type') ?? ''
    if (stream && (!contentType || contentType.includes('text/event-stream'))) {
      const sse = await readSse(result.response, payload => adapter.parseStream(payload, state, provider, requestId, request.model, emit), result.signal)
      if (protocol === 'openai-responses' && !state.terminal) throw new HostedAdapterError('response-malformed', 'The provider stream ended before completion.')
      if (protocol === 'anthropic-messages' && !state.terminal) throw new HostedAdapterError('response-malformed', 'The provider stream ended before completion.')
      if (protocol === 'gemini-content' && !state.terminal) throw new HostedAdapterError('response-malformed', 'The provider stream ended before completion.')
      if (protocol === 'openai-chat' && !state.terminal && !sse.sawDone) throw new HostedAdapterError('response-malformed', 'The provider stream ended before completion.')
      if (protocol !== 'gemini-content') finalizeOpenToolCalls(state, provider, requestId, request.model, emit, protocol !== 'openai-chat')
      usage = state.usage
    } else {
      const parsed = adapter.parseJson(await readJson(result.response, result.signal), provider, requestId, request.model, emit)
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
    if (request.harnessConformance === true) {
      conformance.set(conformanceKey(provider, request.model, protocol), {
        state: 'verified',
        toolCall: value.message.tool_calls.length ? 'supported' : 'unknown',
        protocol,
      })
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
  // Credential validity, provider reachability, model discovery, and Harness
  // conformance are intentionally separate pieces of state. The protocol
  // registry is exact-provider/model state, not a global model-name map.
  const protocols: HostedProtocolRegistry = new Map()
  const reasoning: HostedReasoningRegistry = new Map()
  const conformance = new Map<string, HostedConformanceRecord>()
  const fail = (error: unknown, fallback: string): AdvisorHostedEnvelope => {
    const safe = safeError(error)
    return { ok: false, error: { kind: error instanceof HostedAdapterError ? safe.code : fallback, message: safe.message } }
  }
  return {
    'metrora:advisorHostedProbe': async (providerValue: unknown, requestIdValue?: unknown): Promise<AdvisorHostedEnvelope> => {
      if (!validProvider(providerValue)) return { ok: false, error: { kind: 'validation', message: 'Advisor hosted provider is invalid.' } }
      if (requestIdValue !== undefined && !validRequestId(requestIdValue)) return { ok: false, error: { kind: 'validation', message: 'Advisor request id is invalid.' } }
      const probeRequestId = typeof requestIdValue === 'string' ? requestIdValue : null
      if (probeRequestId && flights.has(probeRequestId)) return { ok: false, error: { kind: 'request-in-flight', message: 'Advisor request id is already active.' } }
      const controller = probeRequestId ? new AbortController() : null
      if (controller && probeRequestId) flights.set(probeRequestId, controller)
      try {
        throwIfCancelled(controller?.signal)
        let status: AdvisorHostedCredentialStatus
        try { status = await withOptionalAbort(options.credentialStatus(providerValue), controller?.signal) } catch {
          throwIfCancelled(controller?.signal)
          status = { provider: providerValue, state: 'locked-unavailable' }
        }
        throwIfCancelled(controller?.signal)
        if (status.state !== 'ready') return { ok: true, value: { provider: providerValue, available: false, models: [], detail: credentialDetail(status), credentialState: status.state } satisfies AdvisorHostedProbe }
        let secret: string | null
        try { secret = await withOptionalAbort(options.readCredential(providerValue), controller?.signal) } catch {
          throwIfCancelled(controller?.signal)
          secret = null
        }
        throwIfCancelled(controller?.signal)
        if (!secret) return { ok: true, value: { provider: providerValue, available: false, models: [], detail: 'The saved provider credential needs to be entered again.', credentialState: 'needs-reentry' } satisfies AdvisorHostedProbe }
        const models = await discover(providerValue, secret, fetchImpl, controller?.signal, protocols, reasoning, conformance)
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
      if (flights.has(parsed.requestId)) return { ok: false, error: { kind: 'request-in-flight', message: 'Advisor request id is already active.' } }
      const controller = new AbortController()
      flights.set(parsed.requestId, controller)
      const emit = (event: AdvisorHostedEvent) => emitEvent({ ...event, requestId: parsed.requestId })
      try {
        throwIfCancelled(controller.signal)
        let status: AdvisorHostedCredentialStatus
        try { status = await withOptionalAbort(options.credentialStatus(parsed.request.provider), controller.signal) } catch {
          throwIfCancelled(controller.signal)
          status = { provider: parsed.request.provider, state: 'locked-unavailable' }
        }
        throwIfCancelled(controller.signal)
        if (status.state !== 'ready') return { ok: false, error: { kind: 'credential-unavailable', message: credentialDetail(status) } }
        let secret: string | null
        try { secret = await withOptionalAbort(options.readCredential(parsed.request.provider), controller.signal) } catch {
          throwIfCancelled(controller.signal)
          secret = null
        }
        throwIfCancelled(controller.signal)
        if (!secret) return { ok: false, error: { kind: 'credential-unavailable', message: 'The saved provider credential needs to be entered again.' } }
        const value = await hostedChat(parsed.request.provider, secret, parsed.requestId, parsed.request, fetchImpl, emit, controller.signal, protocols, reasoning, conformance)
        return { ok: true, value }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          emit({ requestId: parsed.requestId, provider: parsed.request.provider, model: parsed.request.model, kind: 'cancelled' })
          return { ok: false, error: { kind: 'cancelled', message: 'Advisor request cancelled.' } }
        }
        if (parsed.request.harnessConformance === true && conformanceFailureCode(error)) {
          const model = modelKey(parsed.request.provider, parsed.request.model)
          const protocol = protocols.has(model) ? protocols.get(model) ?? null : DESCRIPTORS[parsed.request.provider].protocolForModel(parsed.request.model)
          if (protocol) conformance.set(conformanceKey(parsed.request.provider, parsed.request.model, protocol), { state: 'failed-conformance', toolCall: 'failed-conformance', protocol })
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
  openrouter: { origin: DESCRIPTORS.openrouter.origin, modelsPath: DESCRIPTORS.openrouter.modelsPath, chatPath: '/api/v1/chat/completions', protocol: 'openai-chat' as const },
  'opencode-zen': {
    origin: DESCRIPTORS['opencode-zen'].origin,
    modelsPath: DESCRIPTORS['opencode-zen'].modelsPath,
    modelProtocol: 'per-model' as const,
    chatPaths: {
      responses: '/zen/v1/responses',
      messages: '/zen/v1/messages',
      chat: '/zen/v1/chat/completions',
      gemini: '/zen/v1/models/{model}:generateContent',
      geminiStream: '/zen/v1/models/{model}:streamGenerateContent?alt=sse',
    },
  },
} as const
