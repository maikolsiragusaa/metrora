import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { CanonicalHistoryReadProjectionV1 } from './canonical-history-read-projection.js'
import {
  CANONICAL_HISTORY_SHADOW_HEAD_KIND,
  CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND,
  CANONICAL_HISTORY_SHADOW_STORE_VERSION,
  CanonicalHistoryShadowStoreIntegrityError,
  canonicalHistoryShadowPathsV1,
  canonicalHistoryShadowProjectionSha256V1,
  persistCanonicalHistoryShadowV1,
  readCanonicalHistoryShadowHeadV1,
} from './canonical-history-shadow-store.js'

const roots: string[] = []

async function temporaryDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'metrora-history-shadow-'))
  roots.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function hex(character: string): string {
  return character.repeat(64)
}

function projection(character = 'a'): CanonicalHistoryReadProjectionV1 {
  const observationId = `observation-v1:${hex(character)}`
  const activityId = `activity-v1:${hex(character === 'f' ? 'e' : String.fromCharCode(character.charCodeAt(0) + 1))}`
  const snapshotId = `history-day-v1:${hex(character === 'f' ? 'd' : String.fromCharCode(character.charCodeAt(0) + 2))}`
  return {
    version: 1,
    authority: {
      observations: 'shadow-session-cache',
      activities: 'shadow-session-cache',
      totals: 'trusted-daily-cache',
      additiveAcrossAuthorities: false,
    },
    observations: [{
      observationId,
      activityId,
      sourceFingerprintSha256: hex(character),
      collector: 'zed',
      timestamp: '2026-08-01T21:00:01.000Z',
      model: `model-${character}`,
      modelProvider: 'zed.dev',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 25,
        cachedInputTokens: 25,
        reasoningTokens: 5,
        webSearchRequests: 0,
        cacheCreationOneHourTokens: 0,
      },
      costUSD: 1.25,
      costAssignment: {
        version: 1,
        kind: 'metered',
        amountMicrosUsd: 1_250_000,
        source: 'provider',
      },
      isEstimated: false,
      speed: 'standard',
    }],
    activities: [{
      activityId,
      collector: 'zed',
      timestamp: '2026-08-01T21:00:00.000Z',
      observationIds: [observationId],
    }],
    dailySnapshots: [{
      snapshotId,
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
      oneShotTurns: 1,
      models: {},
      categories: {},
      providers: {},
      bucketTimeZone: 'Europe/Rome',
      authority: 'trusted-daily-cache',
    }],
  }
}

function liveTurnProjection(observationCharacters: string[]): CanonicalHistoryReadProjectionV1 {
  const value = projection('a')
  const activityId = `activity-v1:${hex('z')}`
  const observationIds = observationCharacters.map(character => `observation-v1:${hex(character)}`)
  value.observations = observationCharacters.map((character, index) => ({
    ...structuredClone(value.observations[0]!),
    observationId: `observation-v1:${hex(character)}`,
    activityId,
    sourceFingerprintSha256: hex(character),
    model: `live-model-${index}`,
  }))
  value.activities = [{
    activityId,
    collector: 'codex',
    timestamp: '2026-08-01T21:00:00.000Z',
    observationIds,
  }]
  return value
}

describe('canonical history shadow store v1', () => {
  it('publishes one immutable content-addressed snapshot and remains idempotent', async () => {
    const dataDir = await temporaryDataDir()
    const value = projection()
    const first = await persistCanonicalHistoryShadowV1(value, {
      dataDir,
      now: () => new Date('2026-08-05T20:00:00.000Z'),
    })
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const firstHead = await readFile(paths.head, 'utf-8')

    expect(first.status).toBe('initialized')
    expect(first.reconciliation.observations).toEqual({ added: 1, unchanged: 0, retainedOnly: 0 })
    expect(await readdir(paths.snapshots)).toEqual([`${first.projectionSha256}.json`])

    const second = await persistCanonicalHistoryShadowV1(value, {
      dataDir,
      now: () => new Date('2026-08-05T21:00:00.000Z'),
    })

    expect(second.status).toBe('unchanged')
    expect(second.projectionSha256).toBe(first.projectionSha256)
    expect(second.reconciliation.observations).toEqual({ added: 0, unchanged: 1, retainedOnly: 0 })
    expect(await readFile(paths.head, 'utf-8')).toBe(firstHead)
    expect(await readdir(paths.snapshots)).toEqual([`${first.projectionSha256}.json`])
  })

  it('reconstructs the retained seal when the derived index is corrupt', async () => {
    const dataDir = await temporaryDataDir()
    const value = projection()
    const first = await persistCanonicalHistoryShadowV1(value, { dataDir })
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    await writeFile(join(paths.root, 'retained-index.v1.json'), '{broken')

    const second = await persistCanonicalHistoryShadowV1(value, { dataDir })

    expect(second.status).toBe('unchanged')
    expect((await readFile(join(paths.root, 'retained-index.v1.json'), 'utf8'))).toContain('metrora.canonical-history-retained-index')
    expect((await readCanonicalHistoryShadowHeadV1({ dataDir }))?.projectionSha256).toBe(first.projectionSha256)
  })

  it('advances the head without deleting earlier snapshots and reports retained-only identities', async () => {
    const dataDir = await temporaryDataDir()
    const first = await persistCanonicalHistoryShadowV1(projection('a'), { dataDir })
    const second = await persistCanonicalHistoryShadowV1(projection('d'), { dataDir })
    const paths = canonicalHistoryShadowPathsV1(dataDir)

    expect(second.status).toBe('advanced')
    expect(second.previousProjectionSha256).toBe(first.projectionSha256)
    expect(second.reconciliation).toEqual({
      observations: { added: 1, unchanged: 0, retainedOnly: 1 },
      activities: { added: 1, unchanged: 0, revised: 0, retainedOnly: 1 },
      dailySnapshots: { added: 1, unchanged: 0, retainedOnly: 1 },
    })
    expect((await readdir(paths.snapshots)).sort()).toEqual([
      `${first.projectionSha256}.json`,
      `${second.projectionSha256}.json`,
    ].sort())
    expect((await readCanonicalHistoryShadowHeadV1({ dataDir }))?.projectionSha256).toBe(second.projectionSha256)
  })

  it('publishes ordered live-turn activity revisions without duplicating observations', async () => {
    const dataDir = await temporaryDataDir()
    const firstProjection = liveTurnProjection(['a'])
    const secondProjection = liveTurnProjection(['a', 'b'])
    const thirdProjection = liveTurnProjection(['a', 'b', 'c'])

    const first = await persistCanonicalHistoryShadowV1(firstProjection, { dataDir })
    const second = await persistCanonicalHistoryShadowV1(secondProjection, { dataDir })
    const third = await persistCanonicalHistoryShadowV1(thirdProjection, { dataDir })
    const paths = canonicalHistoryShadowPathsV1(dataDir)

    expect(first.status).toBe('initialized')
    expect(second.status).toBe('advanced')
    expect(third.status).toBe('advanced')
    expect(second.reconciliation.activities).toEqual({ added: 0, unchanged: 0, revised: 1, retainedOnly: 0 })
    expect(third.reconciliation.activities).toEqual({ added: 0, unchanged: 0, revised: 1, retainedOnly: 0 })
    expect(new Set([first.projectionSha256, second.projectionSha256, third.projectionSha256]).size).toBe(3)
    expect(await readdir(paths.snapshots)).toHaveLength(3)
    expect((await readCanonicalHistoryShadowHeadV1({ dataDir }))?.projectionSha256).toBe(third.projectionSha256)

    const oldSnapshot = JSON.parse(await readFile(join(paths.snapshots, `${first.projectionSha256}.json`), 'utf8')) as {
      projection: CanonicalHistoryReadProjectionV1
    }
    expect(oldSnapshot.projection.activities[0]!.observationIds).toEqual(firstProjection.activities[0]!.observationIds)
    expect(new Set(thirdProjection.observations.map(observation => observation.observationId)).size).toBe(3)

    const unchanged = await persistCanonicalHistoryShadowV1(thirdProjection, { dataDir })
    expect(unchanged.status).toBe('unchanged')
    expect(await readdir(paths.snapshots)).toHaveLength(3)

    const conflictingObservation = liveTurnProjection(['a', 'b', 'c'])
    conflictingObservation.observations[0]!.model = 'conflicting-immutable-payload'
    await expect(persistCanonicalHistoryShadowV1(conflictingObservation, { dataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    const reorderedActivity = liveTurnProjection(['b', 'a', 'c'])
    await expect(persistCanonicalHistoryShadowV1(reorderedActivity, { dataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    const unrelatedActivityCollision = liveTurnProjection(['x'])
    await expect(persistCanonicalHistoryShadowV1(unrelatedActivityCollision, { dataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    expect((await readCanonicalHistoryShadowHeadV1({ dataDir }))?.projectionSha256).toBe(third.projectionSha256)
    expect(await readdir(paths.snapshots)).toHaveLength(3)
  })

  it('rejects conflicting reuse of an observation identity and leaves the previous head unchanged', async () => {
    const dataDir = await temporaryDataDir()
    const firstProjection = projection()
    const first = await persistCanonicalHistoryShadowV1(firstProjection, { dataDir })
    const middle = await persistCanonicalHistoryShadowV1(projection('d'), { dataDir })
    const conflicting = structuredClone(firstProjection)
    conflicting.observations[0]!.model = 'conflicting-model'

    await expect(persistCanonicalHistoryShadowV1(conflicting, { dataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    expect((await readCanonicalHistoryShadowHeadV1({ dataDir }))?.projectionSha256).toBe(middle.projectionSha256)
    expect((await readdir(canonicalHistoryShadowPathsV1(dataDir).snapshots)).sort()).toEqual([
      `${first.projectionSha256}.json`,
      `${middle.projectionSha256}.json`,
    ].sort())
  })

  it('repairs publication when the immutable snapshot exists but the head write was interrupted', async () => {
    const dataDir = await temporaryDataDir()
    const value = projection()
    const digest = canonicalHistoryShadowProjectionSha256V1(value)
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    await mkdir(paths.snapshots, { recursive: true })
    await writeFile(join(paths.snapshots, `${digest}.json`), JSON.stringify({
      kind: CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND,
      version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
      projectionSha256: digest,
      createdAt: '2026-08-05T20:00:00.000Z',
      projection: value,
    }))

    const result = await persistCanonicalHistoryShadowV1(value, {
      dataDir,
      now: () => new Date('2026-08-05T20:05:00.000Z'),
    })

    expect(result.status).toBe('recovered-head')
    expect((await readCanonicalHistoryShadowHeadV1({ dataDir }))?.projectionSha256).toBe(digest)
    expect(await readdir(paths.snapshots)).toEqual([`${digest}.json`])
  })

  it('fails closed for corrupt snapshots and missing head targets', async () => {
    const dataDir = await temporaryDataDir()
    const value = projection()
    const stored = await persistCanonicalHistoryShadowV1(value, { dataDir })
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const snapshot = join(paths.snapshots, `${stored.projectionSha256}.json`)
    const corrupted = JSON.parse(await readFile(snapshot, 'utf-8')) as Record<string, unknown>
    const corruptedProjection = structuredClone(value)
    corruptedProjection.observations[0]!.model = 'corrupted'
    corrupted.projection = corruptedProjection
    await writeFile(snapshot, JSON.stringify(corrupted))

    await expect(readCanonicalHistoryShadowHeadV1({ dataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    const missingDataDir = await temporaryDataDir()
    const missingPaths = canonicalHistoryShadowPathsV1(missingDataDir)
    await mkdir(missingPaths.root, { recursive: true })
    await writeFile(missingPaths.head, JSON.stringify({
      kind: CANONICAL_HISTORY_SHADOW_HEAD_KIND,
      version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
      projectionSha256: hex('f'),
      updatedAt: '2026-08-05T20:00:00.000Z',
    }))

    await expect(readCanonicalHistoryShadowHeadV1({ dataDir: missingDataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    const malformedHeadDataDir = await temporaryDataDir()
    const malformedHeadPaths = canonicalHistoryShadowPathsV1(malformedHeadDataDir)
    await mkdir(malformedHeadPaths.root, { recursive: true })
    await writeFile(malformedHeadPaths.head, '{"kind":"wrong"}')
    await expect(readCanonicalHistoryShadowHeadV1({ dataDir: malformedHeadDataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    const unexpectedFileDataDir = await temporaryDataDir()
    const unexpectedFileStored = await persistCanonicalHistoryShadowV1(projection(), { dataDir: unexpectedFileDataDir })
    const unexpectedFilePaths = canonicalHistoryShadowPathsV1(unexpectedFileDataDir)
    await writeFile(join(unexpectedFilePaths.snapshots, 'unexpected.jsonl'), 'unexpected')
    await expect(persistCanonicalHistoryShadowV1(projection(), { dataDir: unexpectedFileDataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)
    expect((await readCanonicalHistoryShadowHeadV1({ dataDir: unexpectedFileDataDir }))?.projectionSha256)
      .toBe(unexpectedFileStored.projectionSha256)
  })

  it('refuses private source material before creating persistent shadow state', async () => {
    const dataDir = await temporaryDataDir()
    const unsafe = structuredClone(projection()) as CanonicalHistoryReadProjectionV1 & {
      observations: Array<CanonicalHistoryReadProjectionV1['observations'][number] & { sessionId?: string }>
    }
    unsafe.observations[0]!.sessionId = 'private-session-id'

    await expect(persistCanonicalHistoryShadowV1(unsafe, { dataDir }))
      .rejects.toThrow(CanonicalHistoryShadowStoreIntegrityError)

    await expect(readCanonicalHistoryShadowHeadV1({ dataDir })).resolves.toBeUndefined()
  })
})
