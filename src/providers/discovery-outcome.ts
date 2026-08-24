import type { Provider, SessionSource } from './types.js'
import { canonicalCollectorForStorageNamespace } from '../provider-parse-authorities.js'

export const PROVIDER_DISCOVERY_OUTCOME_SCHEMA_VERSION = 'metrora.provider-discovery-outcome.v1' as const

export type ProviderDiscoveryStatus = 'success' | 'empty' | 'unavailable' | 'failed' | 'partial' | 'cancelled'
export type ProviderDiscoveryDiagnosticCode = 'provider-unavailable' | 'discovery-failed' | 'partial-discovery' | 'invalid-source' | 'cancelled'
export type ProviderDiscoveryDiagnostic = {
  code: ProviderDiscoveryDiagnosticCode
  message: string
}

export type ProviderDiscoveryOutcome = {
  schemaVersion: typeof PROVIDER_DISCOVERY_OUTCOME_SCHEMA_VERSION
  provider: string
  status: ProviderDiscoveryStatus
  complete: boolean
  sourceCount: number
  sources: readonly SessionSource[]
  diagnostic: ProviderDiscoveryDiagnostic | null
}

export type ProviderDiscoveryClassificationInput = {
  sources?: readonly SessionSource[]
  error?: unknown
  cancelled?: boolean
}

export class ProviderDiscoveryUnavailableError extends Error {
  constructor(message = 'provider source is unavailable') {
    super(message)
    this.name = 'ProviderDiscoveryUnavailableError'
  }
}

export class ProviderDiscoveryPartialError extends Error {
  constructor(public readonly sources: readonly SessionSource[], message = 'provider discovery recovered incomplete source evidence') {
    super(message)
    this.name = 'ProviderDiscoveryPartialError'
  }
}

function errorProperty(error: unknown, key: string): unknown {
  return error && typeof error === 'object' && key in error ? (error as Record<string, unknown>)[key] : undefined
}

function errorCode(error: unknown): string | undefined {
  const code = errorProperty(error, 'code')
  return typeof code === 'string' ? code : undefined
}

function isCancelledError(error: unknown): boolean {
  const name = errorProperty(error, 'name')
  const code = errorCode(error)
  return name === 'AbortError' || code === 'ABORT_ERR' || code === 'ERR_CANCELED' || code === 'ECANCELED'
}

function isUnavailableError(error: unknown): boolean {
  if (error instanceof ProviderDiscoveryUnavailableError) return true
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR'
}

function isValidSource(providerName: string, source: unknown): source is SessionSource {
  if (!source || typeof source !== 'object') return false
  const value = source as Record<string, unknown>
  return typeof value.path === 'string'
    && value.path.length > 0
    && typeof value.project === 'string'
    && typeof value.provider === 'string'
    && value.provider.length > 0
    && canonicalCollectorForStorageNamespace(value.provider) === providerName
}

function validSources(providerName: string, sources: readonly SessionSource[]): SessionSource[] {
  return sources.filter(source => isValidSource(providerName, source))
}

function diagnostic(code: ProviderDiscoveryDiagnosticCode): ProviderDiscoveryDiagnostic {
  const messages: Record<ProviderDiscoveryDiagnosticCode, string> = {
    'provider-unavailable': 'provider source is currently unavailable',
    'discovery-failed': 'provider discovery failed before completion',
    'partial-discovery': 'provider discovery returned incomplete source evidence',
    'invalid-source': 'provider returned invalid source metadata',
    cancelled: 'provider discovery was cancelled before completion',
  }
  return { code, message: messages[code] }
}

function outcome(
  providerName: string,
  status: ProviderDiscoveryStatus,
  sources: readonly SessionSource[],
  detail: ProviderDiscoveryDiagnostic | null,
): ProviderDiscoveryOutcome {
  return {
    schemaVersion: PROVIDER_DISCOVERY_OUTCOME_SCHEMA_VERSION,
    provider: providerName,
    status,
    complete: status === 'success' || status === 'empty',
    sourceCount: sources.length,
    sources,
    diagnostic: detail,
  }
}

export function classifyProviderDiscoveryOutcome(
  providerName: string,
  input: ProviderDiscoveryClassificationInput = {},
): ProviderDiscoveryOutcome {
  const rawSources = Array.isArray(input.sources) ? input.sources : []
  const sources = validSources(providerName, rawSources)
  const hasInvalidSources = rawSources.length !== sources.length
  const error = input.error

  if (input.cancelled === true || isCancelledError(error)) {
    return outcome(providerName, 'cancelled', sources, diagnostic('cancelled'))
  }

  if (error instanceof ProviderDiscoveryPartialError) {
    const recovered = validSources(providerName, error.sources)
    return recovered.length > 0
      ? outcome(providerName, 'partial', recovered, diagnostic('partial-discovery'))
      : outcome(providerName, 'failed', [], diagnostic('discovery-failed'))
  }

  if (isUnavailableError(error)) {
    return outcome(providerName, 'unavailable', sources, diagnostic('provider-unavailable'))
  }

  if (error !== undefined && error !== null) {
    return outcome(providerName, 'failed', sources, diagnostic('discovery-failed'))
  }

  if (hasInvalidSources) {
    return sources.length > 0
      ? outcome(providerName, 'partial', sources, diagnostic('invalid-source'))
      : outcome(providerName, 'failed', [], diagnostic('invalid-source'))
  }

  return sources.length > 0
    ? outcome(providerName, 'success', sources, null)
    : outcome(providerName, 'empty', [], null)
}

export function providerDiscoveryIsComplete(outcomeValue: ProviderDiscoveryOutcome | undefined): boolean {
  return outcomeValue?.complete === true
}

export function providerDiscoveryProviderOrder(providers: readonly Provider[]): Provider[] {
  return [...providers].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}
