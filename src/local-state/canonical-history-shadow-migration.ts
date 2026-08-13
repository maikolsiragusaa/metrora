import { atomicWritePrivateFile, readOptionalPrivateFile } from './atomic-file.js'
import {
  canonicalHistoryShadowSnapshotSha256V1,
  ensureCanonicalHistoryCliHeadlineIndexV1,
} from './canonical-history-cli-headline-index-store.js'
import type { CanonicalHistoryReadProjectionV1 } from './canonical-history-read-projection.js'
import {
  readCanonicalHistoryRetainedIndexV1,
} from './canonical-history-retained-index.js'
import { CanonicalHistoryShadowStoreIntegrityError } from './canonical-history-shadow-errors.js'
import { withLocalStateLease } from './local-state-lease.js'
import type {
  CanonicalHistoryShadowHeadV1,
  CanonicalHistoryShadowPathsV1,
  CanonicalHistoryShadowProjectionIndexV1,
  CanonicalHistoryShadowSnapshotV1,
} from './canonical-history-shadow-store.js'

type ParsedSnapshotV1 = {
  record: CanonicalHistoryShadowSnapshotV1
  index: CanonicalHistoryShadowProjectionIndexV1
}

export type CanonicalHistoryShadowLegacyMigrationOptionsV1 = {
  dataDir: string
  paths: CanonicalHistoryShadowPathsV1
  now?: () => Date
  onLegacyHeadMigrationBeforeWrite?: () => void | Promise<void>
  parseHead: (bytes: Uint8Array) => CanonicalHistoryShadowHeadV1
  parseSnapshot: (bytes: Uint8Array, expectedDigest: string) => ParsedSnapshotV1
  snapshotPath: (paths: CanonicalHistoryShadowPathsV1, digest: string) => string
  prepare: (paths: CanonicalHistoryShadowPathsV1) => Promise<void>
}

export type CanonicalHistoryShadowLegacyMigrationResultV1 = {
  status: 'absent' | 'already-sealed' | 'migrated'
  projectionSha256?: string
  snapshotSha256?: string
}

/** Upgrade a valid pre-content-seal head without rewriting immutable snapshots. */
export async function migrateCanonicalHistoryShadowLegacyAtPathsV1(
  options: CanonicalHistoryShadowLegacyMigrationOptionsV1,
): Promise<CanonicalHistoryShadowLegacyMigrationResultV1> {
  const now = options.now ?? (() => new Date())
  return withLocalStateLease(options.paths.root, async () => {
    const headBytes = await readOptionalPrivateFile(options.paths.head)
    if (!headBytes) return { status: 'absent' as const }
    const head = options.parseHead(headBytes)
    if (head.snapshotSha256 !== undefined) {
      return {
        status: 'already-sealed' as const,
        projectionSha256: head.projectionSha256,
        snapshotSha256: head.snapshotSha256,
      }
    }

    const snapshotBytes = await readOptionalPrivateFile(options.snapshotPath(options.paths, head.projectionSha256))
    if (!snapshotBytes) {
      throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head points to a missing snapshot')
    }
    const parsed = options.parseSnapshot(snapshotBytes, head.projectionSha256)
    const snapshotSha256 = canonicalHistoryShadowSnapshotSha256V1(snapshotBytes)

    await options.prepare(options.paths)
    const retained = await readCanonicalHistoryRetainedIndexV1(options.paths, options.parseSnapshot, { deepValidate: true })
    const retainedHead = retained.snapshots.find(snapshot => snapshot.projectionSha256 === head.projectionSha256)
    if (!retainedHead || retainedHead.snapshotSha256 !== snapshotSha256) {
      throw new CanonicalHistoryShadowStoreIntegrityError('canonical history retained index could not seal the legacy head snapshot')
    }
    await ensureCanonicalHistoryCliHeadlineIndexV1({
      dataDir: options.dataDir,
      projection: parsed.record.projection as CanonicalHistoryReadProjectionV1,
      projectionSha256: head.projectionSha256,
      snapshotBytes,
    })

    await options.onLegacyHeadMigrationBeforeWrite?.()
    const migratedHead = options.parseHead(Buffer.from(JSON.stringify({
      ...head,
      snapshotSha256,
      updatedAt: now().toISOString(),
    }), 'utf-8'))
    await atomicWritePrivateFile(options.paths.head, JSON.stringify(migratedHead))
    return { status: 'migrated' as const, projectionSha256: head.projectionSha256, snapshotSha256 }
  })
}
