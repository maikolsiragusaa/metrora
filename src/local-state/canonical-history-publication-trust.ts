import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { readOptionalPrivateFile } from './atomic-file.js'
import {
  parseCanonicalHistoryCliHeadlineIndexV1,
  type CanonicalHistoryCliHeadlineIndexV1,
} from './canonical-history-cli-headline-index.js'
import { canonicalHistoryShadowSnapshotSha256V1 } from './canonical-history-cli-headline-index-store.js'
import type {
  CanonicalHistoryShadowHeadV1,
  CanonicalHistoryShadowPathsV1,
  CanonicalHistoryShadowProjectionIndexV1,
} from './canonical-history-shadow-store.js'
import { CanonicalHistoryShadowStoreIntegrityError } from './canonical-history-shadow-errors.js'
import {
  readCanonicalHistoryRetainedIndexV1,
  type CanonicalHistoryRetainedProjectionIndexV1,
} from './canonical-history-retained-index.js'

type CanonicalHistoryShadowTrustSnapshotV1 = {
  projectionSha256: string
  snapshotSha256: string
  dev: number
  ino: number
  mtimeMs: number
  sizeBytes: number
}

type CanonicalHistoryShadowTrustMemoV1 = {
  headProjectionSha256: string
  headSnapshotSha256: string
  snapshots: CanonicalHistoryShadowTrustSnapshotV1[]
  retainedIndex: CanonicalHistoryShadowTrustFileIdentityV1
}

type CanonicalHistoryShadowTrustFileIdentityV1 = {
  dev: number
  ino: number
  mtimeMs: number
  sizeBytes: number
}

export type CanonicalHistoryShadowPublicationTrustV1 = {
  head: CanonicalHistoryShadowHeadV1
  headlineIndex: CanonicalHistoryCliHeadlineIndexV1
  deepValidated: boolean
}

const canonicalHistoryShadowTrustMemo = new Map<string, CanonicalHistoryShadowTrustMemoV1>()

function snapshotPath(paths: CanonicalHistoryShadowPathsV1, digest: string): string {
  return join(paths.snapshots, `${digest}.json`)
}

function trustFileIdentity(info: { dev: number; ino: number; mtimeMs: number; size: number }): CanonicalHistoryShadowTrustFileIdentityV1 {
  return { dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, sizeBytes: info.size }
}

function trustFileIdentityMatches(
  expected: CanonicalHistoryShadowTrustFileIdentityV1,
  actual: CanonicalHistoryShadowTrustFileIdentityV1,
): boolean {
  return expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.mtimeMs === actual.mtimeMs
    && expected.sizeBytes === actual.sizeBytes
}

async function snapshotTrustSeals(
  paths: CanonicalHistoryShadowPathsV1,
): Promise<CanonicalHistoryShadowTrustSnapshotV1[]> {
  const entries = await readdir(paths.snapshots, { withFileTypes: true })
  const seals: CanonicalHistoryShadowTrustSnapshotV1[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.name.includes('.metrora-tmp-')) continue
    const match = /^([a-f0-9]{64})\.json$/u.exec(entry.name)
    if (!match) {
      throw new CanonicalHistoryShadowStoreIntegrityError(`canonical history shadow contains unexpected snapshot file ${entry.name}`)
    }
    const info = await stat(join(paths.snapshots, entry.name))
    seals.push({
      projectionSha256: match[1]!,
      snapshotSha256: '',
      ...trustFileIdentity(info),
    })
  }
  return seals.sort((left, right) => left.projectionSha256.localeCompare(right.projectionSha256))
}

function trustSnapshotMetadataMatches(
  expected: CanonicalHistoryShadowTrustSnapshotV1[],
  actual: CanonicalHistoryShadowTrustSnapshotV1[],
): boolean {
  return expected.length === actual.length && expected.every((left, index) => {
    const right = actual[index]
    return right !== undefined
      && left.projectionSha256 === right.projectionSha256
      && left.dev === right.dev
      && left.ino === right.ino
      && left.mtimeMs === right.mtimeMs
      && left.sizeBytes === right.sizeBytes
  })
}

async function readPublisherHeadlineIndex(
  paths: CanonicalHistoryShadowPathsV1,
  head: CanonicalHistoryShadowHeadV1,
): Promise<CanonicalHistoryCliHeadlineIndexV1> {
  const bytes = await readOptionalPrivateFile(join(paths.headlineIndexes, `${head.projectionSha256}.json`))
  if (!bytes) throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow headline index is missing')
  let index: CanonicalHistoryCliHeadlineIndexV1
  try {
    index = parseCanonicalHistoryCliHeadlineIndexV1(bytes)
  } catch (error) {
    throw new CanonicalHistoryShadowStoreIntegrityError(error instanceof Error ? error.message : 'canonical history shadow headline index is invalid')
  }
  if (index.projectionSha256 !== head.projectionSha256) {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow headline index names a different projection')
  }
  if (head.snapshotSha256 === undefined || index.snapshotSha256 !== head.snapshotSha256) {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow headline index snapshot seal does not match the head')
  }
  return index
}

export async function rememberCanonicalHistoryPublicationTrustV1(
  dataDir: string,
  paths: CanonicalHistoryShadowPathsV1,
  head: CanonicalHistoryShadowHeadV1,
  retained: CanonicalHistoryRetainedProjectionIndexV1,
): Promise<void> {
  if (head.snapshotSha256 === undefined) return
  const retainedIndexInfo = await stat(join(paths.root, 'retained-index.v1.json'))
  canonicalHistoryShadowTrustMemo.set(dataDir, {
    headProjectionSha256: head.projectionSha256,
    headSnapshotSha256: head.snapshotSha256,
    snapshots: retained.snapshots
      .map(snapshot => ({ ...snapshot }))
      .sort((left, right) => left.projectionSha256.localeCompare(right.projectionSha256)),
    retainedIndex: trustFileIdentity(retainedIndexInfo),
  })
}

/** Clear the process-local memo; a real process restart starts empty. */
export function clearCanonicalHistoryShadowTrustMemoV1(dataDir?: string): void {
  if (dataDir === undefined) canonicalHistoryShadowTrustMemo.clear()
  else canonicalHistoryShadowTrustMemo.delete(dataDir)
}

/**
 * Canonical publisher trust boundary. Unlike the terminal fast reader, a cold
 * lifecycle hashes the head and deeply validates every retained snapshot
 * against its prior content seal before acceleration state can authorize a
 * publication decision.
 */
export async function readCanonicalHistoryPublicationTrustV1(input: {
  dataDir: string
  paths: CanonicalHistoryShadowPathsV1
  parseHead: (bytes: Uint8Array) => CanonicalHistoryShadowHeadV1
  parseSnapshot: (bytes: Uint8Array, expectedDigest: string) => { index: CanonicalHistoryShadowProjectionIndexV1 }
}): Promise<CanonicalHistoryShadowPublicationTrustV1 | undefined> {
  const { dataDir, paths } = input
  const headBytes = await readOptionalPrivateFile(paths.head)
  if (!headBytes) {
    clearCanonicalHistoryShadowTrustMemoV1(dataDir)
    return undefined
  }
  const head = input.parseHead(headBytes)
  if (head.snapshotSha256 === undefined) {
    clearCanonicalHistoryShadowTrustMemoV1(dataDir)
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head has no snapshot content seal')
  }

  const snapshotInfo = await stat(snapshotPath(paths, head.projectionSha256)).catch(() => undefined)
  if (!snapshotInfo || !snapshotInfo.isFile()) {
    clearCanonicalHistoryShadowTrustMemoV1(dataDir)
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head points to a missing snapshot')
  }
  const retainedIndexInfo = await stat(join(paths.root, 'retained-index.v1.json')).catch(() => undefined)
  const memo = canonicalHistoryShadowTrustMemo.get(dataDir)
  if (
    memo
    && memo.headProjectionSha256 === head.projectionSha256
    && memo.headSnapshotSha256 === head.snapshotSha256
    && retainedIndexInfo
    && trustFileIdentityMatches(memo.retainedIndex, trustFileIdentity(retainedIndexInfo))
  ) {
    const currentSnapshots = await snapshotTrustSeals(paths)
    if (trustSnapshotMetadataMatches(memo.snapshots, currentSnapshots)) {
      return {
        head,
        headlineIndex: await readPublisherHeadlineIndex(paths, head),
        deepValidated: false,
      }
    }
  }

  const snapshotBytes = await readOptionalPrivateFile(snapshotPath(paths, head.projectionSha256))
  if (!snapshotBytes) throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head points to a missing snapshot')
  input.parseSnapshot(snapshotBytes, head.projectionSha256)
  const snapshotSha256 = canonicalHistoryShadowSnapshotSha256V1(snapshotBytes)
  if (snapshotSha256 !== head.snapshotSha256) {
    clearCanonicalHistoryShadowTrustMemoV1(dataDir)
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head snapshot content seal does not match its bytes')
  }

  const retained = await readCanonicalHistoryRetainedIndexV1(paths, input.parseSnapshot, { deepValidate: true })
  const retainedHead = retained.snapshots.find(snapshot => snapshot.projectionSha256 === head.projectionSha256)
  if (!retainedHead || retainedHead.snapshotSha256 !== snapshotSha256) {
    clearCanonicalHistoryShadowTrustMemoV1(dataDir)
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history retained index does not seal the current head snapshot')
  }
  const headlineIndex = await readPublisherHeadlineIndex(paths, head)
  if (headlineIndex.snapshotSha256 !== snapshotSha256) {
    clearCanonicalHistoryShadowTrustMemoV1(dataDir)
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow headline index does not seal the current snapshot bytes')
  }
  await rememberCanonicalHistoryPublicationTrustV1(dataDir, paths, head, retained)
  return { head, headlineIndex, deepValidated: true }
}
