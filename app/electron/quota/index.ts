import os from 'node:os'
import path from 'node:path'

import { fetchAntigravityQuota } from './antigravity'
import { fetchClaudeQuota } from './claude'
import { fetchCodexQuota } from './codex'
import { fetchCopilotQuota } from './copilot'
import { fetchKimiQuota } from './kimi'
import { atomicWriteSecureFile, readSecureFile, sanitizeError } from './security'
import { sameIdentity, unknownIdentity, type IdentityObservation } from './identity'
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
type FetchResult = { quota: QuotaProvider; retryAfterSeconds?: number; identity: IdentityObservation }
type ProviderFetcher = (options: { signal: AbortSignal; allowKeychain: boolean; identityOnly?: boolean }) => Promise<FetchResult>
type RetainedQuota = { quota: QuotaProvider; identity: IdentityObservation }
type CacheState = { at: number; value: QuotaProvider[]; retained: Partial<Record<ProviderNameFromQuota, RetainedQuota>> }
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
  private cache: CacheState | null = null
  /** Last factual value survives cache invalidation so force failures can be honest. */
  private readonly lastGood: Partial<Record<ProviderNameFromQuota, RetainedQuota>> = {}
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
    const cached = this.cache
    const cachedGenerations = { ...this.generations }
    if (!options.force && cached && this.deps.now() - cached.at < this.deps.refreshMs) {
      const safe = await this.cacheIsIdentitySafe(cached, Boolean(options.allowKeychain))
      const unchanged = PROVIDER_NAMES.every(provider => cachedGenerations[provider] === this.generations[provider])
      if (safe && unchanged && this.cache === cached) return cached.value
    }
    if (this.flight) return this.flight
    this.flight = this.fetchAll(Boolean(options.allowKeychain)).finally(() => { this.flight = null })
    return this.flight
  }

  private async observeIdentity(provider: ProviderNameFromQuota, allowKeychain: boolean): Promise<FetchResult> {
    try {
      const result = await this.fetcher(provider)({
        signal: new AbortController().signal,
        allowKeychain,
        identityOnly: true,
      })
      return { ...result, identity: result.identity ?? unknownIdentity() }
    } catch {
      return { quota: emptyQuota(provider, 'transientFailure'), identity: unknownIdentity() }
    }
  }

  private clearRetained(provider: ProviderNameFromQuota): void {
    this.lastGood[provider] = undefined
  }

  private async cacheIsIdentitySafe(cache: CacheState, allowKeychain: boolean): Promise<boolean> {
    const checks = await Promise.all(PROVIDER_NAMES.map(async provider => {
      const current = cache.value.find(item => item.provider === provider)
      if (!current || !hasRetainedFacts(current)) return true
      const retained = cache.retained[provider]
      if (!retained) return false
      const observed = await this.observeIdentity(provider, allowKeychain)
      if (hasKnownIdentityMismatch(retained.identity, observed.identity)) return false
      return sameIdentity(retained.identity, observed.identity)
    }))
    return checks.every(Boolean)
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
    const runIdentities: Partial<Record<ProviderNameFromQuota, IdentityObservation>> = {}
    const blocked = await this.readBlocked()
    const run = async (provider: ProviderNameFromQuota): Promise<QuotaProvider> => {
      const retainOnFailure = (next: QuotaProvider, identity: IdentityObservation): QuotaProvider => {
        runIdentities[provider] = identity
        const candidate = this.lastGood[provider] ?? this.cache?.retained[provider]
        const previous = candidate && hasRetainedFacts(candidate.quota) ? candidate : undefined
        if (!previous) return next
        if (hasKnownIdentityMismatch(previous.identity, identity)) {
          this.clearRetained(provider)
          return next
        }
        if (!sameIdentity(previous.identity, identity)) return next

        // Background polls deliberately skip keychain reads. Keep the previous
        // factual value, but make the unavailable/stale state explicit. A
        // force refresh does not get this exception for missing credentials.
        const backgroundCredentialMiss = !allowKeychain && (next.connection === 'disconnected' || next.connection === 'accessDenied')
        const transient = next.connection === 'transientFailure' || next.connection === 'stale' || backgroundCredentialMiss
        if (!transient) return next
        return markStale(previous.quota, next.connection === 'stale' ? 'stale' : 'transientFailure', next.rateLimit)
      }

      const until = blocked[provider] ? Date.parse(blocked[provider]!) : NaN
      if (Number.isFinite(until) && until > this.deps.now()) {
        const identityProbe = await this.observeIdentity(provider, allowKeychain)
        const preflightIdentity = identityProbe.identity
        const retained = this.lastGood[provider] ?? this.cache?.retained[provider]
        const identityChanged = retained && hasKnownIdentityMismatch(retained.identity, preflightIdentity)
        if (!identityChanged) {
          return retainOnFailure({
            ...emptyQuota(provider, 'transientFailure', backoffRateLimit(new Date(until).toISOString())),
          }, preflightIdentity)
        }
        // A provider-level backoff belongs to the authority that produced it.
        // Once a different known authority is observed, remove that boundary
        // before fetching so the new authority cannot inherit the old pause.
        delete blocked[provider]
        await this.writeBlocked(blocked)
      }

      const generation = this.generations[provider]
      const controller = new AbortController()
      this.controllers[provider] = controller
      try {
        const result = await this.fetcher(provider)({ signal: controller.signal, allowKeychain })
        if (generation !== this.generations[provider] || controller.signal.aborted) return emptyQuota(provider, 'disconnected')

        const quota = sanitizeQuotaProvider(result.quota) ?? emptyQuota(provider, 'transientFailure')
        const postflight = await this.observeIdentity(provider, allowKeychain)
        if (hasKnownIdentityMismatch(result.identity, postflight.identity)) {
          this.clearRetained(provider)
          runIdentities[provider] = postflight.identity
          return emptyQuota(provider, 'disconnected')
        }
        const resultIdentity = result.identity.state === 'known'
          ? result.identity
          : isFactualSnapshot(quota) ? unknownIdentity() : postflight.identity
        if (resultIdentity.state !== 'known' || postflight.identity.state !== 'known') {
          // Factual state without a safely comparable identity must never be
          // accepted or retained. Unknown is not an account-change claim.
          runIdentities[provider] = postflight.identity
          return emptyQuota(provider, 'transientFailure')
        }
        const identity = postflight.identity
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
          }, identity)
        }

        if (blocked[provider]) {
          delete blocked[provider]
          await this.writeBlocked(blocked)
        }
        if (isFactualSnapshot(quota)) this.lastGood[provider] = { quota, identity }
        return retainOnFailure(quota, identity)
      } catch (error) {
        // Provider adapters normally convert failures to a snapshot. Keep this
        // final guard so one provider's outage cannot reject the all-provider request.
        console.warn(`${provider} quota unavailable: ${sanitizeError(error)}`)
        const postflight = await this.observeIdentity(provider, allowKeychain)
        return retainOnFailure(emptyQuota(provider, 'transientFailure'), postflight.identity)
      } finally {
        if (this.controllers[provider] === controller) this.controllers[provider] = undefined
      }
    }

    const value = await Promise.all(PROVIDER_NAMES.map(run))
    const unchanged = PROVIDER_NAMES.every(provider => startingGenerations[provider] === this.generations[provider])
    if (unchanged) {
      const retained: Partial<Record<ProviderNameFromQuota, RetainedQuota>> = {}
      for (const provider of PROVIDER_NAMES) {
        const identity = runIdentities[provider]
        const quota = value.find(item => item.provider === provider)
        if (identity?.state === 'known' && quota && hasRetainedFacts(quota)) retained[provider] = { quota, identity }
      }
      this.cache = { at: this.deps.now(), value, retained }
    }
    return value
  }
}

function hasRetainedFacts(quota: QuotaProvider): boolean {
  return hasProviderQuotaFacts(quota)
    && quota.observedAt !== null
    && Number.isFinite(Date.parse(quota.observedAt))
}

function hasKnownIdentityMismatch(left: IdentityObservation, right: IdentityObservation): boolean {
  return left.state === 'known' && right.state === 'known' && !sameIdentity(left, right)
}

export const quotaService = new QuotaService()

// Keychain reads can raise a one-time macOS permission dialog, so only attempt
// them on a user-initiated forced refresh (the Connect / Refresh affordance).
// Background polls skip the keychain and lean on retainOnFailure to hold a
// live connection steady between forced refreshes.
export const getQuota = (options: { force?: boolean } = {}): Promise<QuotaProvider[]> =>
  quotaService.getQuota({ force: options.force, allowKeychain: Boolean(options.force) })
