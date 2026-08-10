import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { DateRange, ProjectSummary } from '../src/types.js'
import {
  DAILY_CACHE_RETENTION_DAYS,
  DAILY_CACHE_VERSION,
  currentTzKey,
  dailyCachePath,
  ensureCacheHydrated,
  loadDailyCache,
  saveDailyCache,
  type DailyCache,
  type DailyEntry,
  type ProviderDaySlice,
} from '../src/daily-cache.js'

let root: string

function slice(cost: number, calls: number, extra: Partial<ProviderDaySlice> = {}): ProviderDaySlice {
  return { cost, calls, savingsUSD: 0, ...extra }
}

function day(date: string, providers: Record<string, ProviderDaySlice>, overrides: Partial<DailyEntry> = {}): DailyEntry {
  const cost = Object.values(providers).reduce((sum, provider) => sum + provider.cost, 0)
  const calls = Object.values(providers).reduce((sum, provider) => sum + provider.calls, 0)
  return {
    date,
    cost,
    savingsUSD: 0,
    calls,
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers,
    ...overrides,
  }
}

function dateStr(daysAgo: number): string {
  const date = new Date('2026-08-03T12:00:00.000Z')
  date.setUTCDate(date.getUTCDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

const noSessions = async (_range: DateRange): Promise<ProjectSummary[]> => []
const carried = day(dateStr(40), {
  claude: slice(399.70, 1572, {
    models: {
      'claude-opus-4-6': {
        calls: 1572,
        cost: 399.70,
        savingsUSD: 0,
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 300,
        cacheWriteTokens: 400,
      },
    },
  }),
}, { carried: true })

async function seed(overrides: Partial<DailyCache> = {}): Promise<void> {
  await saveDailyCache({
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: 'cfg-A',
    tzKey: currentTzKey(),
    lastComputedDate: dateStr(4),
    days: [carried, day(dateStr(4), { claude: slice(120, 900) })],
    complete: true,
    watermarkTrusted: true,
    ...overrides,
  })
}

function expectHistoricalValuationPreserved(cache: DailyCache): void {
  const kept = cache.days.find(entry => entry.date === carried.date)
  expect(kept).toMatchObject({ cost: 399.70, calls: 1572, carried: true })
  expect(kept!.providers['claude']).toMatchObject({ cost: 399.70, calls: 1572 })
  expect(kept!.providers['claude']!.models!['claude-opus-4-6']).toMatchObject({
    cost: 399.70,
    calls: 1572,
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheWriteTokens: 400,
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
  root = join(tmpdir(), `metrora-daily-watermark-${Math.random().toString(36).slice(2)}`)
  process.env['METRORA_CACHE_DIR'] = root
  await mkdir(root, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  if (existsSync(root)) await rm(root, { recursive: true, force: true })
})

describe('daily cache trusted watermark', () => {
  it('preserves the prior watermark and carried valuation when a gap parse is degraded', async () => {
    await seed()
    const out = await ensureCacheHydrated(noSessions, () => [], 'cfg-A', () => false)

    expect(out.lastComputedDate).toBe(dateStr(4))
    expect(out.complete).toBe(false)
    expect(out.watermarkTrusted).toBe(false)
    expectHistoricalValuationPreserved(out)
  })

  it('preserves the prior watermark on a degraded full re-derive', async () => {
    await seed({ complete: false, watermarkTrusted: true })
    const out = await ensureCacheHydrated(noSessions, () => [], 'cfg-A', () => false)

    expect(out.lastComputedDate).toBe(dateStr(4))
    expect(out.complete).toBe(false)
    expect(out.watermarkTrusted).toBe(false)
    expectHistoricalValuationPreserved(out)
  })

  it('recovers missed days and stamps the watermark at the first complete parse', async () => {
    await seed()
    await ensureCacheHydrated(noSessions, () => [], 'cfg-A', () => false)

    const recovered = [3, 2, 1].map(daysAgo => day(dateStr(daysAgo), {
      claude: slice(daysAgo * 10, daysAgo * 100),
    }))
    const out = await ensureCacheHydrated(noSessions, () => recovered, 'cfg-A', () => true)

    expect(out.days.map(entry => entry.date)).toEqual([
      dateStr(40), dateStr(4), dateStr(3), dateStr(2), dateStr(1),
    ])
    expect(out.lastComputedDate).toBe(dateStr(1))
    expect(out.complete).toBe(true)
    expect(out.watermarkTrusted).toBe(true)
    expectHistoricalValuationPreserved(out)
  })

  it('does not reanalyse a legitimately idle tail finalized by a complete parse', async () => {
    await seed({ lastComputedDate: dateStr(1), watermarkTrusted: true })
    let parses = 0
    const out = await ensureCacheHydrated(
      async () => { parses += 1; return [] },
      () => [],
      'cfg-A',
      () => true,
    )

    expect(parses).toBe(0)
    expect(out.lastComputedDate).toBe(dateStr(1))
    expect(out.complete).toBe(true)
    expect(out.watermarkTrusted).toBe(true)
    expectHistoricalValuationPreserved(out)
  })

  it('distrusts a legacy complete cache without the stamp and heals its hidden tail once', async () => {
    const legacy = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: 'cfg-A',
      tzKey: currentTzKey(),
      lastComputedDate: dateStr(1),
      days: [carried, day(dateStr(4), { claude: slice(120, 900) })],
      complete: true,
    }
    await writeFile(dailyCachePath(), JSON.stringify(legacy), 'utf-8')

    const loaded = await loadDailyCache()
    expect(loaded.watermarkTrusted).toBe(false)

    const ranges: DateRange[] = []
    const out = await ensureCacheHydrated(
      async range => { ranges.push(range); return [] },
      () => [
        day(dateStr(3), { claude: slice(30, 300) }),
        day(dateStr(2), { claude: slice(20, 200) }),
        day(dateStr(1), { claude: slice(10, 100) }),
      ],
      'cfg-A',
      () => true,
    )

    expect(ranges).toHaveLength(1)
    expect(out.lastComputedDate).toBe(dateStr(1))
    expect(out.complete).toBe(true)
    expect(out.watermarkTrusted).toBe(true)
    expectHistoricalValuationPreserved(out)
  })

  it('allows an empty complete cache to remain finalized without a parse treadmill', async () => {
    await seed({ days: [], lastComputedDate: dateStr(1), complete: true, watermarkTrusted: true })
    let parses = 0
    const out = await ensureCacheHydrated(
      async () => { parses += 1; return [] },
      () => [],
      'cfg-A',
      () => true,
    )

    expect(parses).toBe(0)
    expect(out.days).toEqual([])
    expect(out.lastComputedDate).toBe(dateStr(1))
    expect(out.complete).toBe(true)
    expect(out.watermarkTrusted).toBe(true)
  })

  it.each([
    ['savings configuration', { savingsConfigHash: 'cfg-old' }],
    ['timezone', { tzKey: 'Etc/Definitely-Old' }],
  ])('does not advance the watermark during a degraded %s re-derive', async (_reason, overrides) => {
    await seed(overrides)
    const out = await ensureCacheHydrated(noSessions, () => [], 'cfg-A', () => false)

    expect(out.lastComputedDate).toBe(dateStr(4))
    expect(out.complete).toBe(false)
    expect(out.watermarkTrusted).toBe(false)
    expectHistoricalValuationPreserved(out)
  })

  it('retains ten years of carried history while holding a degraded watermark', async () => {
    const yesterday = dateStr(1)
    const cutoff = new Date(`${yesterday}T00:00:00.000Z`)
    cutoff.setUTCDate(cutoff.getUTCDate() - DAILY_CACHE_RETENTION_DAYS)
    const inside = new Date(cutoff)
    inside.setUTCDate(inside.getUTCDate() + 1)
    const outside = new Date(cutoff)
    outside.setUTCDate(outside.getUTCDate() - 1)

    await seed({
      days: [
        day(inside.toISOString().slice(0, 10), { claude: slice(77, 7) }, { carried: true }),
        day(outside.toISOString().slice(0, 10), { claude: slice(88, 8) }, { carried: true }),
        day(dateStr(4), { claude: slice(120, 900) }),
      ],
    })

    const out = await ensureCacheHydrated(noSessions, () => [], 'cfg-A', () => false)
    expect(out.days.some(entry => entry.date === inside.toISOString().slice(0, 10))).toBe(true)
    expect(out.days.some(entry => entry.date === outside.toISOString().slice(0, 10))).toBe(false)
    expect(out.lastComputedDate).toBe(dateStr(4))
  })
})
