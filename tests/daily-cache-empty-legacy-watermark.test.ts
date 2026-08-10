import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { DateRange, ProjectSummary } from '../src/types.js'
import {
  DAILY_CACHE_VERSION,
  currentTzKey,
  dailyCachePath,
  ensureCacheHydrated,
  type DailyEntry,
  type ProviderDaySlice,
} from '../src/daily-cache.js'

let root: string

function dateStr(daysAgo: number): string {
  const date = new Date('2026-08-03T12:00:00.000Z')
  date.setUTCDate(date.getUTCDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

function slice(cost: number, calls: number): ProviderDaySlice {
  return { cost, calls, savingsUSD: 0 }
}

function day(date: string, providers: Record<string, ProviderDaySlice>): DailyEntry {
  return {
    date,
    cost: Object.values(providers).reduce((sum, provider) => sum + provider.cost, 0),
    savingsUSD: 0,
    calls: Object.values(providers).reduce((sum, provider) => sum + provider.calls, 0),
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
  }
}

async function seedEmptyLegacy(): Promise<void> {
  await writeFile(dailyCachePath(), JSON.stringify({
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: 'cfg-A',
    tzKey: currentTzKey(),
    lastComputedDate: dateStr(1),
    days: [],
    complete: true,
  }), 'utf-8')
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
  root = join(tmpdir(), `metrora-empty-legacy-watermark-${Math.random().toString(36).slice(2)}`)
  process.env['METRORA_CACHE_DIR'] = root
  await mkdir(root, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  if (existsSync(root)) await rm(root, { recursive: true, force: true })
})

describe('empty legacy daily-cache watermark', () => {
  it('reanalyses an empty unstamped legacy cache once and recovers historical days', async () => {
    await seedEmptyLegacy()

    let parses = 0
    const recovered = day(dateStr(4), { claude: slice(40, 400) })
    const out = await ensureCacheHydrated(
      async (_range: DateRange): Promise<ProjectSummary[]> => {
        parses += 1
        return []
      },
      () => [recovered],
      'cfg-A',
      () => true,
    )

    expect(parses).toBe(1)
    expect(out.days).toEqual([recovered])
    expect(out.lastComputedDate).toBe(dateStr(1))
    expect(out.complete).toBe(true)
    expect(out.watermarkTrusted).toBe(true)
  })

  it('does not create a parse treadmill after a complete parse legitimately finalizes an empty cache', async () => {
    await seedEmptyLegacy()

    let parses = 0
    const parseSessions = async (_range: DateRange): Promise<ProjectSummary[]> => {
      parses += 1
      return []
    }

    const finalized = await ensureCacheHydrated(parseSessions, () => [], 'cfg-A', () => true)
    expect(parses).toBe(1)
    expect(finalized.days).toEqual([])
    expect(finalized.lastComputedDate).toBe(dateStr(1))
    expect(finalized.complete).toBe(true)
    expect(finalized.watermarkTrusted).toBe(true)

    const reloaded = await ensureCacheHydrated(parseSessions, () => [], 'cfg-A', () => true)
    expect(parses).toBe(1)
    expect(reloaded.days).toEqual([])
    expect(reloaded.lastComputedDate).toBe(dateStr(1))
    expect(reloaded.complete).toBe(true)
    expect(reloaded.watermarkTrusted).toBe(true)
  })

  it('keeps the watermark unadvanced when the first recovery parse is degraded', async () => {
    await seedEmptyLegacy()

    let parses = 0
    const out = await ensureCacheHydrated(
      async (_range: DateRange): Promise<ProjectSummary[]> => {
        parses += 1
        return []
      },
      () => [],
      'cfg-A',
      () => false,
    )

    expect(parses).toBe(1)
    expect(out.days).toEqual([])
    expect(out.lastComputedDate).toBeNull()
    expect(out.complete).toBe(false)
    expect(out.watermarkTrusted).toBe(false)
  })
})
