import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  DAILY_CACHE_VERSION,
  ensureCacheHydrated,
  loadDailyCache,
  type DailyEntry,
  type ProjectDayStats,
  type ProviderDaySlice,
} from '../src/daily-cache-core.js'

let cacheDir: string
let previousCacheDir: string | undefined
let previousTz: string | undefined

function day(
  date: string,
  slice: ProviderDaySlice,
  projects?: Record<string, ProjectDayStats>,
): DailyEntry {
  return {
    date,
    cost: slice.cost,
    savingsUSD: slice.savingsUSD,
    calls: slice.calls,
    sessions: slice.sessions ?? 0,
    inputTokens: slice.inputTokens ?? 0,
    outputTokens: slice.outputTokens ?? 0,
    cacheReadTokens: slice.cacheReadTokens ?? 0,
    cacheWriteTokens: slice.cacheWriteTokens ?? 0,
    editTurns: slice.editTurns ?? 0,
    oneShotTurns: slice.oneShotTurns ?? 0,
    models: slice.models ?? {},
    categories: slice.categories ?? {},
    providers: { codex: slice },
    ...(projects ? { projects } : {}),
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-05T12:00:00Z'))
  cacheDir = await mkdtemp(join(tmpdir(), 'codex-v17-cache-'))
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  previousTz = process.env['TZ']
  process.env['METRORA_CACHE_DIR'] = cacheDir
  process.env['TZ'] = 'UTC'
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  if (previousTz === undefined) delete process.env['TZ']
  else process.env['TZ'] = previousTz
  await rm(cacheDir, { recursive: true, force: true })
})

describe('Codex daily-cache v17 migration', () => {
  it('re-derives surviving Codex days and carries sourceless history losslessly and idempotently', async () => {
    expect(DAILY_CACHE_VERSION).toBe(17)
    await mkdir(cacheDir, { recursive: true })
    const v16 = {
      version: 16,
      savingsConfigHash: 'settled-config',
      tzKey: 'UTC',
      lastComputedDate: '2026-08-04',
      complete: true,
      days: [
        day('2026-08-02', {
          calls: 1,
          cost: 1.25,
          savingsUSD: 0.1,
          sessions: 1,
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          models: {},
          categories: {},
          projects: { old: { cost: 1.25, calls: 1, savingsUSD: 0.1, sessions: 1, path: '/old' } },
        }, { old: { cost: 1.25, calls: 1, savingsUSD: 0.1, sessions: 1, path: '/old' } }),
        day('2026-08-03', {
          calls: 3,
          cost: 12.345678,
          savingsUSD: 0.75,
          sessions: 2,
          inputTokens: 900,
          outputTokens: 300,
          cacheReadTokens: 100,
          cacheWriteTokens: 0,
          models: {},
          categories: {},
        }),
      ],
    }
    await writeFile(join(cacheDir, 'daily-cache.v16.json'), JSON.stringify(v16))

    const adopted = await loadDailyCache()
    expect(adopted.version).toBe(17)
    expect(adopted.complete).toBe(false)
    expect(adopted.days).toHaveLength(2)

    const freshProjects = { fresh: { cost: 2.5, calls: 2, savingsUSD: 0.2, sessions: 1, path: '/fresh' } }
    const freshDay = day('2026-08-02', {
      calls: 2,
      cost: 2.5,
      savingsUSD: 0.2,
      sessions: 1,
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      models: {},
      categories: {},
      projects: freshProjects,
    }, freshProjects)

    let parses = 0
    const hydrate = () => ensureCacheHydrated(
      async () => { parses++; return [] },
      () => [freshDay],
      'settled-config',
      () => true,
    )

    const migrated = await hydrate()
    expect(parses).toBe(1)
    const surviving = migrated.days.find(entry => entry.date === '2026-08-02')!
    const sourceless = migrated.days.find(entry => entry.date === '2026-08-03')!

    expect(surviving.calls).toBe(2)
    expect(surviving.cost).toBe(2.5)
    expect(surviving.providers.codex.calls).toBe(2)
    expect(surviving.providers.codex.cost).toBe(2.5)
    expect(surviving.projects?.fresh?.calls).toBe(2)
    expect(surviving.projects?.old).toBeUndefined()
    expect(surviving.cost).toBe(surviving.providers.codex.cost)
    expect(surviving.cost).toBe(surviving.projects?.fresh?.cost)

    expect(sourceless.calls).toBe(3)
    expect(sourceless.cost).toBe(12.345678)
    expect(sourceless.providers.codex.cost).toBe(12.345678)
    expect(sourceless.projects).toBeUndefined()
    expect(sourceless.providers.codex.projects).toBeUndefined()
    expect(sourceless.carried).toBe(true)

    const totalCalls = migrated.days.reduce((sum, entry) => sum + entry.calls, 0)
    const providerCalls = migrated.days.reduce((sum, entry) => sum + entry.providers.codex.calls, 0)
    const totalCost = migrated.days.reduce((sum, entry) => sum + entry.cost, 0)
    const providerCost = migrated.days.reduce((sum, entry) => sum + entry.providers.codex.cost, 0)
    expect(totalCalls).toBe(5)
    expect(providerCalls).toBe(totalCalls)
    expect(providerCost).toBeCloseTo(totalCost, 12)

    const again = await hydrate()
    expect(parses).toBe(1)
    expect(again).toEqual(migrated)

    const persisted = JSON.parse(await readFile(join(cacheDir, 'daily-cache.v17.json'), 'utf-8'))
    expect(persisted.version).toBe(17)
    expect(persisted.days.find((entry: DailyEntry) => entry.date === '2026-08-03').cost).toBe(12.345678)
  })

  it('re-buckets after a timezone change without duplicating carried and fresh Codex slices', async () => {
    const baseline = day('2026-08-02', {
      calls: 2,
      cost: 4,
      savingsUSD: 0,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      models: {},
      categories: {},
    })
    await writeFile(join(cacheDir, 'daily-cache.v17.json'), JSON.stringify({
      version: 17,
      savingsConfigHash: 'same',
      tzKey: 'Europe/Rome',
      lastComputedDate: '2026-08-04',
      complete: true,
      days: [baseline],
    }))

    let parses = 0
    const migrated = await ensureCacheHydrated(
      async () => { parses++; return [] },
      () => [baseline],
      'same',
      () => true,
    )

    expect(parses).toBe(1)
    expect(migrated.days).toHaveLength(1)
    expect(migrated.days[0]!.calls).toBe(2)
    expect(migrated.days[0]!.cost).toBe(4)
    expect(migrated.days[0]!.providers.codex.calls).toBe(2)
    expect(migrated.days[0]!.providers.codex.cost).toBe(4)
  })
})
