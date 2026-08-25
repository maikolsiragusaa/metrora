import { createHash } from 'node:crypto'

export const COMPANION_CAPACITY_KIND = 'metrora.companion.capacity' as const
export const COMPANION_CAPACITY_VERSION = 1 as const
export const COMPANION_CAPACITY_SCOPE = 'desktop-provider-capacity' as const

/** The closed provider identity set owned by Desktop Capacity authority. */
export const COMPANION_CAPACITY_PROVIDER_NAMES = [
  'claude',
  'codex',
  'copilot',
  'kimi',
  'antigravity',
] as const
export type CompanionCapacityProviderName = typeof COMPANION_CAPACITY_PROVIDER_NAMES[number]

export type CompanionCapacityConnection =
  | 'connected'
  | 'disconnected'
  | 'accessDenied'
  | 'loading'
  | 'stale'
  | 'transientFailure'
  | 'terminalFailure'

export type CompanionCapacityFreshness = 'fresh' | 'stale' | 'unavailable'
export type CompanionCapacityAvailability = 'available' | 'unavailable'

export type CompanionCapacitySourceV1 = {
  kind: 'provider-api' | 'provider-cli' | 'provider-loopback' | 'provider-internal-api'
  stability: 'documented' | 'provider-owned' | 'experimental'
}

export type CompanionCapacityWindowV1 = {
  id: string
  label: string
  usedPercent: number
  remainingPercent: number
  resetsAt: string | null
}

export type CompanionCapacityCreditsV1 = {
  balance: number
  currency: 'USD'
}

export type CompanionCapacityProviderV1 = {
  provider: CompanionCapacityProviderName
  displayName: string
  availability: CompanionCapacityAvailability
  connection: CompanionCapacityConnection
  freshness: CompanionCapacityFreshness
  /** Provider observation time; not the time a stale fact was reused. */
  observedAt: string | null
  planLabel: string | null
  windows: CompanionCapacityWindowV1[]
  credits: CompanionCapacityCreditsV1 | null
  source?: CompanionCapacitySourceV1
}

export type CompanionCapacityV1 = {
  kind: typeof COMPANION_CAPACITY_KIND
  version: typeof COMPANION_CAPACITY_VERSION
  desktopId: string
  generatedAt: string
  scope: { id: typeof COMPANION_CAPACITY_SCOPE }
  /** Stable identity of this safe observation set; it is not an account id. */
  observationId: string
  freshness: CompanionCapacityFreshness
  available: boolean
  providers: CompanionCapacityProviderV1[]
}

type JsonRecord = Record<string, unknown>

const MAX_PROVIDERS = COMPANION_CAPACITY_PROVIDER_NAMES.length
const MAX_WINDOWS_PER_PROVIDER = 8
const MAX_DISPLAY_LENGTH = 80
const MAX_TIMESTAMP_LENGTH = 80
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,120}$/u
const SAFE_DISPLAY = /^[A-Za-z0-9][A-Za-z0-9 .+()_:-]{0,79}$/u
const SAFE_DESKTOP_ID = /^[a-f0-9]{64}$/u

const DISPLAY_NAMES: Record<CompanionCapacityProviderName, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  kimi: 'Kimi Code',
  antigravity: 'Antigravity',
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function providerName(value: unknown): value is CompanionCapacityProviderName {
  return typeof value === 'string' && (COMPANION_CAPACITY_PROVIDER_NAMES as readonly string[]).includes(value)
}

function connection(value: unknown): value is CompanionCapacityConnection {
  return value === 'connected'
    || value === 'disconnected'
    || value === 'accessDenied'
    || value === 'loading'
    || value === 'stale'
    || value === 'transientFailure'
    || value === 'terminalFailure'
}

function freshness(value: unknown): value is CompanionCapacityFreshness {
  return value === 'fresh' || value === 'stale' || value === 'unavailable'
}

function safeDisplay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().slice(0, MAX_DISPLAY_LENGTH)
  return normalized && SAFE_DISPLAY.test(normalized) ? normalized : null
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function safeDesktopId(value: unknown): string {
  return typeof value === 'string' && (SAFE_DESKTOP_ID.test(value) || value === 'unknown') ? value : 'unknown'
}

function source(value: unknown): CompanionCapacitySourceV1 | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind
  const stability = value.stability
  if (kind !== 'provider-api' && kind !== 'provider-cli' && kind !== 'provider-loopback' && kind !== 'provider-internal-api') return undefined
  if (stability !== 'documented' && stability !== 'provider-owned' && stability !== 'experimental') return undefined
  return { kind, stability }
}

function percentage(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value)) * 100
}

function sanitizeWindow(value: unknown): CompanionCapacityWindowV1 | null {
  if (!isRecord(value)) return null
  const id = safeId(value.id)
  const label = safeDisplay(value.label)
  const usedPercent = percentage(value.usedFraction)
  if (!id || !label || usedPercent === null) return null
  return {
    id,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: isoOrNull(value.resetsAt),
  }
}

function sanitizeCredits(value: unknown): CompanionCapacityCreditsV1 | null {
  if (!isRecord(value) || value.currency !== 'USD') return null
  return typeof value.balance === 'number' && Number.isFinite(value.balance) && value.balance >= 0
    ? { balance: value.balance, currency: 'USD' }
    : null
}

function sanitizeProvider(value: unknown): CompanionCapacityProviderV1 | null {
  if (!isRecord(value) || !providerName(value.provider)) return null
  const provider = value.provider
  const rawWindows = Array.isArray(value.windows) ? value.windows : []
  const windows = rawWindows
    .slice(0, MAX_WINDOWS_PER_PROVIDER)
    .map(sanitizeWindow)
    .filter((item): item is CompanionCapacityWindowV1 => item !== null)
  const credits = sanitizeCredits(value.credits)
  const planLabel = safeDisplay(value.planLabel)
  const observedAt = isoOrNull(value.observedAt)
  const currentConnection = connection(value.connection) ? value.connection : 'transientFailure'
  const currentFreshness = freshness(value.freshness) ? value.freshness : 'unavailable'
  const hasFacts = windows.length > 0 || credits !== null || planLabel !== null
  const freshFact = hasFacts && currentConnection === 'connected' && currentFreshness === 'fresh' && observedAt !== null
  const staleFact = hasFacts && (currentConnection === 'stale' || currentConnection === 'transientFailure') && currentFreshness === 'stale' && observedAt !== null
  const retained = freshFact || staleFact
  const safeSource = retained ? source(value.source) : undefined

  return {
    provider,
    // Display mapping is canonical Desktop product metadata, never provider
    // input text. This prevents a provider response from choosing its own label.
    displayName: DISPLAY_NAMES[provider],
    availability: freshFact ? 'available' : 'unavailable',
    connection: currentConnection,
    freshness: retained ? currentFreshness : 'unavailable',
    observedAt: retained ? observedAt : null,
    planLabel: retained ? planLabel : null,
    windows: retained ? windows : [],
    credits: retained ? credits : null,
    ...(safeSource ? { source: safeSource } : {}),
  }
}

function observationId(providers: CompanionCapacityProviderV1[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ scope: COMPANION_CAPACITY_SCOPE, providers }))
    .digest('hex')
}

function generatedAt(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString()
}

function providerValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.providers)) return value.providers
  return []
}

/**
 * Last-mile public projection from the canonical Desktop ProviderQuotaSnapshot
 * array. It never reads credentials or local provider state and never merges
 * values from different observations.
 */
export function toCompanionCapacityV1(
  value: unknown,
  options: { desktopId?: string; generatedAt?: string } = {},
): CompanionCapacityV1 {
  const byProvider = new Map<CompanionCapacityProviderName, CompanionCapacityProviderV1>()
  for (const item of providerValues(value).slice(0, MAX_PROVIDERS * 2)) {
    const safe = sanitizeProvider(item)
    if (safe && !byProvider.has(safe.provider)) byProvider.set(safe.provider, safe)
  }
  const providers = COMPANION_CAPACITY_PROVIDER_NAMES.flatMap(provider => {
    const value = byProvider.get(provider)
    return value ? [value] : []
  })
  const hasFresh = providers.some(item => item.freshness === 'fresh')
  const hasStale = providers.some(item => item.freshness === 'stale')
  const snapshotFreshness: CompanionCapacityFreshness = hasFresh ? 'fresh' : hasStale ? 'stale' : 'unavailable'
  return {
    kind: COMPANION_CAPACITY_KIND,
    version: COMPANION_CAPACITY_VERSION,
    desktopId: safeDesktopId(options.desktopId),
    generatedAt: generatedAt(options.generatedAt),
    scope: { id: COMPANION_CAPACITY_SCOPE },
    observationId: observationId(providers),
    freshness: snapshotFreshness,
    available: providers.some(item => item.freshness === 'fresh' || item.freshness === 'stale'),
    providers,
  }
}

export function unavailableCompanionCapacityV1(
  desktopId = 'unknown',
  generated = new Date().toISOString(),
): CompanionCapacityV1 {
  return toCompanionCapacityV1([], { desktopId, generatedAt: generated })
}

export function isCompanionCapacityV1(value: unknown): value is CompanionCapacityV1 {
  if (!isRecord(value)) return false
  return value.kind === COMPANION_CAPACITY_KIND
    && value.version === COMPANION_CAPACITY_VERSION
    && typeof value.desktopId === 'string'
    && typeof value.generatedAt === 'string'
    && isRecord(value.scope)
    && value.scope.id === COMPANION_CAPACITY_SCOPE
    && typeof value.observationId === 'string'
    && (value.desktopId === 'unknown' || SAFE_DESKTOP_ID.test(value.desktopId))
    && /^[a-f0-9]{64}$/u.test(value.observationId)
    && freshness(value.freshness)
    && typeof value.available === 'boolean'
    && Array.isArray(value.providers)
}

export function companionCapacityProviderDisplayName(provider: CompanionCapacityProviderName): string {
  return DISPLAY_NAMES[provider]
}
