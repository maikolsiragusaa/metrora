import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { currentTzKey, dailyCachePath, DAILY_CACHE_VERSION, emptyCache as emptyDailyCache, loadDailyCache, saveDailyCache, type DailyCache } from '../daily-cache.js'
import { readCurrentDailyCacheGenerationV1, readCurrentSessionCacheGenerationV1 } from '../cache-generation.js'
import { isSnapshotReadMode } from '../read-lifecycle.js'
import { CACHE_VERSION, emptyCache as emptySessionCache, loadCache, saveCache, sessionCachePath, type CachedCall, type SessionCache } from '../session-cache.js'
import { readC3CliStatusBatchV1 } from './canonical-history-cli-dual-read.js'
import {
  canonicalSourceRecordFingerprintSha256V1,
} from './canonical-history-identity.js'
import { publishCanonicalHistoryAnalyticsV1 } from './canonical-history-analytics-publication.js'
import {
  canonicalHistoryShadowPathsV1,
  canonicalHistoryShadowProjectionSha256V1,
  clearCanonicalHistoryShadowTrustMemoV1,
  readCanonicalHistoryShadowProjectionV1,
} from './canonical-history-shadow-store.js'
import { projectCanonicalHistoryReadV1 } from './canonical-history-read-projection.js'
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
  cache.version = DAILY_CACHE_VERSION
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

async function setupWithoutEndpointIdentity(): Promise<{ dataDir: string; session: SessionCache; daily: DailyCache }> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-analytics-unbound-'))
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
    const dailyGeneration = await readCurrentDailyCacheGenerationV1(dailyCachePath())
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

  it('seals the exact persisted objects even when normal daily hydration reordered fields', async () => {
    const { dataDir, endpointId } = await setup()
    const persistedSession = JSON.parse(await readFile(sessionCachePath(), 'utf8')) as SessionCache
    const persistedDaily = JSON.parse(await readFile(dailyCachePath(), 'utf8')) as DailyCache

    await expect(publishCanonicalHistoryAnalyticsV1({
      sessionCache: persistedSession,
      dailyCache: persistedDaily,
      dataDir,
      endpointId,
      now: () => NOW,
    })).resolves.toMatchObject({ status: 'published', parity: { outcome: 'matched' } })
  })

  it('seals the exact completed objects returned by the normal refresh loaders', async () => {
    const { dataDir, endpointId } = await setup()
    const loadedSession = await loadCache()
    const loadedDaily = await loadDailyCache()

    await expect(publishCanonicalHistoryAnalyticsV1({
      sessionCache: loadedSession,
      dailyCache: loadedDaily,
      dataDir,
      endpointId,
      now: () => NOW,
    })).resolves.toMatchObject({ status: 'published', parity: { outcome: 'matched' } })
  })

  it('fails closed without a canonical endpoint identity and does not invent one', async () => {
    const { dataDir, session, daily } = await setupWithoutEndpointIdentity()
    const result = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, now: () => NOW })

    expect(result).toMatchObject({ status: 'failed', reason: 'endpoint-identity-unavailable' })
    expect(await readFile(join(dataDir, 'identity', 'endpoint-identity.v1.json')).catch(() => undefined)).toBeUndefined()
    expect(await readFile(join(canonicalHistoryShadowPathsV1(dataDir).root, 'head.json')).catch(() => undefined)).toBeUndefined()
  })

  it('accepts a trusted host-supplied endpoint scope without Workspace or key-material access', async () => {
    const { dataDir, session, daily } = await setupWithoutEndpointIdentity()
    const endpointId = 'host-supplied-endpoint-111111111111111111111111'
    const result = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })

    expect(result).toMatchObject({ status: 'published', parity: { outcome: 'matched' } })
    expect(await readFile(join(dataDir, 'identity', 'endpoint-identity.v1.json')).catch(() => undefined)).toBeUndefined()
  })

  it('skips an exactly unchanged analytics generation without rebuilding the projection', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
    const first = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })
    const before = await readFile(join(canonicalHistoryShadowPathsV1(dataDir).root, 'head.json'))

    const second = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })

    expect(first.status).toBe('published')
    expect(second).toMatchObject({
      status: 'skipped',
      reason: 'unchanged-generation',
      projectionSha256: first.projectionSha256,
      shadowStatus: 'unchanged',
    })
    expect(second.timingsMs.projectionBuildMs).toBe(0)
    expect(second.timingsMs.parityMs).toBe(0)
    expect(second.timingsMs.shadowPersistenceMs).toBe(0)
    expect(await readFile(join(canonicalHistoryShadowPathsV1(dataDir).root, 'head.json'))).toEqual(before)
  })

  it('fails closed when a supplied endpoint scope conflicts with the established C3 scope', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
    const first = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })
    expect(first.status).toBe('published')

    const conflicting = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: session,
      dailyCache: daily,
      dataDir,
      endpointId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      now: () => NOW,
    })
    expect(conflicting).toMatchObject({ status: 'failed', reason: 'endpoint-scope-mismatch' })
  })

  it('does not trust a same-stat mutated snapshot after a cold trust lifecycle', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
    const first = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })
    expect(first.status).toBe('published')
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const beforeHead = await readFile(paths.head)
    const snapshotPath = join(paths.snapshots, `${first.projectionSha256}.json`)
    const beforeBytes = await readFile(snapshotPath)
    const beforeStat = await stat(snapshotPath)
    const marker = Buffer.from('2026-08-13T12:00:00.000Z', 'utf8')
    const replacement = Buffer.from('2026-08-13T13:00:00.000Z', 'utf8')
    const offset = beforeBytes.indexOf(marker)
    expect(offset).toBeGreaterThanOrEqual(0)
    const mutated = Buffer.from(beforeBytes)
    replacement.copy(mutated, offset)
    await writeFile(snapshotPath, mutated)
    await utimes(snapshotPath, beforeStat.atime, beforeStat.mtime)
    const afterStat = await stat(snapshotPath)
    expect(afterStat.size).toBe(beforeStat.size)
    expect(afterStat.mtimeMs).toBeCloseTo(beforeStat.mtimeMs, 0)
    if (beforeStat.ino !== 0 && afterStat.ino !== 0) expect(afterStat.ino).toBe(beforeStat.ino)

    // A fresh publisher process has no prior content-validation memo.
    clearCanonicalHistoryShadowTrustMemoV1(dataDir)
    const restarted = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })

    expect(restarted.status).toBe('failed')
    expect(restarted.reason).not.toBe('unchanged-generation')
    expect(await readFile(paths.head)).toEqual(beforeHead)
  })

  it('keeps an existing endpoint-scoped shadow on the same scope while the generation advances', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
    const first = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })
    expect(first.status).toBe('published')

    const advancedSession = structuredClone(session)
    const advancedFile = advancedSession.providers.codex!.files['C:\\private\\codex-session.jsonl']!
    advancedFile.turns[0]!.calls.push(call({
      deduplicationKey: 'codex:test:2',
      timestamp: '2026-08-13T10:01:00.000Z',
    }))
    advancedFile.fingerprint.sizeBytes += 1
    advancedFile.fingerprint.mtimeMs += 1
    await saveCache(advancedSession)
    const advanced = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: advancedSession,
      dailyCache: daily,
      dataDir,
      endpointId,
      now: () => NOW,
    })

    expect(advanced.status).toBe('published')
    expect(advanced.shadowStatus).toBe('advanced')
    expect(advanced.parity?.outcome).toBe('matched')
    const projected = projectCanonicalHistoryReadV1({ endpointId, sessionCache: advancedSession, dailyCache: daily })
    expect(advanced.projectionSha256).toBe(canonicalHistoryShadowProjectionSha256V1(projected))
    expect((await readCanonicalHistoryShadowProjectionV1({ dataDir }))?.head.projectionSha256).toBe(advanced.projectionSha256)
  })

  it('rebuilds safely when the derived incremental state is corrupt', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
    const first = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })
    expect(first.status).toBe('published')
    await writeFile(join(canonicalHistoryShadowPathsV1(dataDir).root, 'publication-state.v1.json'), '{broken')

    const advancedSession = structuredClone(session)
    const advancedFile = advancedSession.providers.codex!.files['C:\\private\\codex-session.jsonl']!
    advancedFile.turns[0]!.calls.push(call({ deduplicationKey: 'codex:test:recovery' }))
    advancedFile.fingerprint.sizeBytes += 1
    advancedFile.fingerprint.mtimeMs += 1
    await saveCache(advancedSession)

    const recovered = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: advancedSession,
      dailyCache: daily,
      dataDir,
      endpointId,
      now: () => NOW,
    })
    expect(recovered).toMatchObject({ status: 'published', shadowStatus: 'advanced', parity: { outcome: 'matched' } })
  })

  it('preserves retained-only history when a source disappears from the next generation', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
    const first = await publishCanonicalHistoryAnalyticsV1({ sessionCache: session, dailyCache: daily, dataDir, endpointId, now: () => NOW })
    const deletedSession = structuredClone(session)
    delete deletedSession.providers.codex!.files['C:\\private\\codex-session.jsonl']
    await saveCache(deletedSession)

    const deleted = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: deletedSession,
      dailyCache: daily,
      dataDir,
      endpointId,
      now: () => NOW,
    })
    expect(deleted).toMatchObject({ status: 'published', shadowStatus: 'advanced', parity: { outcome: 'matched' } })
    expect(deleted.parity?.reconciliation.observations.retainedOnly).toBe(1)
    expect(deleted.parity?.reconciliation.activities.retainedOnly).toBe(1)
    expect(deleted.projectionSha256).toBe(canonicalHistoryShadowProjectionSha256V1(projectCanonicalHistoryReadV1({ endpointId, sessionCache: deletedSession, dailyCache: daily })))
    expect(first.projectionSha256).not.toBe(deleted.projectionSha256)
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

  it('rejects a stale in-memory object against a newer cache generation sidecar', async () => {
    const { dataDir, session, daily, endpointId } = await setup()
    const stale = structuredClone(session)
    const newer = structuredClone(session)
    const file = newer.providers.codex!.files['C:\\private\\codex-session.jsonl']!
    file.turns[0]!.calls.push(call({ deduplicationKey: 'codex:test:newer-generation' }))
    file.fingerprint.sizeBytes += 1
    await saveCache(newer)

    const result = await publishCanonicalHistoryAnalyticsV1({
      sessionCache: stale,
      dailyCache: daily,
      dataDir,
      endpointId,
      now: () => NOW,
    })
    expect(result).toMatchObject({ status: 'failed', reason: 'generation-seal-failed' })
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
