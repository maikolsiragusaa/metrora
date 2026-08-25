import { describe, expect, it, vi } from 'vitest'

import { QuotaService } from './index'
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

function providerDeps(overrides: Partial<Record<ProviderName, ReturnType<typeof vi.fn>>> = {}) {
  return {
    claude: overrides.claude ?? vi.fn(async () => ({ quota: quota('claude') })),
    codex: overrides.codex ?? vi.fn(async () => ({ quota: quota('codex') })),
    copilot: overrides.copilot ?? vi.fn(async () => ({ quota: quota('copilot') })),
    kimi: overrides.kimi ?? vi.fn(async () => ({ quota: quota('kimi') })),
    antigravity: overrides.antigravity ?? vi.fn(async () => ({ quota: quota('antigravity') })),
  }
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
    for (const fetcher of Object.values(deps)) expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('persists provider 429 blocked-until and gates only that provider', async () => {
    const writes: string[] = []
    const claude = vi.fn(async () => ({ quota: quota('claude'), retryAfterSeconds: 60 }))
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
    expect(claude).toHaveBeenCalledTimes(1)
    expect(deps.codex).toHaveBeenCalledTimes(2)
    expect(deps.copilot).toHaveBeenCalledTimes(2)
    expect(deps.kimi).toHaveBeenCalledTimes(2)
    expect(deps.antigravity).toHaveBeenCalledTimes(2)
  })

  it('force re-fetches within the cache window by invalidating first', async () => {
    const deps = providerDeps()
    const service = new QuotaService({
      ...deps, now: () => 1000, refreshMs: 120_000,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    await service.getQuota()
    await service.getQuota()
    expect(deps.claude).toHaveBeenCalledTimes(1)
    await service.getQuota({ force: true })
    expect(deps.claude).toHaveBeenCalledTimes(2)
  })

  it('single-flights simultaneous callers', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const claude = vi.fn(async () => { await pending; return { quota: quota('claude') } })
    const deps = providerDeps({ claude })
    const service = new QuotaService({
      ...deps,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    const first = service.getQuota({ force: true })
    const second = service.getQuota({ force: true })
    release()
    expect(await first).toEqual(await second)
    expect(claude).toHaveBeenCalledTimes(1)
  })

  it('retains one provider last factual snapshot without contaminating peers', async () => {
    let healthy = true
    const factual = quota('kimi', {
      source: { kind: 'provider-api', stability: 'experimental' },
      observedAt: '2026-07-11T23:00:00.000Z',
      windows: [{ id: 'weekly', label: 'Weekly', usedFraction: 0.25, resetsAt: '2026-07-19T00:00:00.000Z', windowSeconds: 604_800 }],
    })
    const kimi = vi.fn(async () => ({ quota: healthy ? factual : quota('kimi', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }) }))
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
    const claude = vi.fn(async () => ({ quota: quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }) }))
    const service = new QuotaService({
      ...providerDeps({ claude }),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    const value = await service.getQuota({ force: true })
    expect(value[0]!.windows).toEqual([])
    expect(value[0]!.observedAt).toBeNull()
    expect(value[0]!.freshness).toBe('unavailable')
  })
})
