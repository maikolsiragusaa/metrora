/**
 * Canonical provider-quota contract for the Electron live-quota path.
 *
 * This module is intentionally JSON-safe and contains provider facts only.
 * Renderer code type-imports this same module; measured usage and local budget
 * plans remain separate contracts.
 */

export const PROVIDER_QUOTA_SCHEMA_VERSION = 1 as const

export type ProviderName = 'claude' | 'codex'
export type QuotaAuthority = 'provider-reported'
export type QuotaConnection =
  | 'connected'
  | 'disconnected'
  | 'accessDenied'
  | 'loading'
  | 'stale'
  | 'transientFailure'
  | 'terminalFailure'
export type QuotaAvailability = 'available' | 'unavailable'
export type QuotaFreshness = 'fresh' | 'stale' | 'unavailable'

export type ProviderQuotaWindow = {
  /** Stable producer identity; display labels are not row identity. */
  id: string
  /** Human-readable provider label, suitable for presentation. */
  label: string
  /** Normalized provider-reported utilization, always 0..1. */
  usedFraction: number
  /** Provider reset boundary in ISO-8601 form, when supplied. */
  resetsAt: string | null
  /** Provider evidence for the window duration, when supplied. */
  windowSeconds: number | null
}

export type ProviderQuotaCredits = {
  /** Explicit provider-reported balance. Zero is meaningful. */
  balance: number
  currency: 'USD'
}

export type ProviderQuotaRateLimit = {
  state: 'clear' | 'backoff'
  /** Persisted/provider Retry-After boundary when state is backoff. */
  retryAt: string | null
}

/** JSON-safe factual provider quota snapshot crossing the Electron bridge. */
export type ProviderQuotaSnapshot = {
  schemaVersion: typeof PROVIDER_QUOTA_SCHEMA_VERSION
  provider: ProviderName
  authority: QuotaAuthority
  availability: QuotaAvailability
  connection: QuotaConnection
  freshness: QuotaFreshness
  /** Time the provider response was observed, not the time stale data was reused. */
  observedAt: string | null
  planLabel: string | null
  windows: ProviderQuotaWindow[]
  credits: ProviderQuotaCredits | null
  rateLimit: ProviderQuotaRateLimit
}

export type QuotaProvider = ProviderQuotaSnapshot
export type QuotaWindow = ProviderQuotaWindow

export const CONNECTIONS: readonly QuotaConnection[] = [
  'connected', 'disconnected', 'accessDenied', 'loading', 'stale', 'transientFailure', 'terminalFailure',
]

export function emptyQuota(
  provider: ProviderName,
  connection: QuotaConnection,
  rateLimit: ProviderQuotaRateLimit = { state: 'clear', retryAt: null },
): QuotaProvider {
  const availability: QuotaAvailability = connection === 'connected' ? 'available' : 'unavailable'
  const freshness: QuotaFreshness = connection === 'connected' ? 'fresh' : 'unavailable'
  return {
    schemaVersion: PROVIDER_QUOTA_SCHEMA_VERSION,
    provider,
    authority: 'provider-reported',
    availability,
    connection,
    freshness,
    observedAt: null,
    planLabel: null,
    windows: [],
    credits: null,
    rateLimit,
  }
}

export function markObserved(quota: QuotaProvider, now: number): QuotaProvider {
  const observedAt = Number.isFinite(now) ? new Date(now).toISOString() : null
  return {
    ...quota,
    schemaVersion: PROVIDER_QUOTA_SCHEMA_VERSION,
    authority: 'provider-reported',
    availability: 'available',
    connection: 'connected',
    freshness: 'fresh',
    observedAt,
    rateLimit: { state: 'clear', retryAt: null },
  }
}

/** Retain factual values while making the failed refresh explicit. */
export function markStale(previous: QuotaProvider, connection: QuotaConnection, rateLimit: ProviderQuotaRateLimit): QuotaProvider {
  return {
    ...previous,
    schemaVersion: PROVIDER_QUOTA_SCHEMA_VERSION,
    authority: 'provider-reported',
    availability: 'unavailable',
    connection,
    freshness: 'stale',
    // observedAt intentionally remains the previous provider observation.
    rateLimit,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isProvider(value: unknown): value is ProviderName {
  return value === 'claude' || value === 'codex'
}

function isConnection(value: unknown): value is QuotaConnection {
  return typeof value === 'string' && (CONNECTIONS as readonly string[]).includes(value)
}

function isFreshness(value: unknown): value is QuotaFreshness {
  return value === 'fresh' || value === 'stale' || value === 'unavailable'
}

function isAvailability(value: unknown): value is QuotaAvailability {
  return value === 'available' || value === 'unavailable'
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function finiteOrNull(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Last-mile allowlist for the renderer bridge. Even an injected/test provider
 * result can only cross with product-safe fields; credentials and account
 * identifiers are never copied through.
 */
export function sanitizeQuotaProvider(value: unknown): QuotaProvider | null {
  if (!isObject(value) || !isProvider(value.provider)) return null
  const connection = isConnection(value.connection) ? value.connection : 'transientFailure'
  const windows = Array.isArray(value.windows)
    ? value.windows.flatMap(row => {
        if (!isObject(row) || typeof row.id !== 'string' || !row.id || typeof row.label !== 'string' || !row.label) return []
        const rawUsedFraction = finiteNumber(row.usedFraction)
        if (rawUsedFraction === null) return []
        const windowSeconds = finiteOrNull(row.windowSeconds, Number.MIN_VALUE)
        return [{
          id: row.id,
          label: row.label,
          usedFraction: Math.min(1, Math.max(0, rawUsedFraction)),
          resetsAt: isoOrNull(row.resetsAt),
          windowSeconds,
        }]
      })
    : []
  const credits = isObject(value.credits)
    ? (() => {
        const balance = finiteNumber(value.credits.balance)
        return balance === null ? null : { balance, currency: 'USD' as const }
      })()
    : null
  const rawRate = isObject(value.rateLimit) ? value.rateLimit : {}
  const rateState = rawRate.state === 'backoff' ? 'backoff' : 'clear'
  const rateLimit = {
    state: rateState,
    retryAt: rateState === 'backoff' ? isoOrNull(rawRate.retryAt) : null,
  } as ProviderQuotaRateLimit
  const fallbackFreshness: QuotaFreshness = connection === 'connected' ? 'fresh' : 'unavailable'
  const fallbackAvailability: QuotaAvailability = connection === 'connected' ? 'available' : 'unavailable'
  return {
    schemaVersion: PROVIDER_QUOTA_SCHEMA_VERSION,
    provider: value.provider,
    authority: 'provider-reported',
    availability: isAvailability(value.availability) ? value.availability : fallbackAvailability,
    connection,
    freshness: isFreshness(value.freshness) ? value.freshness : fallbackFreshness,
    observedAt: isoOrNull(value.observedAt),
    planLabel: typeof value.planLabel === 'string' && value.planLabel.trim() ? value.planLabel : null,
    windows,
    credits,
    rateLimit,
  }
}

export function sanitizeQuotaProviders(value: unknown): QuotaProvider[] {
  return Array.isArray(value) ? value.flatMap(item => { const safe = sanitizeQuotaProvider(item); return safe ? [safe] : [] }) : []
}

export type ProviderNameFromQuota = QuotaProvider['provider']
