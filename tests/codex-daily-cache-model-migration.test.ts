import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { aggregateProjectsIntoDays } from '../src/day-aggregator.js'
import { getDailyCacheConfigHash } from '../src/daily-cache-config.js'
import type { DailyCache, DailyEntry, ProviderDaySlice } from '../src/daily-cache.js'
import { PROVIDER_PARSE_VERSIONS } from '../src/session-cache.js'

let root: string
let previousCacheDir: string | undefined
let previousCodexHome: string | undefined
type DailyApi = typeof import('../src/daily-cache.js')

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-21T12:00:00.000Z'))
  root = await mkdtemp(join(tmpdir(), 'metrora-codex-daily-model-'))
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  previousCodexHome = process.env['CODEX_HOME']
  process.env['METRORA_CACHE_DIR'] = join(root, 'metrora-cache')
  process.env['CODEX_HOME'] = join(root, 'codex')
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  if (previousCodexHome === undefined) delete process.env['CODEX_HOME']
  else process.env['CODEX_HOME'] = previousCodexHome
  await rm(root, { recursive: true, force: true })
})

const OLD_DURABLE_HISTORY_AUTHORITY = 'materialize-before-evict-v2-project-tokens'

function priorCodexAuthority(): string {
  return PROVIDER_PARSE_VERSIONS.codex!.replace('-session-meta-model-v1', '')
}

function configHashForAuthority(authority: string): string {
  const current = PROVIDER_PARSE_VERSIONS.codex
  PROVIDER_PARSE_VERSIONS.codex = authority
  try {
    return getDailyCacheConfigHash()
  } finally {
    PROVIDER_PARSE_VERSIONS.codex = current
  }
}

function modelStats(day: DailyEntry, model: string): Record<string, unknown> {
  const first = Object.values(day.models)[0]
  if (!first) throw new Error('Expected a model row')
  return { [model]: { ...first } }
}

function providerSliceWithModel(day: DailyEntry, model: string): ProviderDaySlice {
  const codex = day.providers.codex
  if (!codex) throw new Error('Expected a Codex provider slice')
  return { ...codex, models: modelStats(day, model) as ProviderDaySlice['models'] }
}

function staleModelDay(day: DailyEntry, model: string): DailyEntry {
  return {
    ...day,
    models: modelStats(day, model) as DailyEntry['models'],
    providers: {
      ...day.providers,
      codex: providerSliceWithModel(day, model),
    },
  }
}

async function seedDailyCache(daily: DailyApi, days: DailyEntry[], savingsConfigHash: string): Promise<void> {
  const cache: DailyCache = {
    version: daily.DAILY_CACHE_VERSION,
    savingsConfigHash,
    tzKey: 'UTC',
    durableHistoryAuthority: OLD_DURABLE_HISTORY_AUTHORITY,
    lastComputedDate: '2026-08-20',
    days,
    complete: true,
  }
  await daily.saveDailyCache(cache)
}

describe('Codex session_meta model attribution and durable daily history', () => {
  it('changes the daily hash and re-derives a surviving source across the 3650-day horizon', async () => {
    const daily = await import('../src/daily-cache.js')
    expect(daily.DAILY_CACHE_VERSION).toBe(19)
    expect(daily.DURABLE_HISTORY_AUTHORITY).toContain('codex-session-meta-model-v1')

    const oldHash = configHashForAuthority(priorCodexAuthority())
    const currentHash = getDailyCacheConfigHash()
    expect(currentHash).not.toBe(oldHash)
    expect(currentHash).toContain(`codexCollector=${PROVIDER_PARSE_VERSIONS.codex}`)

    const sessionDir = join(process.env['CODEX_HOME']!, 'sessions', '2026', '08', '01')
    await mkdir(sessionDir, { recursive: true })
    await mkdir(join(root, 'metrora-cache'), { recursive: true })
    await writeFile(join(sessionDir, 'rollout-daily-model.jsonl'), [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-08-01T10:00:00.000Z',
        payload: {
          session_id: 'daily-model-session',
          cwd: '/tmp/daily-model',
          originator: 'codex_cli_rs',
          base_instructions: {
            provenance: { type: 'model', model: 'WRONG_MODEL' },
            instruction_body: 'x'.repeat(40_000),
          },
        },
      }),
      JSON.stringify({
        type: 'turn_context',
        timestamp: '2026-08-01T10:00:01.000Z',
        payload: { model: 'gpt-5.4' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-08-01T10:00:02.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 4, total_tokens: 134 },
            total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 4, total_tokens: 134 },
          },
        },
      }),
    ].join('\n') + '\n', 'utf8')

    const { clearSessionCache, parseAllSessions } = await import('../src/parser.js')
    clearSessionCache()
    const fresh = aggregateProjectsIntoDays(await parseAllSessions(undefined, 'codex'))
    const freshDay = fresh.find(day => day.date === '2026-08-01')
    if (!freshDay) throw new Error('Expected the surviving Codex day')
    const stale = staleModelDay(freshDay, 'WRONG_MODEL')
    await seedDailyCache(daily, [stale], oldHash)

    let observedRangeStart: Date | undefined
    const migrated = await daily.ensureCacheHydrated(
      async range => {
        observedRangeStart = range.start
        return parseAllSessions(range, 'codex')
      },
      aggregateProjectsIntoDays,
      currentHash,
      () => true,
      undefined,
      { durableHistoryAuthority: daily.DURABLE_HISTORY_AUTHORITY },
    )

    if (!observedRangeStart) throw new Error('Expected daily cache re-derivation')
    expect(new Date('2026-08-21T00:00:00.000Z').getTime() - observedRangeStart.getTime())
      .toBe(3650 * 24 * 60 * 60 * 1000)
    const migratedDay = migrated.days.find(day => day.date === '2026-08-01')
    if (!migratedDay) throw new Error('Expected migrated Codex day')
    expect(Object.keys(migratedDay.models)).toEqual(['gpt-5.4'])
    expect(Object.keys(migratedDay.providers.codex?.models ?? {})).toEqual(['gpt-5.4'])
    expect(migratedDay.calls).toBe(stale.calls)
    expect(migratedDay.inputTokens).toBe(stale.inputTokens)
    expect(migratedDay.outputTokens).toBe(stale.outputTokens)
    expect(migratedDay.cacheReadTokens).toBe(stale.cacheReadTokens)
    expect(migratedDay.cost).toBeCloseTo(stale.cost, 12)

    const persisted = JSON.parse(await readFile(daily.dailyCachePath(), 'utf8'))
    expect(persisted.durableHistoryAuthority).toBe(daily.DURABLE_HISTORY_AUTHORITY)
    clearSessionCache()
  })

  it('corrects surviving model distribution, carries sourceless slices, and preserves mixed-day totals', async () => {
    const daily = await import('../src/daily-cache.js')
    const oldHash = configHashForAuthority(priorCodexAuthority())
    const currentHash = getDailyCacheConfigHash()
    const surviving = {
      date: '2026-08-01',
      cost: 4,
      savingsUSD: 0,
      calls: 2,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: { WRONG_MODEL: { calls: 2, cost: 4, savingsUSD: 0, inputTokens: 100, outputTokens: 40, cacheReadTokens: 20, cacheWriteTokens: 0 } },
      categories: {},
      providers: {
        codex: {
          calls: 2,
          cost: 4,
          savingsUSD: 0,
          sessions: 1,
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 20,
          cacheWriteTokens: 0,
          models: { WRONG_MODEL: { calls: 2, cost: 4, savingsUSD: 0, inputTokens: 100, outputTokens: 40, cacheReadTokens: 20, cacheWriteTokens: 0 } },
          categories: {},
        },
      },
    } as DailyEntry
    const sourceless: DailyEntry = {
      ...surviving,
      date: '2026-08-02',
      models: { LOST_MODEL: { ...surviving.models.WRONG_MODEL } },
      providers: {
        codex: {
          ...surviving.providers.codex!,
          models: { LOST_MODEL: { ...surviving.providers.codex!.models!.WRONG_MODEL! } },
        },
      },
    }
    const corrected = staleModelDay({ ...surviving, models: { RIGHT_MODEL: { ...surviving.models.WRONG_MODEL } }, providers: {
      codex: { ...surviving.providers.codex!, models: { RIGHT_MODEL: { ...surviving.providers.codex!.models!.WRONG_MODEL! } } },
    } }, 'RIGHT_MODEL')
    await seedDailyCache(daily, [surviving, sourceless], oldHash)

    const migrated = await daily.ensureCacheHydrated(
      async () => [],
      () => [corrected],
      currentHash,
      () => true,
      undefined,
      { durableHistoryAuthority: daily.DURABLE_HISTORY_AUTHORITY },
    )
    const correctedDay = migrated.days.find(day => day.date === surviving.date)!
    const carriedDay = migrated.days.find(day => day.date === sourceless.date)!

    expect(Object.keys(correctedDay.models)).toEqual(['RIGHT_MODEL'])
    expect(correctedDay.providers.codex?.models).toHaveProperty('RIGHT_MODEL')
    expect(correctedDay.calls).toBe(2)
    expect(correctedDay.inputTokens).toBe(100)
    expect(correctedDay.outputTokens).toBe(40)
    expect(correctedDay.cost).toBe(4)

    expect(carriedDay.carried).toBe(true)
    expect(carriedDay.models).toHaveProperty('LOST_MODEL')
    expect(carriedDay.models).not.toHaveProperty('RIGHT_MODEL')
    expect(carriedDay.calls).toBe(sourceless.calls)
    expect(carriedDay.inputTokens).toBe(sourceless.inputTokens)
    expect(carriedDay.outputTokens).toBe(sourceless.outputTokens)
    expect(carriedDay.cost).toBe(sourceless.cost)

    expect(migrated.days.reduce((sum, day) => sum + day.calls, 0)).toBe(4)
    expect(migrated.days.reduce((sum, day) => sum + day.inputTokens, 0)).toBe(200)
    expect(migrated.days.reduce((sum, day) => sum + day.outputTokens, 0)).toBe(80)
    expect(migrated.days.reduce((sum, day) => sum + day.cost, 0)).toBe(8)
    await expect(daily.loadDailyCache()).resolves.toMatchObject({ durableHistoryAuthority: daily.DURABLE_HISTORY_AUTHORITY })
  })
})
