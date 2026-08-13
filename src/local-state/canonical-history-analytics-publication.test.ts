import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { currentTzKey, emptyCache as emptyDailyCache, saveDailyCache, type DailyCache } from '../daily-cache.js'
import { readCurrentDailyCacheGenerationV1, readCurrentSessionCacheGenerationV1 } from '../cache-generation.js'
import { isSnapshotReadMode } from '../read-lifecycle.js'
import { CACHE_VERSION, emptyCache as emptySessionCache, saveCache, sessionCachePath, type CachedCall, type SessionCache } from '../session-cache.js'
import { readC3CliStatusBatchV1 } from './canonical-history-cli-dual-read.js'
import {
  CANONICAL_ANALYTICS_HISTORY_SCOPE_ID_V1,
  canonicalSourceRecordFingerprintSha256V1,
} from './canonical-history-identity.js'
import { publishCanonicalHistoryAnalyticsV1 } from './canonical-history-analytics-publication.js'
import { canonicalHistoryShadowPathsV1 } from './canonical-history-shadow-store.js'

const roots: string[] = []
const NOW = new Date('2026-08-13T12:00:00.000Z')

afterEach(async () => {
  delete process.env['METRORA_READ_MODE']
  delete process.env['METRORA_CACHE_DIR']
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function call(overrides: Partial<CachedCall> = {}): CachedCall {
  return {
    provider: 'codex',
    model: 'gpt-test',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationInputTokens: 1,
      cacheReadInputTokens: 5,
      cachedInputTokens: 5,
      reasoningTokens: 0,
      webSearchRequests: 0,
      cacheCreationOneHourTokens: 0,
    },
    costUSD: 2.5,
    costAssignment: {
      version: 1,
      kind: 'metered',
      amountMicrosUsd: 2_500_000,
      source: 'provider',
    },
    speed: 'standard',
    timestamp: '2026-08-13T10:00:00.000Z',
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'codex:test:1',
    ...overrides,
  }
}

function sessionCache(calls: CachedCall[] = [call()]): SessionCache {
  return {
    version: CACHE_VERSION,
    complete: true,
    providers: {
      codex: {
        envFingerprint: 'test',
        files: {
          'C:\\private\\codex-session.jsonl': {
            fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
            mcpInventory: [],
            turns: [{
              timestamp: '2026-08-13T10:00:00.000Z',
              sessionId: 'session-1',
              userMessage: 'private',
              calls,
            }],
          },
        },
      },
    },
  }
}

function dailyCache(): DailyCache {
  const cache = emptyDailyCache('test')
  cache.version = 18
  cache.complete = true
  cache.lastComputedDate = '2026-08-12'
  cache.tzKey = 'UTC'
  cache.watermarkTrusted = true
  return cache
}

async function setup(): Promise<{ dataDir: string; session: SessionCache; daily: DailyCache }> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-analytics-publication-'))
  roots.push(root)
  process.env['METRORA_CACHE_DIR'] = join(root, 'cache')
  const session = sessionCache()
  const daily = dailyCache()
  await saveCache(session)
  await saveDailyCache(daily)
  return { dataDir: join(root, 'data'), session, daily }
}

describe('generic canonical analytics publication boundary', () => {
  it('publishes from the exact completed cache objects and makes the bound headline readable', async () => {
    const { dataDir, session, daily } = await setup()
    const result = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: session,
      dailyCache: daily,
      dataDir,
      now: () => NOW,
    })

    expect(result.status).toBe('published')
    expect(result.generation?.id).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.parity?.outcome).toBe('matched')
    expect(result.timingsMs.generationSealMs).toBeGreaterThanOrEqual(0)
    expect(result.timingsMs.projectionBuildMs).toBeGreaterThanOrEqual(0)
    expect(result.timingsMs.shadowPersistenceMs).toBeGreaterThanOrEqual(0)
    expect(result.timingsMs.headlineIndexPersistenceMs).toBeGreaterThanOrEqual(0)

    const sessionGeneration = await readCurrentSessionCacheGenerationV1(sessionCachePath())
    const dailyGeneration = await readCurrentDailyCacheGenerationV1(join(process.env['METRORA_CACHE_DIR']!, 'daily-cache.v18.json'))
    expect(result.generation?.sessionPayloadSha256).toBe(sessionGeneration?.payloadSha256)
    expect(result.generation?.dailyPayloadSha256).toBe(dailyGeneration?.payloadSha256)

    const read = await readC3CliStatusBatchV1([
      {
        id: 'today',
        range: { start: NOW, end: new Date('2026-08-13T23:59:59.999Z') },
        provider: 'all',
      },
    ], {
      dataDir,
      now: () => NOW,
      timeZone: 'UTC',
      expectedGenerationId: result.generation?.id,
    })
    expect(read[0]).toMatchObject({
      code: 'C3_SUPPORTED_MATCH',
      c3: { cost: 2.5, calls: 1, inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1 },
    })
    expect(canonicalSourceRecordFingerprintSha256V1({
      endpointId: CANONICAL_ANALYTICS_HISTORY_SCOPE_ID_V1,
      provider: 'codex',
      privateDeduplicationKey: 'codex:test:1',
    })).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('does not publish in snapshot mode', async () => {
    const { dataDir, session, daily } = await setup()
    process.env['METRORA_READ_MODE'] = 'snapshot'
    const result = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: session,
      dailyCache: daily,
      dataDir,
      now: () => NOW,
    })
    expect(isSnapshotReadMode()).toBe(true)
    expect(result).toMatchObject({ status: 'skipped', reason: 'snapshot-read' })
    expect(result.projectionSha256).toBeUndefined()
    expect(await readFile(join(canonicalHistoryShadowPathsV1(dataDir).root, 'head.json')).catch(() => null)).toBeNull()
  })

  it('fails closed when the lifecycle stamps do not bind the provided objects', async () => {
    const { dataDir, session, daily } = await setup()
    session.complete = false
    const result = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: session,
      dailyCache: daily,
      dataDir,
      now: () => NOW,
    })
    expect(result).toMatchObject({ status: 'failed', reason: 'incomplete-session-authority' })
    expect(await readFile(join(canonicalHistoryShadowPathsV1(dataDir).root, 'head.json')).catch(() => null)).toBeNull()
  })
})
