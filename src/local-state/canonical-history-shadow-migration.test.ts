import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { CanonicalHistoryReadProjectionV1 } from './canonical-history-read-projection.js'
import {
  CANONICAL_HISTORY_SHADOW_HEAD_KIND,
  CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND,
  CANONICAL_HISTORY_SHADOW_STORE_VERSION,
  canonicalHistoryShadowPathsV1,
  migrateCanonicalHistoryShadowLegacyV1,
  persistCanonicalHistoryShadowV1,
  readCanonicalHistoryShadowPublicationTrustV1,
} from './canonical-history-shadow-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function hex(character: string): string {
  return character.repeat(64)
}

function projection(): CanonicalHistoryReadProjectionV1 {
  const observationId = `observation-v1:${hex('a')}`
  const activityId = `activity-v1:${hex('b')}`
  const snapshotId = `history-day-v1:${hex('c')}`
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
      sourceFingerprintSha256: hex('d'),
      collector: 'codex',
      timestamp: '2026-08-01T21:00:01.000Z',
      model: 'gpt-test',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 5,
        cachedInputTokens: 5,
        reasoningTokens: 0,
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
      collector: 'codex',
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
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 1,
      models: {},
      categories: {},
      providers: {},
      bucketTimeZone: 'UTC',
      authority: 'trusted-daily-cache',
    }],
  }
}

async function temporaryDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-history-shadow-migration-'))
  roots.push(root)
  return root
}

async function makeLegacyHead(dataDir: string): Promise<{
  paths: ReturnType<typeof canonicalHistoryShadowPathsV1>
  oldHead: Buffer
  snapshot: Buffer
}> {
  await persistCanonicalHistoryShadowV1(projection(), { dataDir })
  const paths = canonicalHistoryShadowPathsV1(dataDir)
  const oldHead = JSON.parse(await readFile(paths.head, 'utf8')) as Record<string, unknown>
  delete oldHead.snapshotSha256
  const oldHeadBytes = Buffer.from(JSON.stringify(oldHead), 'utf8')
  await writeFile(paths.head, oldHeadBytes)
  const snapshotPath = join(paths.snapshots, `${oldHead.projectionSha256 as string}.json`)
  const snapshot = await readFile(snapshotPath)
  await rm(join(paths.root, 'retained-index.v1.json'), { force: true })
  await rm(paths.headlineIndexes, { recursive: true, force: true })
  await rm(join(paths.root, 'publication-state.v1.json'), { force: true })
  return { paths, oldHead: oldHeadBytes, snapshot }
}

describe('canonical history legacy shadow migration', () => {
  it('migrates a valid unsealed head without rewriting its immutable snapshot', async () => {
    const dataDir = await temporaryDataDir()
    const { paths, snapshot, oldHead } = await makeLegacyHead(dataDir)

    const result = await migrateCanonicalHistoryShadowLegacyV1({ dataDir })
    expect(result.status).toBe('migrated')
    expect(result.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(await readFile(join(paths.snapshots, `${result.projectionSha256}.json`))).toEqual(snapshot)

    const migratedHead = JSON.parse(await readFile(paths.head, 'utf8')) as Record<string, unknown>
    expect(migratedHead.projectionSha256).toBe(JSON.parse(oldHead.toString('utf8')).projectionSha256)
    expect(migratedHead.snapshotSha256).toBe(result.snapshotSha256)
    expect(await readCanonicalHistoryShadowPublicationTrustV1({ dataDir })).toMatchObject({
      deepValidated: true,
      head: { snapshotSha256: result.snapshotSha256 },
    })
  })

  it('fails closed for an invalid legacy snapshot and leaves the unsealed head recoverable', async () => {
    const dataDir = await temporaryDataDir()
    const { paths, oldHead } = await makeLegacyHead(dataDir)
    const head = JSON.parse(oldHead.toString('utf8')) as { projectionSha256: string }
    const snapshotPath = join(paths.snapshots, `${head.projectionSha256}.json`)
    await writeFile(snapshotPath, '{broken')

    await expect(migrateCanonicalHistoryShadowLegacyV1({ dataDir }))
      .rejects.toThrow('canonical history shadow snapshot is invalid')
    expect(await readFile(paths.head)).toEqual(oldHead)
  })

  it('keeps the old head recoverable when interrupted before the upgrade write', async () => {
    const dataDir = await temporaryDataDir()
    const { paths, oldHead, snapshot } = await makeLegacyHead(dataDir)

    await expect(migrateCanonicalHistoryShadowLegacyV1({
      dataDir,
      onLegacyHeadMigrationBeforeWrite: () => { throw new Error('simulated migration interruption') },
    })).rejects.toThrow('simulated migration interruption')
    expect(await readFile(paths.head)).toEqual(oldHead)
    expect(await readFile(join(paths.snapshots, `${JSON.parse(oldHead.toString('utf8')).projectionSha256}.json`))).toEqual(snapshot)

    await expect(migrateCanonicalHistoryShadowLegacyV1({ dataDir })).resolves.toMatchObject({ status: 'migrated' })
  })

  it('deep-validates the migrated head after a cold trust restart', async () => {
    const dataDir = await temporaryDataDir()
    const { paths } = await makeLegacyHead(dataDir)
    await migrateCanonicalHistoryShadowLegacyV1({ dataDir })
    const before = await readFile(paths.head)

    const cold = await readCanonicalHistoryShadowPublicationTrustV1({ dataDir })
    expect(cold?.deepValidated).toBe(true)
    expect(await readFile(paths.head)).toEqual(before)
  })

  it('recognizes the prior head envelope as legacy rather than inventing a new identity', async () => {
    const dataDir = await temporaryDataDir()
    const { paths, oldHead } = await makeLegacyHead(dataDir)
    const parsed = JSON.parse(oldHead.toString('utf8')) as Record<string, unknown>
    expect(parsed.kind).toBe(CANONICAL_HISTORY_SHADOW_HEAD_KIND)
    expect(parsed.version).toBe(CANONICAL_HISTORY_SHADOW_STORE_VERSION)
    expect(parsed.snapshotSha256).toBeUndefined()
    const snapshot = JSON.parse((await readFile(join(paths.snapshots, `${parsed.projectionSha256}.json`))).toString('utf8')) as Record<string, unknown>
    expect(snapshot.kind).toBe(CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND)
    expect(snapshot.version).toBe(CANONICAL_HISTORY_SHADOW_STORE_VERSION)
  })
})
