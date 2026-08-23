import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
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

function slice(cost: number, calls: number, extra: Partial<ProviderDaySlice> = {}): ProviderDaySlice {
  return { cost, calls, savingsUSD: 0, ...extra }
}

function day(date: string, providers: Record<string, ProviderDaySlice>): DailyEntry {
  const values = Object.values(providers)
  const sum = (key: keyof ProviderDaySlice): number => values.reduce((total, value) => total + (Number(value[key]) || 0), 0)
  return {
    date,
    cost: sum('cost'),
    savingsUSD: sum('savingsUSD'),
    calls: sum('calls'),
    sessions: sum('sessions'),
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    ...(sum('reasoningTokens') > 0 ? { reasoningTokens: sum('reasoningTokens') } : {}),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    editTurns: sum('editTurns'),
    oneShotTurns: sum('oneShotTurns'),
    models: {},
    categories: {},
    providers,
  }
}

async function writeV17(days: DailyEntry[]): Promise<void> {
  await writeFile(join(root, 'daily-cache.v17.json'), JSON.stringify({
    version: 17,
    savingsConfigHash: 'cfg',
    tzKey: currentTzKey(),
    lastComputedDate: '2026-08-02',
    complete: true,
    watermarkTrusted: true,
    days,
  }), 'utf-8')
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
  root = join(tmpdir(), `metrora-copilot-daily-v18-${Math.random().toString(36).slice(2)}`)
  process.env['METRORA_CACHE_DIR'] = root
  await mkdir(root, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  if (existsSync(root)) await rm(root, { recursive: true, force: true })
})

describe('Copilot daily-cache v19 adoption from v17', () => {
  it('re-derives a surviving Copilot slice and carries an unrelated orphan once', async () => {
    expect(DAILY_CACHE_VERSION).toBe(20)
    const date = '2026-07-30'
    const staleCopilot = slice(90, 9, { sessions: 1, inputTokens: 900, outputTokens: 90 })
    const orphanClaude = slice(7, 1, { sessions: 1, inputTokens: 70, outputTokens: 7 })
    await writeV17([day(date, { copilot: staleCopilot, claude: orphanClaude })])

    const freshCopilot = slice(12, 2, { sessions: 1, inputTokens: 120, outputTokens: 12 })
    let parses = 0
    const parseSessions = async (_range: DateRange): Promise<ProjectSummary[]> => {
      parses++
      return []
    }
    const migrated = await ensureCacheHydrated(parseSessions, () => [day(date, { copilot: freshCopilot })], 'cfg', () => true)
    const migratedDay = migrated.days.find(entry => entry.date === date)!

    expect(parses).toBe(1)
    expect(migrated.version).toBe(20)
    expect(migrated.complete).toBe(true)
    expect(migrated.watermarkTrusted).toBe(true)
    expect(migratedDay.providers.copilot).toEqual(freshCopilot)
    expect(migratedDay.providers.claude).toEqual(orphanClaude)
    expect(migratedDay.carried).toBe(true)
    expect(migratedDay.calls).toBe(3)
    expect(migratedDay.cost).toBe(19)
    expect(migratedDay.inputTokens).toBe(190)
    expect(migratedDay.outputTokens).toBe(19)

    const again = await ensureCacheHydrated(parseSessions, () => [], 'cfg', () => true)
    expect(parses).toBe(1)
    expect(again.days.find(entry => entry.date === date)!.calls).toBe(3)
    expect(JSON.parse(await readFile(dailyCachePath(), 'utf-8')).version).toBe(20)
  })

  it('carries a sourceless Copilot slice exactly and does not create a historical zero', async () => {
    const date = '2026-07-29'
    const prior = slice(17.5, 63, {
      sessions: 5,
      inputTokens: 0,
      outputTokens: 1_174_967,
      models: { 'gpt-5.4': { calls: 63, cost: 17.5, savingsUSD: 0, inputTokens: 0, outputTokens: 1_174_967, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    })
    await writeV17([day(date, { copilot: prior })])

    let parses = 0
    const out = await ensureCacheHydrated(
      async (_range: DateRange): Promise<ProjectSummary[]> => { parses++; return [] },
      () => [],
      'cfg',
      () => true,
    )
    const carriedDay = out.days.find(entry => entry.date === date)!

    expect(parses).toBe(1)
    expect(carriedDay.providers.copilot).toEqual(prior)
    expect(carriedDay.calls).toBe(63)
    expect(carriedDay.outputTokens).toBe(1_174_967)
    expect(carriedDay.cost).toBe(17.5)
    expect(carriedDay.carried).toBe(true)
    expect(out.complete).toBe(true)
    expect(out.watermarkTrusted).toBe(true)

    await ensureCacheHydrated(async () => { parses++; return [] }, () => [], 'cfg', () => true)
    expect(parses).toBe(1)
  })

  it('keeps v17 untrusted until a parse is genuinely authoritative', async () => {
    const date = '2026-07-28'
    const prior = slice(30, 3, { sessions: 1, outputTokens: 300 })
    const fresh = slice(4, 1, { sessions: 1, inputTokens: 40, outputTokens: 4 })
    await writeV17([day(date, { copilot: prior })])

    let authoritative = false
    let parses = 0
    const parseSessions = async (_range: DateRange): Promise<ProjectSummary[]> => {
      parses++
      return []
    }
    const aggregate = () => authoritative ? [day(date, { copilot: fresh })] : []

    const degraded = await ensureCacheHydrated(parseSessions, aggregate, 'cfg', () => authoritative)
    expect(parses).toBe(1)
    expect(degraded.complete).toBe(false)
    expect(degraded.watermarkTrusted).toBe(false)
    expect(degraded.days.find(entry => entry.date === date)!.providers.copilot).toEqual(prior)

    authoritative = true
    const recovered = await ensureCacheHydrated(parseSessions, aggregate, 'cfg', () => authoritative)
    expect(parses).toBe(2)
    expect(recovered.complete).toBe(true)
    expect(recovered.watermarkTrusted).toBe(true)
    expect(recovered.days.find(entry => entry.date === date)!.providers.copilot).toEqual(fresh)

    await ensureCacheHydrated(parseSessions, aggregate, 'cfg', () => authoritative)
    expect(parses).toBe(2)
  })
})
