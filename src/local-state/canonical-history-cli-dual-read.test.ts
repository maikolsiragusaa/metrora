import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { currentTzKey } from '../daily-cache.js'
import type { DateRange } from '../types.js'
import type { CanonicalHistoryReadProjectionV1 } from './canonical-history-read-projection.js'
import {
  CANONICAL_HISTORY_SHADOW_HEAD_KIND,
  CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND,
  CANONICAL_HISTORY_SHADOW_STORE_VERSION,
  canonicalHistoryShadowPathsV1,
  canonicalHistoryShadowProjectionSha256V1,
  persistCanonicalHistoryShadowV1,
} from './canonical-history-shadow-store.js'
import {
  compareC3CliStatusBatchV1,
  compareC3CliStatusV1,
  readC3CliStatusV1,
  type C3CliStatusHeadlineV1,
} from './canonical-history-cli-dual-read.js'

const roots: string[] = []
const LOCAL_TZ = currentTzKey() || 'UTC'
const NOW = new Date('2026-08-02T12:00:00.000Z')

async function temporaryDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'metrora-cli-dual-read-'))
  roots.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function dateRange(start: string, end = start): DateRange {
  const [startYear, startMonth, startDay] = start.split('-').map(Number)
  const [endYear, endMonth, endDay] = end.split('-').map(Number)
  return {
    start: new Date(startYear!, startMonth! - 1, startDay!),
    end: new Date(endYear!, endMonth! - 1, endDay!, 23, 59, 59, 999),
  }
}

function headline(overrides: Partial<C3CliStatusHeadlineV1> = {}): C3CliStatusHeadlineV1 {
  return {
    cost: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  }
}

function projection(overrides: {
  bucketTimeZone?: string | null
  currentCost?: number | null
  currentCollector?: string
  currentTimestamp?: string
  activityTimestamp?: string
  providerComplete?: boolean
  observations?: boolean
  dailySnapshots?: boolean
} = {}): CanonicalHistoryReadProjectionV1 {
  const observationId = `observation-v1:${'a'.repeat(64)}`
  const activityId = `activity-v1:${'b'.repeat(64)}`
  const dayId = `history-day-v1:${'c'.repeat(64)}`
  const providerSlice = {
    calls: 1,
    cost: 1.25,
    savingsUSD: 0,
    sessions: 1,
    ...(overrides.providerComplete === false ? {} : {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 25,
      cacheWriteTokens: 0,
    }),
    models: {},
    categories: {},
  }
  return {
    version: 1,
    authority: {
      observations: 'shadow-session-cache',
      activities: 'shadow-session-cache',
      totals: 'trusted-daily-cache',
      additiveAcrossAuthorities: false,
    },
    observations: overrides.observations === false ? [] : [{
      observationId,
      activityId,
      sourceFingerprintSha256: 'd'.repeat(64),
      collector: overrides.currentCollector ?? 'codex',
      timestamp: overrides.currentTimestamp ?? '2026-08-02T10:00:00.000Z',
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
      costUSD: overrides.currentCost === undefined ? 2.5 : overrides.currentCost,
      costAssignment: {
        version: 1,
        kind: 'metered',
        amountMicrosUsd: 2_500_000,
        source: 'provider',
      },
      isEstimated: false,
      speed: 'standard',
    }],
    activities: overrides.observations === false ? [] : [{
      activityId,
      collector: overrides.currentCollector ?? 'codex',
      timestamp: overrides.activityTimestamp ?? '2026-08-02T10:00:00.000Z',
      observationIds: [observationId],
    }],
    dailySnapshots: overrides.dailySnapshots === false ? [] : [{
      snapshotId: dayId,
      date: '2026-08-01',
      cost: 1.25,
      savingsUSD: 0,
      calls: 1,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 25,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: {},
      categories: {},
      providers: { codex: providerSlice },
      bucketTimeZone: overrides.bucketTimeZone ?? LOCAL_TZ,
      authority: 'trusted-daily-cache',
    }],
  }
}

async function publish(
  dataDir: string,
  value = projection(),
  updatedAt = NOW,
): Promise<void> {
  await persistCanonicalHistoryShadowV1(value, { dataDir, now: () => updatedAt })
}

function expectedCurrent(): C3CliStatusHeadlineV1 {
  return headline({ cost: 2.5, calls: 1, inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1 })
}

function expectedHistorical(): C3CliStatusHeadlineV1 {
  return headline({ cost: 1.25, calls: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 25, cacheWriteTokens: 0 })
}

describe('C3 CLI status dual-read boundary', () => {
  it('matches a retained historical day and the current observation without additive double counting', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)

    const results = await compareC3CliStatusBatchV1([
      { id: 'historical', range: dateRange('2026-08-01'), provider: 'all', legacy: expectedHistorical() },
      { id: 'current', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent() },
      { id: 'combined', range: dateRange('2026-08-01', '2026-08-02'), provider: 'all', legacy: headline({
        cost: 3.75, calls: 2, inputTokens: 110, outputTokens: 40, cacheReadTokens: 30, cacheWriteTokens: 1,
      }) },
    ], { dataDir, now: () => NOW, timeZone: LOCAL_TZ })

    expect(results.map(result => result.code)).toEqual([
      'C3_SUPPORTED_MATCH',
      'C3_SUPPORTED_MATCH',
      'C3_SUPPORTED_MATCH',
    ])
  })

  it('returns a semantic mismatch without changing the legacy result', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)

    const result = await compareC3CliStatusV1({
      id: 'current',
      range: dateRange('2026-08-02'),
      provider: 'all',
      legacy: headline({ ...expectedCurrent(), calls: 2 }),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ })

    expect(result.code).toBe('C3_SUPPORTED_MISMATCH')
    expect(result.mismatches?.calls).toEqual({ legacy: 2, c3: 1 })
  })

  it('buckets current observations by activity timestamp at a day boundary', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir, projection({
      currentTimestamp: '2026-08-02T00:01:00.000Z',
      activityTimestamp: '2026-08-01T23:59:00.000Z',
    }))

    await expect(compareC3CliStatusV1({
      id: 'boundary', range: dateRange('2026-08-02'), provider: 'all', legacy: headline(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_SUPPORTED_MATCH', c3: headline() })
  })

  it('supports provider slices only when their detailed fields are complete', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)
    const match = await compareC3CliStatusV1({
      id: 'codex', range: dateRange('2026-08-01'), provider: 'codex', legacy: expectedHistorical(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ })
    expect(match.code).toBe('C3_SUPPORTED_MATCH')

    const incompleteDir = await temporaryDataDir()
    await publish(incompleteDir, projection({ providerComplete: false }))
    const incomplete = await compareC3CliStatusV1({
      id: 'codex', range: dateRange('2026-08-01'), provider: 'codex', legacy: expectedHistorical(),
    }, { dataDir: incompleteDir, now: () => NOW, timeZone: LOCAL_TZ })
    expect(incomplete).toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'incomplete-provider-slice' })
  })

  it('rejects project filters and timezone reprojection as unsupported queries', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)
    const project = await compareC3CliStatusV1({
      id: 'project', range: dateRange('2026-08-01'), provider: 'all', project: ['work'], legacy: expectedHistorical(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ })
    expect(project).toMatchObject({ code: 'C3_UNSUPPORTED_QUERY', reason: 'project-filter' })

    const timezone = await compareC3CliStatusV1({
      id: 'timezone', range: dateRange('2026-08-01'), provider: 'all', legacy: expectedHistorical(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ === 'UTC' ? 'Europe/Rome' : 'UTC' })
    expect(timezone).toMatchObject({ code: 'C3_UNSUPPORTED_QUERY', reason: 'timezone-reprojection' })

    const provider = await compareC3CliStatusV1({
      id: 'provider', range: dateRange('2026-08-01'), provider: 'claude', legacy: headline(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ })
    expect(provider).toMatchObject({ code: 'C3_UNSUPPORTED_QUERY', reason: 'provider-mismatch' })
  })

  it('fails safe for missing, stale, malformed, and integrity-invalid shadow state', async () => {
    const missingDir = await temporaryDataDir()
    const input = { id: 'current', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent() }
    await expect(compareC3CliStatusV1(input, { dataDir: missingDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'missing-shadow' })

    const staleDir = await temporaryDataDir()
    await publish(staleDir, projection(), new Date('2026-08-02T00:00:00.000Z'))
    await expect(compareC3CliStatusV1(input, { dataDir: staleDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'stale-head' })

    const malformedDir = await temporaryDataDir()
    await publish(malformedDir)
    const malformedPaths = canonicalHistoryShadowPathsV1(malformedDir)
    await writeFile(malformedPaths.head, '{"kind":"wrong"}')
    await expect(compareC3CliStatusV1(input, { dataDir: malformedDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })

    const corruptDir = await temporaryDataDir()
    await publish(corruptDir)
    const corruptPaths = canonicalHistoryShadowPathsV1(corruptDir)
    const head = JSON.parse(await readFile(corruptPaths.head, 'utf8')) as { projectionSha256: string }
    await writeFile(join(corruptPaths.snapshots, `${head.projectionSha256}.json`), '{"broken":true}')
    await expect(readC3CliStatusV1({ id: input.id, range: input.range, provider: input.provider }, { dataDir: corruptDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })

    const unsupportedDir = await temporaryDataDir()
    await publish(unsupportedDir)
    const unsupportedPaths = canonicalHistoryShadowPathsV1(unsupportedDir)
    const unsupportedProjection = structuredClone(projection()) as unknown as { version: number }
    unsupportedProjection.version = 99
    const unsupportedDigest = canonicalHistoryShadowProjectionSha256V1(unsupportedProjection)
    await writeFile(join(unsupportedPaths.snapshots, `${unsupportedDigest}.json`), JSON.stringify({
      kind: CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND,
      version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
      projectionSha256: unsupportedDigest,
      createdAt: NOW.toISOString(),
      projection: unsupportedProjection,
    }))
    await writeFile(unsupportedPaths.head, JSON.stringify({
      kind: CANONICAL_HISTORY_SHADOW_HEAD_KIND,
      version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
      projectionSha256: unsupportedDigest,
      updatedAt: NOW.toISOString(),
    }))
    await expect(compareC3CliStatusV1(input, { dataDir: unsupportedDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })
  })

  it('falls back when current cost is unavailable or the requested history is not retained', async () => {
    const unpricedDir = await temporaryDataDir()
    await publish(unpricedDir, projection({ currentCost: null }))
    await expect(compareC3CliStatusV1({
      id: 'unpriced', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir: unpricedDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'unpriced-current-observation' })

    const emptyDir = await temporaryDataDir()
    await publish(emptyDir, projection({ observations: false, dailySnapshots: false }))
    await expect(compareC3CliStatusV1({
      id: 'retained', range: dateRange('2026-07-01'), provider: 'all', legacy: headline(),
    }, { dataDir: emptyDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNSUPPORTED_QUERY', reason: 'history-out-of-range' })
  })

  it('fails closed when the derived headline index or pointed snapshot is unavailable', async () => {
    const missingIndexDir = await temporaryDataDir()
    await publish(missingIndexDir)
    const missingIndexPaths = canonicalHistoryShadowPathsV1(missingIndexDir)
    const missingIndexHead = JSON.parse(await readFile(missingIndexPaths.head, 'utf8')) as { projectionSha256: string }
    await rm(join(missingIndexPaths.headlineIndexes, `${missingIndexHead.projectionSha256}.json`))
    await expect(compareC3CliStatusV1({
      id: 'missing-index', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir: missingIndexDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })

    const corruptIndexDir = await temporaryDataDir()
    await publish(corruptIndexDir)
    const corruptIndexPaths = canonicalHistoryShadowPathsV1(corruptIndexDir)
    const corruptIndexHead = JSON.parse(await readFile(corruptIndexPaths.head, 'utf8')) as { projectionSha256: string }
    await writeFile(join(corruptIndexPaths.headlineIndexes, `${corruptIndexHead.projectionSha256}.json`), '{"broken":true}')
    await expect(compareC3CliStatusV1({
      id: 'corrupt-index', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir: corruptIndexDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })

    const missingSnapshotDir = await temporaryDataDir()
    await publish(missingSnapshotDir)
    const missingSnapshotPaths = canonicalHistoryShadowPathsV1(missingSnapshotDir)
    const missingSnapshotHead = JSON.parse(await readFile(missingSnapshotPaths.head, 'utf8')) as { projectionSha256: string }
    await rm(join(missingSnapshotPaths.snapshots, `${missingSnapshotHead.projectionSha256}.json`))
    await expect(compareC3CliStatusV1({
      id: 'missing-snapshot', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir: missingSnapshotDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })
  })

  it('keeps terminal parity reads bounded while the full reader still catches snapshot corruption', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const head = JSON.parse(await readFile(paths.head, 'utf8')) as { projectionSha256: string }
    await writeFile(join(paths.snapshots, `${head.projectionSha256}.json`), '{"broken":true}')

    await expect(compareC3CliStatusV1({
      id: 'fast', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_SUPPORTED_MATCH' })
    await expect(readC3CliStatusV1({
      id: 'deep', range: dateRange('2026-08-02'), provider: 'all',
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })
  })

  it('fails fast when the compact index seal no longer matches the head', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const head = JSON.parse(await readFile(paths.head, 'utf8')) as Record<string, unknown>
    await writeFile(paths.head, JSON.stringify({ ...head, snapshotSha256: 'e'.repeat(64) }))

    await expect(compareC3CliStatusV1({
      id: 'seal', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })
  })

  it('fails closed when the compact index names a different projection', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const head = JSON.parse(await readFile(paths.head, 'utf8')) as { projectionSha256: string }
    const indexPath = join(paths.headlineIndexes, `${head.projectionSha256}.json`)
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as Record<string, unknown>
    await writeFile(indexPath, JSON.stringify({ ...index, projectionSha256: 'f'.repeat(64) }))

    await expect(compareC3CliStatusV1({
      id: 'projection-mismatch', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_UNAVAILABLE', reason: 'invalid-shadow' })
  })

  it('keeps a previously published head readable when only the index carries the snapshot seal', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const { snapshotSha256: _snapshotSha256, ...legacyHead } = JSON.parse(await readFile(paths.head, 'utf8')) as Record<string, unknown>
    await writeFile(paths.head, JSON.stringify(legacyHead))

    await expect(compareC3CliStatusV1({
      id: 'legacy-head', range: dateRange('2026-08-02'), provider: 'all', legacy: expectedCurrent(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_SUPPORTED_MATCH' })
  })

  it('keeps a valid old head readable when an unreferenced newer snapshot is corrupt', async () => {
    const dataDir = await temporaryDataDir()
    await publish(dataDir)
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    await writeFile(join(paths.snapshots, `${'e'.repeat(64)}.json`), '{"broken":true}')

    await expect(compareC3CliStatusV1({
      id: 'old-head', range: dateRange('2026-08-01'), provider: 'all', legacy: expectedHistorical(),
    }, { dataDir, now: () => NOW, timeZone: LOCAL_TZ }))
      .resolves.toMatchObject({ code: 'C3_SUPPORTED_MATCH' })
  })

  it('does not read the shadow when every query shape is unsupported', async () => {
    const dataDir = await temporaryDataDir()
    const result = await compareC3CliStatusBatchV1([
      { id: 'project', range: dateRange('2026-08-01'), provider: 'all', project: ['work'], legacy: expectedHistorical() },
      { id: 'exclude', range: dateRange('2026-08-01'), provider: 'all', exclude: ['work'], legacy: expectedHistorical() },
    ], { dataDir, now: () => NOW, timeZone: LOCAL_TZ })
    expect(result).toEqual([
      { id: 'project', code: 'C3_UNSUPPORTED_QUERY', reason: 'project-filter' },
      { id: 'exclude', code: 'C3_UNSUPPORTED_QUERY', reason: 'project-filter' },
    ])
  })
})
