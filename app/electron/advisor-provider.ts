import * as contract from './advisor-provider-contract'
import type {
  AdvisorHostedChatMessage,
  AdvisorHostedChatRequest,
  AdvisorHostedChatResult,
  AdvisorHostedCredentialStatus,
  AdvisorHostedEnvelope,
  AdvisorHostedEvent,
  AdvisorHostedProbe,
  AdvisorHostedProviderId,
  AdvisorHostedContinuationReference,
  AdvisorReasoningEffort,
  AdvisorHostedUsage,
  CredentialReader,
  CredentialStatusReader,
  EventEmitter,
  FetchLike,
} from './advisor-provider-contract'
import { bodyFor, finalizeOpenToolCalls, protocolAdapter, streamState } from './advisor-provider-adapters'
import { runOpenAiCompatibleStep } from './advisor-provider-ai-sdk'
import { HOSTED_CONTINUATION_ADAPTER, normalizeHostedContinuationReference, validReasoningEffort, type AdvisorHostedContinuationPayload } from './advisor-provider-continuation'
import { createHostedContinuationStore, type HostedContinuationIdentity, type HostedContinuationStore } from './advisor-provider-continuation-store'
import {
  createMemoryAdvisorConformanceStore,
  type AdvisorConformanceStore,
  type AdvisorConformanceRecord,
} from './advisor-conformance-store'
import {
  conformanceCapabilities,
  conformanceKey,
  currentConformanceFingerprint,
  discover,
  modelKey,
  type HostedCapabilityRegistry,
  type HostedConformanceRegistry,
  type HostedProtocolRegistry,
  type HostedReasoningRegistry,
} from './advisor-provider-discovery'
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
  AdvisorHostedContinuationReference,
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
  MAX_RESPONSE_BYTES,
  MAX_SSE_EVENTS,
  MAX_TOOL_CALLS,
  REQUEST_TIMEOUT_MS,
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
  statusCheck,
  normalizeToolCall,
  throwIfAborted,
  toolName,
  validModel,
  validProvider,
  validRequestId,
} = contract
const { HostedAdapterError } = contract
export { HostedAdapterError }

function normalizeMessages(value: unknown): AdvisorHostedChatMessage[] {
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) throw new HostedAdapterError('request-malformed', 'Advisor messages are malformed.')
  let callCount = 0
  const callIds = new Set<string>()
  const completedCallIds = new Set<string>()
  return value.map((item, messageIndex) => {
    if (!isRecord(item) || !['system', 'user', 'assistant', 'tool'].includes(String(item.role))) throw new HostedAdapterError('request-malformed', 'Advisor messages are malformed.')
    const role = item.role as AdvisorHostedChatMessage['role']
    if (typeof item.content !== 'string' || contract.byteLength(item.content) > 32_000 || ((role === 'system' || role === 'user') && !item.content.trim())) throw new HostedAdapterError('request-malformed', 'Advisor message content is malformed.')
    const content = item.content
    if (role === 'assistant') {
      if (Object.prototype.hasOwnProperty.call(item, 'tool_calls')) throw new HostedAdapterError('request-malformed', 'Advisor messages must use semantic tool calls.')
      if (item.toolCalls === undefined) return { role, content }
      if (!Array.isArray(item.toolCalls) || item.toolCalls.length === 0 || item.toolCalls.length > MAX_TOOL_CALLS || callCount + item.toolCalls.length > MAX_TOOL_CALLS) {
        throw new HostedAdapterError('request-malformed', 'Advisor tool-call history is malformed.')
      }
      const toolCalls = item.toolCalls.map((raw, callIndex) => {
        if (!isRecord(raw)) throw new HostedAdapterError('request-malformed', 'Advisor tool-call history is malformed.')
        const fallback = 'metrora-call-' + messageIndex + '-' + callIndex
        const id = raw.id === undefined ? fallback : boundedString(raw.id, 128, 'Advisor tool-call id is invalid.')
        const call = normalizeToolCall(id, raw.name, raw.arguments, fallback)
        callCount += 1
        if (callIds.has(call.id)) throw new HostedAdapterError('request-malformed', 'Advisor tool-call IDs must be unique within a request.')
        callIds.add(call.id)
        return call
      })
      return { role, content, toolCalls }
    }
    if (role === 'tool') {
      if (Object.prototype.hasOwnProperty.call(item, 'tool_calls') || Object.prototype.hasOwnProperty.call(item, 'toolCalls')) throw new HostedAdapterError('request-malformed', 'Advisor tool results are malformed.')
      const toolCallId = boundedString(item.toolCallId, 128, 'Advisor tool-result call ID is invalid.')
      if (!callIds.has(toolCallId) || completedCallIds.has(toolCallId)) throw new HostedAdapterError('request-malformed', 'Advisor tool result does not match a pending tool call.')
      completedCallIds.add(toolCallId)
      const rawToolName = item.toolName
      const normalizedToolName = rawToolName === undefined ? '' : toolName(rawToolName)
      if (rawToolName !== undefined && (!normalizedToolName || !contract.TOOL_NAMES.has(normalizedToolName))) throw new HostedAdapterError('tool-unsupported', 'Advisor tool-result name is not allowed.')
      return { role, content, toolCallId, ...(normalizedToolName ? { toolName: normalizedToolName } : {}) }
    }
    if (Object.prototype.hasOwnProperty.call(item, 'toolCalls') || Object.prototype.hasOwnProperty.call(item, 'toolCallId') || Object.prototype.hasOwnProperty.call(item, 'toolName')) throw new HostedAdapterError('request-malformed', 'Advisor messages are malformed.')
    return { role, content }
  })
}
function parseChatRequest(requestId: unknown, value: unknown): { requestId: string; request: AdvisorHostedChatRequest } {
  if (!validRequestId(requestId) || !isRecord(value) || value.consent !== true || !validProvider(value.provider) || !validModel(value.model)) throw new HostedAdapterError('request-malformed', 'Advisor hosted request is invalid.')
  const reasoningEffort = value.reasoningEffort
  if (reasoningEffort !== undefined && !validReasoningEffort(reasoningEffort)) throw new HostedAdapterError('request-malformed', 'Advisor reasoning effort is invalid.')
  const messageMode = value.messageMode === undefined ? 'native' : value.messageMode
  if (messageMode !== 'native' && messageMode !== 'flattened') throw new HostedAdapterError('request-malformed', 'Advisor message mode is invalid.')
  const continuation = value.continuation === undefined ? undefined : normalizeHostedContinuationReference(value.continuation)
  if (value.continuation !== undefined && !continuation) throw new HostedAdapterError('request-malformed', 'Advisor provider continuation is malformed.')
  return {
    requestId,
    request: {
      provider: value.provider,
      model: value.model,
      messages: normalizeMessages(value.messages),
      tools: normalizeTools(value.tools),
      stream: value.stream === undefined ? true : value.stream === true,
      consent: true,
      messageMode,
      ...(reasoningEffort !== undefined ? { reasoningEffort: reasoningEffort as AdvisorReasoningEffort } : {}),
      ...(continuation ? { continuation } : {}),
      ...(value.harnessConformance === true ? { harnessConformance: true as const } : {}),
    },
  }
}
function conformanceFailureCode(error: unknown): boolean {
  if (!(error instanceof HostedAdapterError)) return false
  return error.code === 'response-malformed' || error.code === 'tool-malformed' || error.code === 'tool-unsupported' || error.code === 'response-too-large'
}

async function persistConformance(store: AdvisorConformanceStore, conformance: HostedConformanceRegistry): Promise<void> {
  try { await store.save([...conformance.entries()]) } catch { /* conformance persistence is best effort */ }
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
  capabilitiesByModel: HostedCapabilityRegistry,
  conformanceStore: AdvisorConformanceStore,
  continuationStore: HostedContinuationStore,
): Promise<AdvisorHostedChatResult> {
  const stream = request.stream === true
  const key = modelKey(provider, request.model)
  // An exact model discovered from provider metadata owns its resolved
  // protocol for the lifetime of this handler. An explicit null is also
  // retained, so an unknown listing cannot fall back to a name guess.
  const protocol = protocols.has(key) ? protocols.get(key) ?? null : DESCRIPTORS[provider].protocolForModel(request.model)
  if (!protocol) throw new HostedAdapterError('model-unavailable', 'The selected provider model has no approved Advisor protocol.')
  const reasoningCapability = reasoning.has(key) ? reasoning.get(key) ?? null : null
  const capabilityInputs = capabilitiesByModel.get(key) ?? conformanceCapabilities('unknown', 'unknown', 'unknown', reasoningCapability?.efforts)
  const fingerprint = currentConformanceFingerprint(provider, request.model, protocol, capabilityInputs)
  const selectedEffort = request.reasoningEffort ?? 'default'
  if (selectedEffort !== 'default' && (!reasoningCapability || !reasoningCapability.efforts.includes(selectedEffort))) {
    throw new HostedAdapterError('request-unsupported', 'The selected model does not advertise this reasoning level.')
  }
  const useAiSdk = (provider === 'openrouter' || provider === 'opencode-zen') && protocol === 'openai-chat' && request.messageMode !== 'flattened' && request.harnessConformance === true
  const continuationReference = request.continuation
  let continuationPayload: AdvisorHostedContinuationPayload | null = null
  if (continuationReference && !useAiSdk) {
    throw new HostedAdapterError('continuation-unavailable', 'The provider continuation is not valid for this exact adapter.')
  }
  if (continuationReference) {
    const expected: HostedContinuationIdentity = {
      provider,
      model: request.model,
      protocol: 'openai-chat',
      adapter: HOSTED_CONTINUATION_ADAPTER,
    }
    continuationPayload = continuationStore.acquire(continuationReference, expected)
    if (!continuationPayload) throw new HostedAdapterError('continuation-unavailable', 'The provider continuation expired or does not match this exact provider adapter.')
  }
  if (useAiSdk) {
    const timed = contract.timeoutRequest(parent, REQUEST_TIMEOUT_MS)
    let committedReference: AdvisorHostedContinuationReference | undefined
    try {
      const value = await runOpenAiCompatibleStep({ provider, secret, request, requestId, fetchImpl, signal: timed.signal, emit, ...(continuationPayload ? { continuation: continuationPayload } : {}) })
      contract.throwIfAborted(timed.signal)
      const { continuationPayload: nextPayload, ...publicValue } = value
      const nextReference = nextPayload
        ? continuationStore.replace(continuationReference, nextPayload)
        : undefined
      if (nextPayload && !nextReference) throw new HostedAdapterError('continuation-unavailable', 'The bounded provider continuation store is full or unavailable.')
      if (continuationReference && !nextPayload) continuationStore.retire(continuationReference)
      committedReference = nextReference ?? undefined
      contract.throwIfAborted(timed.signal)
      if (request.harnessConformance === true) {
        conformance.set(conformanceKey(provider, request.model, protocol), {
          state: 'verified',
          toolCall: publicValue.message.tool_calls.length ? 'supported' : capabilityInputs.toolCall === 'supported' ? 'supported' : 'unknown',
          protocol,
          fingerprint,
          verifiedAt: new Date().toISOString(),
        })
        await persistConformance(conformanceStore, conformance)
      }
      return { ...publicValue, ...(nextReference ? { continuation: nextReference } : {}) }
    } catch (error) {
      if (committedReference) continuationStore.retire(committedReference)
      if (continuationReference && continuationPayload) {
        const cancelled = timed.signal.aborted || parent?.aborted || (error instanceof Error && error.name === 'AbortError')
        if (cancelled) continuationStore.retire(continuationReference)
        else continuationStore.release(continuationReference)
      }
      throw error
    } finally {
      timed.dispose()
    }
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
        // A text-only conformance response proves the bounded conversational
        // path, not the absence of native tools. Preserve an explicitly
        // advertised native capability until a tool-bearing request actually
        // exercises it.
        toolCall: value.message.tool_calls.length
          ? 'supported'
          : capabilityInputs.toolCall === 'supported' ? 'supported' : 'unknown',
        protocol,
        fingerprint,
        verifiedAt: new Date().toISOString(),
      })
      await persistConformance(conformanceStore, conformance)
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
  conformanceStore?: AdvisorConformanceStore
  continuationStore?: HostedContinuationStore
}): Record<string, (...args: any[]) => Promise<AdvisorHostedEnvelope>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const emitEvent = options.emitEvent ?? (() => {})
  const conformanceStore = options.conformanceStore ?? createMemoryAdvisorConformanceStore()
  const continuationStore = options.continuationStore ?? createHostedContinuationStore()
  const flights = new Map<string, AbortController>()
  const flightContinuations = new Map<string, AdvisorHostedContinuationReference>()
  // Credential validity, provider reachability, model discovery, and Harness
  // conformance are intentionally separate pieces of state. The protocol
  // registry is exact-provider/model state, not a global model-name map.
  const protocols: HostedProtocolRegistry = new Map()
  const reasoning: HostedReasoningRegistry = new Map()
  const capabilitiesByModel: HostedCapabilityRegistry = new Map()
  const conformance = new Map<string, AdvisorConformanceRecord>()
  let conformanceLoad: Promise<void> | null = null
  const ensureConformanceLoaded = async (): Promise<void> => {
    if (!conformanceLoad) {
      conformanceLoad = conformanceStore.load().then(entries => {
        for (const [key, record] of entries) conformance.set(key, record)
      }).catch(() => {})
    }
    await conformanceLoad
  }
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
        await ensureConformanceLoaded()
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
        const models = await discover(providerValue, secret, fetchImpl, controller?.signal, protocols, reasoning, conformance, capabilitiesByModel)
        await persistConformance(conformanceStore, conformance)
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
      if (parsed.request.continuation) flightContinuations.set(parsed.requestId, parsed.request.continuation)
      const emit = (event: AdvisorHostedEvent) => emitEvent({ ...event, requestId: parsed.requestId })
      try {
        await ensureConformanceLoaded()
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
        const value = await hostedChat(parsed.request.provider, secret, parsed.requestId, parsed.request, fetchImpl, emit, controller.signal, protocols, reasoning, conformance, capabilitiesByModel, conformanceStore, continuationStore)
        return { ok: true, value }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          const continuation = flightContinuations.get(parsed.requestId)
          if (continuation) continuationStore.retire(continuation)
          emit({ requestId: parsed.requestId, provider: parsed.request.provider, model: parsed.request.model, kind: 'cancelled' })
          return { ok: false, error: { kind: 'cancelled', message: 'Advisor request cancelled.' } }
        }
        if (parsed.request.harnessConformance === true && conformanceFailureCode(error)) {
          const model = modelKey(parsed.request.provider, parsed.request.model)
          const protocol = protocols.has(model) ? protocols.get(model) ?? null : DESCRIPTORS[parsed.request.provider].protocolForModel(parsed.request.model)
          if (protocol) {
            const key = modelKey(parsed.request.provider, parsed.request.model)
            const capabilityInputs = capabilitiesByModel.get(key) ?? conformanceCapabilities('unknown', 'unknown', 'unknown', reasoning.get(key)?.efforts)
            conformance.set(conformanceKey(parsed.request.provider, parsed.request.model, protocol), {
              state: 'failed-conformance',
              toolCall: 'failed-conformance',
              protocol,
              fingerprint: currentConformanceFingerprint(parsed.request.provider, parsed.request.model, protocol, capabilityInputs),
              verifiedAt: new Date().toISOString(),
            })
            await persistConformance(conformanceStore, conformance)
          }
        }
        const safe = safeError(error)
        emit({ requestId: parsed.requestId, provider: parsed.request.provider, model: parsed.request.model, kind: 'failed', code: safe.code, message: safe.message })
        return { ok: false, error: { kind: safe.code, message: safe.message } }
      } finally {
        if (flights.get(parsed.requestId) === controller) flights.delete(parsed.requestId)
        if (flightContinuations.get(parsed.requestId) === parsed.request.continuation) flightContinuations.delete(parsed.requestId)
      }
    },
    'metrora:advisorHostedCancel': async (requestIdValue: unknown): Promise<AdvisorHostedEnvelope> => {
      if (!validRequestId(requestIdValue)) return { ok: false, error: { kind: 'validation', message: 'Advisor request id is invalid.' } }
      const controller = flights.get(requestIdValue)
      const continuation = flightContinuations.get(requestIdValue)
      if (continuation) continuationStore.retire(continuation)
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
