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

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
  root = join(tmpdir(), `metrora-empty-legacy-watermark-${Math.random().toString(36).slice(2)}`)
  process.env['CODEBURN_CACHE_DIR'] = root
  await mkdir(root, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  if (existsSync(root)) await rm(root, { recursive: true, force: true })
})

describe('empty legacy daily-cache watermark', () => {
  it('currently leaves an unstamped empty cache stranded behind its advanced watermark', async () => {
    await writeFile(dailyCachePath(), JSON.stringify({
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: 'cfg-A',
      tzKey: currentTzKey(),
      lastComputedDate: dateStr(1),
      days: [],
      complete: true,
    }), 'utf-8')

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

    // Characterization of the blocking legacy defect: the advanced watermark
    // hides the empty historical tail, so recovery never runs.
    expect(parses).toBe(0)
    expect(out.days).toEqual([])
    expect(out.lastComputedDate).toBe(dateStr(1))
    expect(out.complete).toBe(true)
    expect(out.watermarkTrusted).toBe(false)
  })
})
