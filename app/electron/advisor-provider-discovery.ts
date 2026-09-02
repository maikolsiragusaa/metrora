import type {
  AdvisorHostedCapabilityState,
  AdvisorHostedModel,
  AdvisorHostedModelCapabilities,
  AdvisorHostedModelListKind,
  AdvisorHostedProtocol,
  AdvisorHostedProviderId,
  AdvisorHostedReasoningCapability,
  AdvisorHostedRoute,
  AdvisorReasoningEffort,
  FetchLike,
} from './advisor-provider-contract'
import {
  DESCRIPTORS,
  MAX_MODEL_PAGE_SIZE,
  MAX_MODEL_PAGES,
  MAX_MODELS,
  MAX_PAGE_TOKEN_BYTES,
  PROBE_TIMEOUT_MS,
  authHeaders,
  boundedString,
  fetchResponse,
  isRecord,
  providerUrl,
  readJson,
  reasoningCapabilityFromMetadata,
  resolveOpenCodeZenRouteFromMetadata,
  resolveOpenCodeZenProtocolFromMetadata,
  routeForProtocol,
  safeModelLabel,
  statusCheck,
  validModel,
} from './advisor-provider-contract'
import { HostedAdapterError } from './advisor-provider-contract'
import {
  ADVISOR_RUNTIME_CONTRACT_VERSION,
  advisorConformanceFingerprint,
  type AdvisorConformanceCapabilities,
  type AdvisorConformanceRecord,
} from './advisor-conformance-store'
import { reviewedModelsDevCapability, reviewedModelsDevMetadata } from './models-dev-capabilities'

export type HostedProtocolRegistry = Map<string, AdvisorHostedProtocol | null>
export type HostedReasoningRegistry = Map<string, AdvisorHostedReasoningCapability | null>
export type HostedConformanceRegistry = Map<string, AdvisorConformanceRecord>
export type HostedCapabilityRegistry = Map<string, AdvisorConformanceCapabilities>
export type HostedRouteRegistry = Map<string, AdvisorHostedRoute | null>

export function modelKey(provider: AdvisorHostedProviderId, model: string): string {
  return provider + '\u0000' + model
}

export function conformanceKey(provider: AdvisorHostedProviderId, model: string, protocol: AdvisorHostedProtocol): string {
  return modelKey(provider, model) + '\u0000' + protocol
}

export function conformanceCapabilities(
  conversational: AdvisorHostedModelCapabilities['conversational'],
  streaming: AdvisorHostedModelCapabilities['streaming'],
  toolCall: AdvisorHostedCapabilityState,
  reasoningEfforts: readonly AdvisorReasoningEffort[] | undefined,
): AdvisorConformanceCapabilities {
  return {
    conversational,
    streaming,
    toolCall,
    reasoningEfforts: reasoningEfforts?.length ? [...new Set(reasoningEfforts)] : ['default'],
  }
}

function advertisedToolCapability(kind: AdvisorHostedModelListKind, row: Record<string, unknown>, reviewedToolCall?: AdvisorHostedCapabilityState): AdvisorHostedCapabilityState {
  const explicit = [row.tool_call, row.toolCall, row.supports_tools, row.supportsTools].filter(value => typeof value === 'boolean') as boolean[]
  if (explicit.length && explicit.every(value => value === explicit[0])) return explicit[0] ? 'supported' : 'unsupported'
  if (explicit.length) return 'unknown'
  if (kind === 'openrouter' && Array.isArray(row.supported_parameters)) {
    const parameters = row.supported_parameters.filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase())
    if (parameters.includes('tools') || parameters.includes('tool_choice')) return 'supported'
    return 'unsupported'
  }
  return reviewedToolCall ?? 'unknown'
}

export function currentConformanceFingerprint(
  provider: AdvisorHostedProviderId,
  model: string,
  protocol: AdvisorHostedProtocol,
  capabilities: AdvisorConformanceCapabilities,
  route?: AdvisorHostedRoute | null,
): string {
  return advisorConformanceFingerprint({
    provider,
    model,
    protocol,
    capabilities,
    ...(route ? { route } : {}),
    adapter: 'metrora-hosted-provider-v1',
    runtimeContractVersion: ADVISOR_RUNTIME_CONTRACT_VERSION,
  })
}

export function reviewedRouteForModel(provider: AdvisorHostedProviderId, model: string, protocol: AdvisorHostedProtocol | null): AdvisorHostedRoute | null {
  const reviewed = reviewedModelsDevCapability(provider, model)
  if (!reviewed || !protocol || reviewed.protocol !== protocol) return null
  return {
    providerPackage: reviewed.providerPackage,
    providerFamily: reviewed.providerFamily,
    protocol: reviewed.protocol,
    endpointFamily: reviewed.endpointFamily,
    ...(reviewed.interleavedField ? { interleavedField: reviewed.interleavedField } : {}),
  }
}

function reviewedRouteCanCompleteLiveMetadata(row: Record<string, unknown>, route: AdvisorHostedRoute): boolean {
  const provider = isRecord(row.provider) ? row.provider : undefined
  const packageValue = row.providerPackage ?? row.provider_package ?? provider?.npm
  const familyValue = row.providerFamily ?? row.provider_family ?? provider?.family
  const endpointValue = row.endpointFamily ?? row.endpoint_family
  const interleavedValue = isRecord(row.interleaved) ? row.interleaved.field : undefined
  return (packageValue === undefined || packageValue === route.providerPackage)
    && (familyValue === undefined || familyValue === route.providerFamily)
    && (endpointValue === undefined || endpointValue === route.endpointFamily)
    && (interleavedValue === undefined || interleavedValue === route.interleavedField)
}

function modelRows(
  provider: AdvisorHostedProviderId,
  payload: Record<string, unknown>,
  models: AdvisorHostedModel[],
  seen: Set<string>,
  protocols: HostedProtocolRegistry,
  reasoning: HostedReasoningRegistry,
  conformance: HostedConformanceRegistry,
  capabilitiesByModel: HostedCapabilityRegistry,
  routes: HostedRouteRegistry,
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
    const reviewed = reviewedModelsDevCapability(provider, id)
    const explicitProtocol = kind === 'opencode-zen' ? resolveOpenCodeZenProtocolFromMetadata(row) : undefined
    const protocol = kind === 'opencode-zen' && explicitProtocol === undefined
      ? reviewed?.protocol ?? DESCRIPTORS[provider].protocolForModel(id, row)
      : kind === 'opencode-zen' && explicitProtocol !== undefined
        ? explicitProtocol
        : DESCRIPTORS[provider].protocolForModel(id, row)
    const explicitRoute = kind === 'opencode-zen' ? resolveOpenCodeZenRouteFromMetadata(row, protocol) : undefined
    const reviewedRoute = kind === 'opencode-zen' ? reviewedRouteForModel(provider, id, protocol) : null
    const route = kind === 'opencode-zen'
      ? explicitRoute === null
        ? reviewedRoute && reviewedRouteCanCompleteLiveMetadata(row, reviewedRoute) ? reviewedRoute : null
        : explicitRoute ?? reviewedRoute ?? (protocol ? routeForProtocol(provider, protocol) : null)
      : protocol ? routeForProtocol(provider, protocol) : null
    const previousProtocol = protocols.get(key)
    if (protocols.has(key) && previousProtocol !== protocol && previousProtocol) {
      conformance.delete(conformanceKey(provider, id, previousProtocol))
    }
    protocols.set(key, protocol)
    const reviewedMetadata = reviewed ? reviewedModelsDevMetadata(reviewed) : null
    const liveReasoningKeys = ['reasoning', 'thinking', 'reasoning_options', 'reasoningOptions', 'reasoningEfforts', 'reasoning_efforts', 'supportedReasoningEfforts', 'supported_reasoning_efforts', 'reasoningEffortValues', 'reasoning_effort_values', 'reasoningParameter', 'reasoning_parameter', 'reasoningMode', 'reasoning_mode', 'supported_parameters']
    const hasLiveReasoningDeclaration = liveReasoningKeys.some(key => Object.prototype.hasOwnProperty.call(row, key))
    const reasoningMetadata = reviewedMetadata && !hasLiveReasoningDeclaration ? { ...reviewedMetadata, ...row } : row
    const reasoningCapability = protocol ? reasoningCapabilityFromMetadata(reasoningMetadata, protocol) : null
    reasoning.set(key, reasoningCapability)
    const supported = kind !== 'gemini' || methods.length === 0 || methods.includes('generateContent')
    const conversational: AdvisorHostedModelCapabilities['conversational'] = kind === 'gemini'
      ? methods.length === 0 ? 'unknown' : supported ? 'available' : 'unavailable'
      : kind === 'openrouter' || kind === 'opencode-zen' ? 'available' : 'unknown'
    const streaming: AdvisorHostedModelCapabilities['streaming'] = kind === 'gemini'
      ? methods.length === 0 ? 'unknown' : methods.includes('streamGenerateContent') ? 'supported' : 'unsupported'
      : 'unknown'
    const advertisedToolCall = kind === 'opencode-zen' && !protocol
      ? 'unsupported'
      : advertisedToolCapability(kind, row, reviewed?.toolCall ?? undefined)
    const capabilityInputs = conformanceCapabilities(conversational, streaming, advertisedToolCall, reasoningCapability?.efforts)
    capabilitiesByModel.set(key, capabilityInputs)
    routes.set(key, route)
    const fingerprint = protocol ? currentConformanceFingerprint(provider, id, protocol, capabilityInputs, route) : null
    const storedConformance = protocol ? conformance.get(conformanceKey(provider, id, protocol)) : undefined
    const conformanceRecord = storedConformance && fingerprint && storedConformance.fingerprint === fingerprint ? storedConformance : undefined
    if (storedConformance && !conformanceRecord) conformance.delete(conformanceKey(provider, id, protocol!))
    const toolCall = conformanceRecord?.state === 'verified'
      ? conformanceRecord.toolCall
      : conformanceRecord?.state === 'failed-conformance'
        ? 'failed-conformance'
        : advertisedToolCall
    const capabilities = supported && protocol
      ? {
          ...baseCapabilities(conformanceRecord?.state === 'verified' ? 'available' : conversational, streaming, toolCall),
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
          : kind === 'openrouter' && (toolCall === 'unknown' || toolCall === 'supported')
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
          ? 'OpenRouter did not report usable tool-call capability for this model; Advisor will use deterministic evidence retrieval plus hosted synthesis until verified.'
          : kind === 'openrouter' && toolCall === 'supported'
            ? 'This model advertises tool calls; Metrora Harness conformance remains unverified until a bounded request succeeds.'
          : kind === 'opencode-zen'
            ? 'Discovered from OpenCode Zen; the model protocol is documented, but Metrora Harness conformance and tool capability are not verified.'
            : 'Discovered from the provider model listing; Metrora Harness compatibility is not verified.'
    models.push({ id, label, state, limitation, capabilities, ...(route ? { route } : {}) })
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

export async function discover(
  provider: AdvisorHostedProviderId,
  secret: string,
  fetchImpl: FetchLike,
  parent: AbortSignal | undefined,
  protocols: HostedProtocolRegistry,
  reasoning: HostedReasoningRegistry,
  conformance: HostedConformanceRegistry,
  capabilitiesByModel: HostedCapabilityRegistry,
  routes: HostedRouteRegistry,
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
    const response = await fetchResponse(fetchImpl, providerUrl(provider, url.pathname + url.search), { method: 'GET', headers: { Accept: 'application/json', ...authHeaders(provider, secret) } }, PROBE_TIMEOUT_MS, parent)
    try {
      statusCheck(response.response)
      nextToken = modelRows(provider, await readJson(response.response, response.signal), models, seen, protocols, reasoning, conformance, capabilitiesByModel, routes)
    } finally { response.dispose() }
    if (!nextToken || seenTokens.has(nextToken)) break
    seenTokens.add(nextToken)
  }
  return models
}
