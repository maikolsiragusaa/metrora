import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { currentTzKey, emptyCache as emptyDailyCache, saveDailyCache, type DailyCache } from '../daily-cache.js'
import { readCurrentDailyCacheGenerationV1, readCurrentSessionCacheGenerationV1 } from '../cache-generation.js'
import { isSnapshotReadMode } from '../read-lifecycle.js'
import { CACHE_VERSION, emptyCache as emptySessionCache, saveCache, sessionCachePath, type CachedCall, type SessionCache } from '../session-cache.js'
import { readC3CliStatusBatchV1 } from './canonical-history-cli-dual-read.js'
import {
  canonicalSourceRecordFingerprintSha256V1,
} from './canonical-history-identity.js'
import { publishCanonicalHistoryAnalyticsV1 } from './canonical-history-analytics-publication.js'
import { canonicalHistoryShadowPathsV1 } from './canonical-history-shadow-store.js'
import { loadOrCreateLocalEndpointIdentityV1 } from './endpoint-identity.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

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

async function setup(): Promise<{ dataDir: string; session: SessionCache; daily: DailyCache; endpointId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-analytics-publication-'))
  roots.push(root)
  process.env['METRORA_CACHE_DIR'] = join(root, 'cache')
  const session = sessionCache()
  const daily = dailyCache()
  await saveCache(session)
  await saveDailyCache(daily)
  const dataDir = join(root, 'data')
  const identity = await loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 23)),
    randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  })
  return { dataDir, session, daily, endpointId: identity.metadata.endpointId }
}

describe('generic canonical analytics publication boundary', () => {
  it('publishes from the exact completed cache objects and makes the bound headline readable', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
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
      endpointId,
      provider: 'codex',
      privateDeduplicationKey: 'codex:test:1',
    })).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('keeps an existing endpoint-scoped shadow on the same scope while the generation advances', async () => {
    const { dataDir, session, daily } = await setup()
    const first = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, now: () => NOW })
    expect(first.status).toBe('published')

    const advancedSession = structuredClone(session)
    advancedSession.providers.codex!.files['C:\\private\\codex-session.jsonl']!.turns[0]!.calls.push(call({
      deduplicationKey: 'codex:test:2',
      timestamp: '2026-08-13T10:01:00.000Z',
    }))
    await saveCache(advancedSession)
    const advanced = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: advancedSession,
      dailyCache: daily,
      dataDir,
      now: () => NOW,
    })

    expect(advanced.status).toBe('published')
    expect(advanced.shadowStatus).toBe('advanced')
    expect(advanced.parity?.outcome).toBe('matched')
  })

  it('accepts a completed-generation headline after provider cache bytes advance, while standalone reads remain current-cache bound', async () => {
    const { dataDir, session, daily } = await setup()
    const published = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, now: () => NOW })
    expect(published.generation?.id).toMatch(/^[a-f0-9]{64}$/u)

    await writeFile(sessionCachePath(), JSON.stringify({
      ...session,
      providers: {
        ...session.providers,
        codex: { ...session.providers.codex!, envFingerprint: 'provider-wrote-after-publication' },
      },
    }), 'utf8')

    const query = [{
      id: 'today',
      range: { start: NOW, end: new Date('2026-08-13T23:59:59.999Z') },
      provider: 'all',
    }] as const
    await expect(readC3CliStatusBatchV1(query, {
      dataDir,
      now: () => NOW,
      timeZone: 'UTC',
      expectedGenerationId: published.generation?.id,
    })).resolves.toMatchObject([{ code: 'C3_SUPPORTED_MATCH' }])
    await expect(readC3CliStatusBatchV1(query, {
      dataDir,
      now: () => NOW,
      timeZone: 'UTC',
    })).resolves.toMatchObject([{ code: 'C3_UNAVAILABLE', reason: 'authority-generation-mismatch' }])
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
