import { describe, expect, it, vi } from 'vitest'

import { QuotaService } from './index'
import { knownIdentity, unknownIdentity } from './identity'
import type { ProviderName, QuotaProvider } from './types'

const quota = (provider: ProviderName, overrides: Partial<QuotaProvider> = {}): QuotaProvider => ({
  schemaVersion: 1,
  provider,
  authority: 'provider-reported',
  availability: 'available',
  connection: 'connected',
  freshness: 'fresh',
  observedAt: '2026-07-12T00:00:00.000Z',
  planLabel: null,
  windows: [],
  credits: null,
  rateLimit: { state: 'clear', retryAt: null },
  ...overrides,
})

const result = (provider: ProviderName, value: QuotaProvider = quota(provider), account = 'A', extra: Record<string, unknown> = {}) => ({
  ...extra,
  quota: value,
  identity: knownIdentity(provider, account),
})

function providerDeps(overrides: Partial<Record<ProviderName, ReturnType<typeof vi.fn>>> = {}) {
  return {
    claude: overrides.claude ?? vi.fn(async () => result('claude')),
    codex: overrides.codex ?? vi.fn(async () => result('codex')),
    copilot: overrides.copilot ?? vi.fn(async () => result('copilot')),
    kimi: overrides.kimi ?? vi.fn(async () => result('kimi')),
    antigravity: overrides.antigravity ?? vi.fn(async () => result('antigravity')),
  }
}

function actualCalls(fetcher: ReturnType<typeof vi.fn>): number {
  return fetcher.mock.calls.filter(([options]) => !options?.identityOnly).length
}

function probe(provider: ProviderName, identity: ReturnType<typeof knownIdentity>) {
  return { quota: quota(provider, { availability: 'unavailable', connection: 'loading', freshness: 'unavailable', observedAt: null }), identity }
}

function factual(provider: ProviderName, usedFraction: number, observedAt: string): QuotaProvider {
  return quota(provider, {
    observedAt,
    windows: [{ id: 'window', label: 'Usage', usedFraction, resetsAt: null, windowSeconds: 3600 }],
  })
}

describe('QuotaService', () => {
  it('fans out to every canonical provider in stable order', async () => {
    const deps = providerDeps()
    const service = new QuotaService({
      ...deps,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    const value = await service.getQuota({ force: true })
    expect(value.map(row => row.provider)).toEqual(['claude', 'codex', 'copilot', 'kimi', 'antigravity'])
    for (const fetcher of Object.values(deps)) expect(actualCalls(fetcher)).toBe(1)
  })

  it('persists provider 429 blocked-until and gates only that provider', async () => {
    const writes: string[] = []
    const claude = vi.fn(async () => result('claude', quota('claude'), 'A', { retryAfterSeconds: 60 }))
    const deps = providerDeps({ claude })
    const service = new QuotaService({
      ...deps, now: () => Date.parse('2026-07-12T00:00:00Z'),
      readFile: vi.fn(async () => writes.at(-1) ?? null),
      writeFile: vi.fn(async (_path, value) => { writes.push(value) }),
      statePath: '/mock/backoff.json',
    })
    await service.getQuota({ force: true })
    const saved = JSON.parse(writes[0]!)
    expect(saved.claude).toBe('2026-07-12T00:01:00.000Z')
    await service.getQuota({ force: true })
    expect(actualCalls(claude)).toBe(1)
    expect(actualCalls(deps.codex)).toBe(2)
    expect(actualCalls(deps.copilot)).toBe(2)
    expect(actualCalls(deps.kimi)).toBe(2)
    expect(actualCalls(deps.antigravity)).toBe(2)
  })

  it('force re-fetches within the cache window by invalidating first', async () => {
    const deps = providerDeps()
    const service = new QuotaService({
      ...deps, now: () => 1000, refreshMs: 120_000,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    await service.getQuota()
    await service.getQuota()
    expect(actualCalls(deps.claude)).toBe(1)
    await service.getQuota({ force: true })
    expect(actualCalls(deps.claude)).toBe(2)
  })

  it('single-flights simultaneous callers', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const claude = vi.fn(async () => { await pending; return result('claude') })
    const deps = providerDeps({ claude })
    const service = new QuotaService({
      ...deps,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    const first = service.getQuota({ force: true })
    const second = service.getQuota({ force: true })
    release()
    expect(await first).toEqual(await second)
    expect(actualCalls(claude)).toBe(1)
  })

  it('retains one provider last factual snapshot without contaminating peers', async () => {
    let healthy = true
    const factual = quota('kimi', {
      source: { kind: 'provider-api', stability: 'experimental' },
      observedAt: '2026-07-11T23:00:00.000Z',
      windows: [{ id: 'weekly', label: 'Weekly', usedFraction: 0.25, resetsAt: '2026-07-19T00:00:00.000Z', windowSeconds: 604_800 }],
    })
    const kimi = vi.fn(async () => result('kimi', healthy ? factual : quota('kimi', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null })))
    const deps = providerDeps({ kimi })
    let now = Date.parse('2026-07-12T00:00:00Z')
    const service = new QuotaService({
      ...deps, now: () => now,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })

    const first = await service.getQuota({ force: true })
    expect(first[3]!.freshness).toBe('fresh')
    healthy = false
    now += 5 * 60_000
    const second = await service.getQuota({ force: true })
    expect(second[3]).toMatchObject({
      provider: 'kimi', connection: 'transientFailure', availability: 'unavailable', freshness: 'stale',
      observedAt: '2026-07-11T23:00:00.000Z', source: { kind: 'provider-api', stability: 'experimental' },
    })
    expect(second[3]!.windows).toEqual(factual.windows)
    expect(second[2]!.provider).toBe('copilot')
    expect(second[2]!.connection).toBe('connected')
  })

  it('does not fabricate windows when there is no previous factual snapshot', async () => {
    const claude = vi.fn(async () => result('claude', quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null })))
    const service = new QuotaService({
      ...providerDeps({ claude }),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    const value = await service.getQuota({ force: true })
    expect(value[0]!.windows).toEqual([])
    expect(value[0]!.observedAt).toBeNull()
    expect(value[0]!.freshness).toBe('unavailable')
  })

  it('reuses stale facts only for the same credential identity and never exposes the key', async () => {
    let account = 'A'
    let failure = false
    const claude = vi.fn(async (options: { identityOnly?: boolean }) => {
      const identity = knownIdentity('claude', 'credential', account)
      if (options.identityOnly) return probe('claude', identity)
      return failure
        ? { quota: quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }), identity }
        : { quota: factual('claude', account === 'A' ? 0.2 : 0.8, account === 'A' ? '2026-07-12T00:00:00.000Z' : '2026-07-12T01:00:00.000Z'), identity }
    })
    const service = new QuotaService({
      ...providerDeps({ claude }),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })

    await service.getQuota({ force: true })
    account = 'B'
    await service.getQuota({ force: true })
    failure = true
    const retained = await service.getQuota({ force: true })

    expect(retained[0]!.windows[0]!.usedFraction).toBe(0.8)
    expect(JSON.stringify(retained)).not.toContain('credential')
    expect(JSON.stringify(retained)).not.toContain('account')
  })

  it('fails closed instead of serving A when switching to B before a transient failure', async () => {
    let account = 'A'
    let failure = false
    const claude = vi.fn(async (options: { identityOnly?: boolean }) => {
      const identity = knownIdentity('claude', 'credential', account)
      if (options.identityOnly) return probe('claude', identity)
      return failure
        ? { quota: quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }), identity }
        : { quota: factual('claude', 0.2, '2026-07-12T00:00:00.000Z'), identity }
    })
    const service = new QuotaService({
      ...providerDeps({ claude }),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })

    await service.getQuota({ force: true })
    account = 'B'
    failure = true
    const value = await service.getQuota({ force: true })

    expect(value[0]!.windows).toEqual([])
    expect(value[0]!.observedAt).toBeNull()
    expect(value[0]!.freshness).toBe('unavailable')
  })

  it('checks identity before returning a fresh cache after an account switch', async () => {
    let account = 'A'
    const claude = vi.fn(async (options: { identityOnly?: boolean }) => {
      const identity = knownIdentity('claude', 'credential', account)
      if (options.identityOnly) return probe('claude', identity)
      return { quota: factual('claude', account === 'A' ? 0.1 : 0.9, '2026-07-12T00:00:00.000Z'), identity }
    })
    const service = new QuotaService({
      ...providerDeps({ claude }), refreshMs: 60_000,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })

    await service.getQuota({ force: true })
    account = 'B'
    const value = await service.getQuota()

    expect(value[0]!.windows[0]!.usedFraction).toBe(0.9)
    expect(actualCalls(claude)).toBe(2)
  })

  it('discards an A response that completes after the current identity becomes B', async () => {
    let account = 'A'
    let release!: () => void
    let started!: () => void
    const requestStarted = new Promise<void>(resolve => { started = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    const claude = vi.fn(async (options: { identityOnly?: boolean }) => {
      const identityAtCall = knownIdentity('claude', 'credential', account)
      if (options.identityOnly) return probe('claude', identityAtCall)
      const accountAtRequest = account
      started()
      await pending
      return { quota: factual('claude', accountAtRequest === 'A' ? 0.2 : 0.8, '2026-07-12T00:00:00.000Z'), identity: identityAtCall }
    })
    const service = new QuotaService({
      ...providerDeps({ claude }),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })

    const request = service.getQuota({ force: true })
    await requestStarted
    account = 'B'
    release()
    const value = await request

    expect(value[0]!.windows).toEqual([])
    expect(value[0]!.connection).toBe('disconnected')
  })

  it('drops A backoff and fetches B instead of retaining A', async () => {
    let account = 'A'
    let mode: 'success' | 'rateLimit' = 'success'
    const writes: string[] = []
    const claude = vi.fn(async (options: { identityOnly?: boolean }) => {
      const identity = knownIdentity('claude', 'credential', account)
      if (options.identityOnly) return probe('claude', identity)
      if (mode === 'rateLimit') return { quota: quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }), retryAfterSeconds: 600, identity }
      return { quota: factual('claude', account === 'A' ? 0.2 : 0.8, account === 'A' ? '2026-07-12T00:00:00.000Z' : '2026-07-12T01:00:00.000Z'), identity }
    })
    const service = new QuotaService({
      ...providerDeps({ claude }), now: () => Date.parse('2026-07-12T00:00:00Z'),
      readFile: vi.fn(async () => writes.at(-1) ?? null),
      writeFile: vi.fn(async (_path, value) => { writes.push(value) }),
      statePath: '/mock/backoff.json',
    })

    await service.getQuota({ force: true })
    mode = 'rateLimit'
    const rateLimited = await service.getQuota({ force: true })
    expect(rateLimited[0]!.freshness).toBe('stale')
    account = 'B'
    mode = 'success'
    const value = await service.getQuota({ force: true })

    expect(value[0]!.windows[0]!.usedFraction).toBe(0.8)
    expect(actualCalls(claude)).toBe(3)
  })

  it('does not turn a background keychain restriction into an identity change', async () => {
    const identity = knownIdentity('claude', 'credential', 'A')
    let failure = false
    const claude = vi.fn(async (options: { identityOnly?: boolean; allowKeychain?: boolean }) => {
      if (!options.allowKeychain) {
        return options.identityOnly
          ? probe('claude', unknownIdentity())
          : { quota: quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }), identity: unknownIdentity() }
      }
      if (options.identityOnly) return probe('claude', identity)
      if (failure) return { quota: quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }), identity }
      return { quota: factual('claude', 0.2, '2026-07-12T00:00:00.000Z'), identity }
    })
    const service = new QuotaService({
      ...providerDeps({ claude }),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })

    await service.getQuota({ force: true, allowKeychain: true })
    const restricted = await service.getQuota({ force: true, allowKeychain: false })
    expect(restricted[0]!.windows).toEqual([])
    failure = true
    const sameAccount = await service.getQuota({ force: true, allowKeychain: true })
    expect(sameAccount[0]!.freshness).toBe('stale')
    expect(sameAccount[0]!.windows[0]!.usedFraction).toBe(0.2)
  })
})
