import os from 'node:os'
import path from 'node:path'

import { fetchAntigravityQuota } from './antigravity'
import { fetchClaudeQuota } from './claude'
import { fetchCodexQuota } from './codex'
import { fetchCopilotQuota } from './copilot'
import { fetchKimiQuota } from './kimi'
import { atomicWriteSecureFile, readSecureFile, sanitizeError } from './security'
import {
  PROVIDER_NAMES,
  emptyQuota,
  hasProviderQuotaFacts,
  markStale,
  sanitizeQuotaProvider,
  type ProviderNameFromQuota,
  type QuotaProvider,
} from './types'

export type { QuotaProvider, QuotaWindow } from './types'
export type {
  ProviderName,
  ProviderQuotaCredits,
  ProviderQuotaRateLimit,
  ProviderQuotaSnapshot,
  ProviderQuotaSource,
  ProviderQuotaWindow,
  QuotaAvailability,
  QuotaAuthority,
  QuotaConnection,
  QuotaFreshness,
  QuotaSourceKind,
  QuotaSourceStability,
} from './types'
export { hasProviderQuotaFacts } from './types'
export { sanitizeError } from './security'

type Blocked = Partial<Record<ProviderNameFromQuota, string>>
type FetchResult = { quota: QuotaProvider; retryAfterSeconds?: number }
type ProviderFetcher = (options: { signal: AbortSignal; allowKeychain: boolean }) => Promise<FetchResult>
type QuotaDeps = {
  claude: ProviderFetcher
  codex: ProviderFetcher
  copilot: ProviderFetcher
  kimi: ProviderFetcher
  antigravity: ProviderFetcher
  statePath: string
  readFile: typeof readSecureFile
  writeFile: typeof atomicWriteSecureFile
  now: () => number
  refreshMs: number
}

const defaultDeps: QuotaDeps = {
  claude: options => fetchClaudeQuota(options),
  codex: options => fetchCodexQuota(options),
  copilot: options => fetchCopilotQuota(options),
  kimi: options => fetchKimiQuota(options),
  antigravity: options => fetchAntigravityQuota(options),
  statePath: path.join(os.homedir(), '.metrora', 'quota-backoff.json'),
  readFile: readSecureFile,
  writeFile: atomicWriteSecureFile,
  now: Date.now,
  // Politeness floor: quota stays gentle regardless of the app refresh cadence.
  // A user-initiated force refresh still bypasses this (invalidate()).
  refreshMs: 5 * 60_000,
}

function backoffRateLimit(retryAt: string): QuotaProvider['rateLimit'] {
  return { state: 'backoff', retryAt }
}

function isFactualSnapshot(quota: QuotaProvider): boolean {
  return quota.connection === 'connected'
    && quota.freshness === 'fresh'
    && quota.authority === 'provider-reported'
    && hasProviderQuotaFacts(quota)
    && quota.observedAt !== null
    && Number.isFinite(Date.parse(quota.observedAt))
}

function generationMap(): Record<ProviderNameFromQuota, number> {
  return Object.fromEntries(PROVIDER_NAMES.map(provider => [provider, 0])) as Record<ProviderNameFromQuota, number>
}

export class QuotaService {
  private readonly deps: QuotaDeps
  private cache: { at: number; value: QuotaProvider[] } | null = null
  /** Last factual value survives cache invalidation so force failures can be honest. */
  private readonly lastGood: Partial<Record<ProviderNameFromQuota, QuotaProvider>> = {}
  private flight: Promise<QuotaProvider[]> | null = null
  private generations: Record<ProviderNameFromQuota, number> = generationMap()
  private controllers: Partial<Record<ProviderNameFromQuota, AbortController>> = {}

  constructor(deps: Partial<QuotaDeps> = {}) { this.deps = { ...defaultDeps, ...deps } }

  invalidate(provider?: ProviderNameFromQuota): void {
    const providers: readonly ProviderNameFromQuota[] = provider ? [provider] : PROVIDER_NAMES
    for (const p of providers) {
      this.generations[p] += 1
      this.controllers[p]?.abort()
      this.controllers[p] = undefined
    }
    this.cache = null
  }

  async getQuota(options: { force?: boolean; allowKeychain?: boolean } = {}): Promise<QuotaProvider[]> {
    if (options.force) this.invalidate()
    if (!options.force && this.cache && this.deps.now() - this.cache.at < this.deps.refreshMs) return this.cache.value
    if (this.flight) return this.flight
    this.flight = this.fetchAll(Boolean(options.allowKeychain)).finally(() => { this.flight = null })
    return this.flight
  }

  private async readBlocked(): Promise<Blocked> {
    try {
      const raw = await this.deps.readFile(this.deps.statePath, 16 * 1024)
      return raw ? JSON.parse(raw) as Blocked : {}
    } catch (error) {
      console.warn(`Quota backoff state unavailable: ${sanitizeError(error)}`)
      return {}
    }
  }

  private async writeBlocked(blocked: Blocked): Promise<void> {
    try { await this.deps.writeFile(this.deps.statePath, `${JSON.stringify(blocked, null, 2)}\n`) }
    catch (error) { console.warn(`Quota backoff state not saved: ${sanitizeError(error)}`) }
  }

  private fetcher(provider: ProviderNameFromQuota): ProviderFetcher {
    return this.deps[provider]
  }

  private async fetchAll(allowKeychain: boolean): Promise<QuotaProvider[]> {
    const startingGenerations = { ...this.generations }
    const prior = this.cache?.value ?? []
    const blocked = await this.readBlocked()
    const run = async (provider: ProviderNameFromQuota): Promise<QuotaProvider> => {
      const retainOnFailure = (next: QuotaProvider): QuotaProvider => {
        const candidate = this.lastGood[provider] ?? prior.find(item => item.provider === provider)
        const previous = candidate
          && hasProviderQuotaFacts(candidate)
          && candidate.observedAt !== null
          && Number.isFinite(Date.parse(candidate.observedAt))
          ? candidate
          : undefined
        if (!previous) return next

        // Background polls deliberately skip keychain reads. Keep the previous
        // factual value, but make the unavailable/stale state explicit. A
        // force refresh does not get this exception for missing credentials.
        const backgroundCredentialMiss = !allowKeychain && (next.connection === 'disconnected' || next.connection === 'accessDenied')
        const transient = next.connection === 'transientFailure' || next.connection === 'stale' || backgroundCredentialMiss
        if (!transient) return next
        return markStale(previous, next.connection === 'stale' ? 'stale' : 'transientFailure', next.rateLimit)
      }

      const until = blocked[provider] ? Date.parse(blocked[provider]!) : NaN
      if (Number.isFinite(until) && until > this.deps.now()) {
        const previous = this.lastGood[provider] ?? prior.find(item => item.provider === provider)
        return retainOnFailure({
          ...emptyQuota(provider, 'transientFailure', backoffRateLimit(new Date(until).toISOString())),
          ...(previous?.source ? { source: previous.source } : {}),
        })
      }

      const generation = this.generations[provider]
      const controller = new AbortController()
      this.controllers[provider] = controller
      try {
        const result = await this.fetcher(provider)({ signal: controller.signal, allowKeychain })
        if (generation !== this.generations[provider] || controller.signal.aborted) return emptyQuota(provider, 'disconnected')

        const quota = sanitizeQuotaProvider(result.quota) ?? emptyQuota(provider, 'transientFailure')
        if (result.retryAfterSeconds !== undefined) {
          const seconds = Number.isFinite(result.retryAfterSeconds) ? Math.max(60, Math.ceil(result.retryAfterSeconds)) : 300
          const retryAt = new Date(this.deps.now() + seconds * 1000).toISOString()
          blocked[provider] = retryAt
          await this.writeBlocked(blocked)
          // A 429 response contains no new quota fact. Do not let an adapter
          // accidentally mark its placeholder as fresh; only a prior factual
          // snapshot may supply windows while this backoff is active.
          return retainOnFailure({
            ...emptyQuota(provider, 'transientFailure', backoffRateLimit(retryAt)),
            ...(quota.source ? { source: quota.source } : {}),
          })
        }

        if (blocked[provider]) {
          delete blocked[provider]
          await this.writeBlocked(blocked)
        }
        if (isFactualSnapshot(quota)) this.lastGood[provider] = quota
        return retainOnFailure(quota)
      } catch (error) {
        // Provider adapters normally convert failures to a snapshot. Keep this
        // final guard so one provider's outage cannot reject the all-provider request.
        console.warn(`${provider} quota unavailable: ${sanitizeError(error)}`)
        return retainOnFailure(emptyQuota(provider, 'transientFailure'))
      } finally {
        if (this.controllers[provider] === controller) this.controllers[provider] = undefined
      }
    }

    const value = await Promise.all(PROVIDER_NAMES.map(run))
    const unchanged = PROVIDER_NAMES.every(provider => startingGenerations[provider] === this.generations[provider])
    if (unchanged) this.cache = { at: this.deps.now(), value }
    return value
  }
}

export const quotaService = new QuotaService()

// Keychain reads can raise a one-time macOS permission dialog, so only attempt
// them on a user-initiated forced refresh (the Connect / Refresh affordance).
// Background polls skip the keychain and lean on retainOnFailure to hold a
// live connection steady between forced refreshes.
export const getQuota = (options: { force?: boolean } = {}): Promise<QuotaProvider[]> =>
  quotaService.getQuota({ force: options.force, allowKeychain: Boolean(options.force) })
