import type {
  AdvisorHostedProtocol,
  AdvisorHostedProviderId,
  AdvisorHostedReasoningCapability,
  AdvisorReasoningEffort,
  AdvisorHostedRoute,
} from './advisor-provider-contract'

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

export function routeForProtocol(provider: AdvisorHostedProviderId, protocol: AdvisorHostedProtocol): AdvisorHostedRoute {
  const compatible = provider === 'openrouter' || (provider === 'opencode-zen' && protocol === 'openai-chat')
  return {
    providerPackage: compatible ? '@ai-sdk/openai-compatible' : 'metrora-native',
    providerFamily: compatible ? 'openai-compatible' : 'metrora-native',
    protocol,
    endpointFamily: protocol === 'openai-responses' ? 'responses' : protocol === 'openai-chat' ? 'chat-completions' : protocol,
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function routeMetadataValue(metadata: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) return metadata[key]
  }
  return undefined
}

/** Resolve the reviewed provider package/family and endpoint family. */
export function resolveOpenCodeZenRouteFromMetadata(metadata: Record<string, unknown> | undefined, fallbackProtocol?: AdvisorHostedProtocol | null): AdvisorHostedRoute | null | undefined {
  if (!metadata) return undefined
  const protocol = resolveOpenCodeZenProtocolFromMetadata(metadata)
  if (protocol === null) return null
  const resolvedProtocol = protocol ?? fallbackProtocol
  const provider = isRecordValue(metadata.provider) ? metadata.provider : undefined
  const rawPackage = routeMetadataValue(metadata, ['providerPackage', 'provider_package']) ?? provider?.npm
  const rawFamily = routeMetadataValue(metadata, ['providerFamily', 'provider_family']) ?? provider?.family
  const rawEndpointPath = routeMetadataValue(metadata, ['endpointPath', 'endpoint_path', 'endpoint', 'chatPath'])
  const inferredEndpoint = resolvedProtocol === 'openai-responses'
    ? 'responses'
    : resolvedProtocol === 'openai-chat'
      ? 'chat-completions'
      : resolvedProtocol === 'anthropic-messages'
        ? 'messages'
        : resolvedProtocol === 'gemini-content'
          ? 'generate-content'
          : undefined
  const rawEndpoint = routeMetadataValue(metadata, ['endpointFamily', 'endpoint_family']) ?? (rawEndpointPath !== undefined ? inferredEndpoint : undefined)
  const hasRoute = rawPackage !== undefined || rawFamily !== undefined || rawEndpoint !== undefined || rawEndpointPath !== undefined
  if (!hasRoute) return undefined
  if (!resolvedProtocol || typeof rawPackage !== 'string' || typeof rawFamily !== 'string' || typeof rawEndpoint !== 'string') return null
  if (!/^@[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(rawPackage) || !/^[a-z][a-z0-9._-]{0,63}$/u.test(rawFamily) || !/^[a-z][a-z0-9._-]{0,63}$/u.test(rawEndpoint)) return null
  const rawInterleaved = isRecordValue(metadata.interleaved) ? metadata.interleaved.field : undefined
  if (rawInterleaved !== undefined && rawInterleaved !== 'reasoning_content') return null
  if (resolvedProtocol === 'openai-responses' && rawEndpoint !== 'responses') return null
  if (resolvedProtocol === 'openai-chat' && rawEndpoint !== 'chat-completions') return null
  return {
    providerPackage: rawPackage,
    providerFamily: rawFamily,
    protocol: resolvedProtocol,
    endpointFamily: rawEndpoint,
    ...(rawInterleaved ? { interleavedField: rawInterleaved } : {}),
  }
}

function openCodeZenModelId(model: string): string { return model.replace(/^models\//u, '') }

/** Resolve only protocol and endpoint values implemented by the adapters. */
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

const REASONING_EFFORT_KEYS = ['reasoningEfforts', 'reasoning_efforts', 'supportedReasoningEfforts', 'supported_reasoning_efforts', 'reasoningEffortValues', 'reasoning_effort_values'] as const
const REASONING_PARAMETER_KEYS = ['reasoningParameter', 'reasoning_parameter', 'reasoningMode', 'reasoning_mode'] as const

function reasoningSources(metadata: Record<string, unknown>): Record<string, unknown>[] {
  const nested = metadata.capabilities
  return isRecordValue(nested) ? [metadata, nested] : [metadata]
}

function declaredReasoningEfforts(sources: readonly Record<string, unknown>[]): AdvisorReasoningEffort[] | null | undefined {
  for (const source of sources) {
    const options = source.reasoning_options ?? source.reasoningOptions
    if (options !== undefined) {
      if (!Array.isArray(options)) return null
      const efforts = options.flatMap(option => {
        if (typeof option === 'string') return [option]
        if (!isRecordValue(option) || option.type !== 'effort' || !Array.isArray(option.values)) return []
        return option.values
      }).filter((value): value is string => typeof value === 'string')
        .map(value => value.trim().toLowerCase())
        .filter(value => /^[a-z][a-z0-9_-]{0,32}$/u.test(value))
      return Array.from(new Set(efforts))
    }
    for (const key of REASONING_EFFORT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue
      if (!Array.isArray(source[key])) return null
      const efforts = source[key]
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim().toLowerCase())
        .filter(value => /^[a-z][a-z0-9_-]{0,32}$/u.test(value))
      if (!efforts.length && source[key].length > 0) return null
      return Array.from(new Set(efforts))
    }
  }
  return undefined
}

function declaredReasoningParameter(sources: readonly Record<string, unknown>[], protocol: AdvisorHostedProtocol): AdvisorHostedReasoningCapability['parameter'] | null | undefined {
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

/** Only advertise reasoning when the provider declares its parameter/levels. */
export function reasoningCapabilityFromMetadata(metadata: Record<string, unknown> | undefined, protocol: AdvisorHostedProtocol | null): AdvisorHostedReasoningCapability | null {
  if (!metadata || !protocol) return null
  const sources = reasoningSources(metadata)
  const parameter = declaredReasoningParameter(sources, protocol)
  const explicitReasoning = sources.some(source => source.reasoning === true || source.thinking === true || Object.prototype.hasOwnProperty.call(source, 'reasoning_options') || Object.prototype.hasOwnProperty.call(source, 'reasoningOptions'))
  const resolvedParameter = parameter ?? (explicitReasoning && (protocol === 'openai-chat' || protocol === 'openai-responses')
    ? protocol === 'openai-responses' ? 'reasoning-object' : 'openai-effort'
    : null)
  if (!resolvedParameter) return null
  const declared = declaredReasoningEfforts(sources)
  if (declared === null) return null
  const efforts = declared ?? ['default']
  if (!efforts.includes('default')) efforts.unshift('default')
  return { efforts: Array.from(new Set(efforts)), parameter: resolvedParameter }
}

export function openCodeZenProtocol(model: string, metadata?: Record<string, unknown>): AdvisorHostedProtocol | null {
  const explicit = resolveOpenCodeZenProtocolFromMetadata(metadata)
  return explicit === undefined ? OPENCODE_ZEN_PROTOCOLS[openCodeZenModelId(model)] ?? null : explicit
}

export function openCodeZenChatPath(model: string, stream: boolean, protocol: AdvisorHostedProtocol): string {
  if (protocol === 'openai-responses') return '/zen/v1/responses'
  if (protocol === 'anthropic-messages') return '/zen/v1/messages'
  if (protocol === 'openai-chat') return '/zen/v1/chat/completions'
  return '/zen/v1/models/' + encodeURIComponent(openCodeZenModelId(model)) + ':' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent')
}
