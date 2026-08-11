import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  DAILY_CACHE_VERSION,
  currentTzKey,
  ensureCacheHydrated,
  saveDailyCache,
  type DailyCache,
  type DailyEntry,
  type ProviderDaySlice,
} from '../src/daily-cache.js'

let cacheDir: string
let previousCacheDir: string | undefined
let previousTz: string | undefined

function slice(cost: number, calls = 1): ProviderDaySlice {
  return {
    calls,
    cost,
    savingsUSD: 0,
    sessions: calls,
    inputTokens: calls * 100,
    outputTokens: calls * 20,
    reasoningTokens: calls * 7,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: calls,
    oneShotTurns: 0,
    models: {},
    categories: {},
    projects: { metrora: { cost, calls, savingsUSD: 0, sessions: calls, path: 'C:/work/metrora' } },
  }
}

function day(date: string, provider: string, providerSlice: ProviderDaySlice): DailyEntry {
  return {
    date,
    cost: providerSlice.cost,
    savingsUSD: providerSlice.savingsUSD,
    calls: providerSlice.calls,
    sessions: providerSlice.sessions ?? 0,
    inputTokens: providerSlice.inputTokens ?? 0,
    outputTokens: providerSlice.outputTokens ?? 0,
    reasoningTokens: providerSlice.reasoningTokens ?? 0,
    cacheReadTokens: providerSlice.cacheReadTokens ?? 0,
    cacheWriteTokens: providerSlice.cacheWriteTokens ?? 0,
    editTurns: providerSlice.editTurns ?? 0,
    oneShotTurns: providerSlice.oneShotTurns ?? 0,
    models: structuredClone(providerSlice.models ?? {}),
    categories: structuredClone(providerSlice.categories ?? {}),
    projects: structuredClone(providerSlice.projects ?? {}),
    providers: { [provider]: structuredClone(providerSlice) },
  }
}

async function seed(days: DailyEntry[], savingsConfigHash: string, tzKey: string): Promise<void> {
  const cache: DailyCache = {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash,
    tzKey,
    lastComputedDate: '2026-08-11',
    days,
    complete: true,
  }
  await saveDailyCache(cache)
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'))
  cacheDir = await mkdtemp(join(tmpdir(), 'metrora-r2-tz-boundary-'))
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  previousTz = process.env['TZ']
  process.env['METRORA_CACHE_DIR'] = cacheDir
  process.env['TZ'] = 'Europe/Rome'
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  if (previousTz === undefined) delete process.env['TZ']
  else process.env['TZ'] = previousTz
  await rm(cacheDir, { recursive: true, force: true })
})

describe('R2 timezone boundary characterization', () => {
  it('has zero accounting delta when the timezone is unchanged', async () => {
    const baseline = day('2026-08-10', 'codex', slice(5))
    await seed([baseline], 'cfg-A', currentTzKey())
    const out = await ensureCacheHydrated(async () => [], () => [], 'cfg-A')
    expect(out.days).toEqual([baseline])
  })

  it('refuses to finalize when timezone and accounting config change together', async () => {
    const baseline = day('2026-08-10', 'codex', slice(5))
    const freshCurrentTimezone = day('2026-08-11', 'codex', slice(7))
    const freshOldTimezone = day('2026-08-10', 'codex', slice(7))
    await seed([baseline], 'cfg-A', 'America/New_York')

    const out = await ensureCacheHydrated(
      async () => [],
      () => [freshCurrentTimezone],
      'cfg-B',
      () => true,
      () => [freshOldTimezone],
    )

    expect(out.days).toEqual([baseline])
    expect(out.savingsConfigHash).toBe('cfg-A')
    expect(out.tzKey).toBe('America/New_York')
  })

  it('does not finalize a timezone migration when the wide snapshot is incomplete', async () => {
    const baseline = day('2026-08-10', 'codex', slice(5))
    const freshCurrentTimezone = day('2026-08-11', 'codex', slice(7))
    await seed([baseline], 'cfg-A', 'America/New_York')
    let completeChecks = 0

    const out = await ensureCacheHydrated(
      async () => [],
      () => [freshCurrentTimezone],
      'cfg-A',
      () => ++completeChecks === 1,
      () => [],
    )

    expect(completeChecks).toBe(2)
    expect(out.complete).toBe(false)
    expect(out.lastComputedDate).toBe('2026-08-10')
    expect(out.days.find(entry => entry.date === '2026-08-10')?.cost).toBe(5)
  })

  it('does not drop an old-TZ finalized day that shares the new local today label', async () => {
    const oldYesterday = day('2026-08-12', 'codex', slice(5))
    await seed([oldYesterday], 'cfg-A', 'America/New_York')

    const out = await ensureCacheHydrated(async () => [], () => [], 'cfg-A')

    expect(out.days).toHaveLength(1)
    expect(out.days[0]).toMatchObject({ date: '2026-08-12', cost: 5, carried: true })
  })
})
