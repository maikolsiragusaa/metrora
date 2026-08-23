import { describe, expect, it, vi } from 'vitest'

import { QuotaService } from './index'
import type { QuotaProvider } from './types'

const quota = (provider: 'claude' | 'codex', overrides: Partial<QuotaProvider> = {}): QuotaProvider => ({
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

describe('QuotaService', () => {
  it('persists provider 429 blocked-until and gates the next forced fetch', async () => {
    const writes: string[] = []
    const claude = vi.fn(async () => ({ quota: quota('claude'), retryAfterSeconds: 60 }))
    const codex = vi.fn(async () => ({ quota: quota('codex') }))
    const service = new QuotaService({
      claude, codex, now: () => Date.parse('2026-07-12T00:00:00Z'),
      readFile: vi.fn(async () => writes.at(-1) ?? null),
      writeFile: vi.fn(async (_path, value) => { writes.push(value) }),
      statePath: '/mock/backoff.json',
    })
    await service.getQuota({ force: true })
    const saved = JSON.parse(writes[0]!)
    expect(saved.claude).toBe('2026-07-12T00:01:00.000Z')
    const first = await service.getQuota()
    expect(first[0]!.freshness).toBe('unavailable')
    expect(first[0]!.windows).toEqual([])
    await service.getQuota({ force: true })
    expect(claude).toHaveBeenCalledTimes(1)
    expect(codex).toHaveBeenCalledTimes(2)
  })

  it('force re-fetches within the cache window by invalidating first', async () => {
    const claude = vi.fn(async () => ({ quota: quota('claude') }))
    const codex = vi.fn(async () => ({ quota: quota('codex') }))
    const service = new QuotaService({
      claude, codex, now: () => 1000, refreshMs: 120_000,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    await service.getQuota()
    await service.getQuota() // fresh cache, no re-fetch
    expect(claude).toHaveBeenCalledTimes(1)
    await service.getQuota({ force: true }) // force clears the still-fresh cache
    expect(claude).toHaveBeenCalledTimes(2)
  })

  it('single-flights simultaneous callers', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const claude = vi.fn(async () => { await pending; return { quota: quota('claude') } })
    const service = new QuotaService({
      claude, codex: vi.fn(async () => ({ quota: quota('codex') })),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    const first = service.getQuota({ force: true })
    const second = service.getQuota({ force: true })
    release()
    expect(await first).toEqual(await second)
    expect(claude).toHaveBeenCalledTimes(1)
  })

  it('retains the last factual snapshot with stale freshness and original observation time', async () => {
    let healthy = true
    const factual = quota('claude', {
      observedAt: '2026-07-11T23:00:00.000Z',
      windows: [{ id: 'seven_day', label: 'Weekly', usedFraction: 0.25, resetsAt: '2026-07-19T00:00:00.000Z', windowSeconds: null }],
    })
    const claude = vi.fn(async () => ({ quota: healthy ? factual : quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }) }))
    let now = Date.parse('2026-07-12T00:00:00Z')
    const service = new QuotaService({
      claude, codex: vi.fn(async () => ({ quota: quota('codex') })), now: () => now,
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })

    const first = await service.getQuota({ force: true })
    expect(first[0]!.freshness).toBe('fresh')
    healthy = false
    now += 5 * 60_000
    const second = await service.getQuota({ force: true })
    expect(second[0]).toMatchObject({
      connection: 'transientFailure', availability: 'unavailable', freshness: 'stale',
      observedAt: '2026-07-11T23:00:00.000Z',
    })
    expect(second[0]!.windows).toEqual(factual.windows)
  })

  it('does not fabricate windows when there is no previous factual snapshot', async () => {
    const service = new QuotaService({
      claude: vi.fn(async () => ({ quota: quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }) })),
      codex: vi.fn(async () => ({ quota: quota('codex') })),
      readFile: vi.fn(async () => null), writeFile: vi.fn(async () => undefined),
    })
    const value = await service.getQuota({ force: true })
    expect(value[0]!.windows).toEqual([])
    expect(value[0]!.observedAt).toBeNull()
    expect(value[0]!.freshness).toBe('unavailable')
  })
})

