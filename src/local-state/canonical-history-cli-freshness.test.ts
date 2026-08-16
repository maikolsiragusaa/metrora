import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { currentTzKey, dailyCachePath, saveDailyCache, type DailyCache } from '../daily-cache.js'
import {
  readCurrentDailyCacheGenerationV1,
  readCurrentSessionCacheGenerationV1,
} from '../cache-generation.js'
import { emptyCache, saveCache, sessionCachePath, type SessionCache } from '../session-cache.js'
import type { CanonicalHistoryReadProjectionV1 } from './canonical-history-read-projection.js'
import {
  persistCanonicalHistoryShadowV1,
} from './canonical-history-shadow-store.js'
import { readC3CliStatusBatchV1, type C3CliStatusReadInputV1 } from './canonical-history-cli-dual-read.js'

const roots: string[] = []
const originalCacheDir = process.env['METRORA_CACHE_DIR']
const originalTz = process.env['TZ']

afterEach(async () => {
  if (originalCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = originalCacheDir
  if (originalTz === undefined) delete process.env['TZ']
  else process.env['TZ'] = originalTz
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function dateRange(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return {
    start: new Date(year!, month! - 1, day!),
    end: new Date(year!, month! - 1, day!, 23, 59, 59, 999),
  }
}

function daily(day: string, timeZone: string): DailyCache {
  return {
    version: 19,
    savingsConfigHash: '',
    tzKey: timeZone,
    lastComputedDate: day,
    days: [{
      date: day,
      cost: 1.25,
      savingsUSD: 0,
      calls: 1,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      editTurns: 0,
      oneShotTurns: 0,
      models: {},
      categories: {},
      providers: {},
    }],
    complete: true,
    watermarkTrusted: true,
  }
}

function projection(day: string, timeZone: string): CanonicalHistoryReadProjectionV1 {
  return {
    version: 1,
    authority: {
      observations: 'shadow-session-cache',
      activities: 'shadow-session-cache',
      totals: 'trusted-daily-cache',
      additiveAcrossAuthorities: false,
    },
    observations: [],
    activities: [],
    dailySnapshots: [{
      snapshotId: `history-day-v1:${'a'.repeat(64)}`,
      date: day,
      cost: 1.25,
      savingsUSD: 0,
      calls: 1,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      editTurns: 0,
      oneShotTurns: 0,
      models: {},
      categories: {},
      providers: {},
      bucketTimeZone: timeZone,
      authority: 'trusted-daily-cache',
    }],
  }
}

async function setup(): Promise<{
  dataDir: string
  cache: SessionCache
  day: string
  now: Date
}> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-cli-freshness-'))
  roots.push(root)
  process.env['METRORA_CACHE_DIR'] = join(root, 'cache')
  const now = new Date('2026-08-02T12:00:00.000Z')
  const day = '2026-08-01'
  const cache = emptyCache()
  cache.complete = true
  await saveCache(cache)
  await saveDailyCache(daily(day, currentTzKey() || 'UTC'))
  return { dataDir: join(root, 'data'), cache, day, now }
}

async function publish(
  dataDir: string,
  day: string,
  now: Date,
): Promise<void> {
  const session = await readCurrentSessionCacheGenerationV1(sessionCachePath())
  const dailyGeneration = await readCurrentDailyCacheGenerationV1(dailyCachePath())
  if (!session || !dailyGeneration) throw new Error('test authority generation was not published')
  await persistCanonicalHistoryShadowV1(projection(day, currentTzKey() || 'UTC'), {
    dataDir,
    now: () => now,
    authorityGeneration: { session, daily: dailyGeneration },
  })
}

function queries(day: string): C3CliStatusReadInputV1[] {
  return [
    { id: 'historical', range: dateRange(day), provider: 'all' },
    { id: 'today', range: dateRange('2026-08-02'), provider: 'all' },
  ]
}

describe('C3 CLI headline freshness seal', () => {
  beforeEach(() => {
    process.env['TZ'] = 'UTC'
  })

  it('accepts a current sidecar only when both cache generations are bound', async () => {
    const { dataDir, day, now } = await setup()
    await publish(dataDir, day, now)
    const results = await readC3CliStatusBatchV1(queries(day), { dataDir, now: () => now, timeZone: 'UTC' })
    expect(results.map(result => result.code)).toEqual(['C3_SUPPORTED_MATCH', 'C3_SUPPORTED_MATCH'])
    expect(results[0]!.c3).toMatchObject({ cost: 1.25, calls: 1 })
    expect(results[1]!.c3).toMatchObject({ cost: 0, calls: 0 })
  })

  it('fails closed for a new cache with an old or missing session stamp', async () => {
    const { dataDir, day, now } = await setup()
    await publish(dataDir, day, now)
    const cache = JSON.parse((await readFile(sessionCachePath(), 'utf8'))) as SessionCache
    cache.complete = false
    await writeFile(sessionCachePath(), JSON.stringify(cache))
    const stale = await readC3CliStatusBatchV1(queries(day), { dataDir, now: () => now, timeZone: 'UTC' })
    expect(stale[0]).toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'authority-generation-mismatch' })
    await rm(`${sessionCachePath()}.generation.v1.json`)
    const missing = await readC3CliStatusBatchV1(queries(day), { dataDir, now: () => now, timeZone: 'UTC' })
    expect(missing[0]).toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'missing-authority-generation' })
  })

  it('fails closed for a corrupt daily stamp and timezone authority change', async () => {
    const { dataDir, day, now } = await setup()
    await publish(dataDir, day, now)
    await writeFile(`${dailyCachePath()}.generation.v1.json`, '{broken')
    const corrupt = await readC3CliStatusBatchV1(queries(day), { dataDir, now: () => now, timeZone: 'UTC' })
    expect(corrupt[0]).toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'authority-generation-mismatch' })

    const second = await setup()
    await publish(second.dataDir, second.day, second.now)
    const reprojected = await readC3CliStatusBatchV1(queries(second.day), { dataDir: second.dataDir, now: () => second.now, timeZone: 'Europe/Rome' })
    expect(reprojected[0]).toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'daily-authority-untrusted' })
  })
})
