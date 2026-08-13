import { join } from 'node:path'

import { readOptionalPrivateFile } from './atomic-file.js'
import {
  canonicalHistoryShadowPathsV1,
  readCanonicalHistoryShadowHeadV1,
  CanonicalHistoryShadowStoreIntegrityError,
  type CanonicalHistoryShadowHeadV1,
  type CanonicalHistoryShadowStoreOptions,
} from './canonical-history-shadow-store.js'
import { readCanonicalHistoryShadowFastSealV1 } from './canonical-history-shadow-fast-read.js'
import { defaultMetroraDataDir } from './endpoint-identity.js'
import {
  readCanonicalHistoryCliHeadlineIndexFastV1,
  readCanonicalHistoryCliHeadlineIndexV1,
} from './canonical-history-cli-headline-index-store.js'
import type { CanonicalHistoryCliHeadlineIndexV1 } from './canonical-history-cli-headline-index.js'

/**
 * Full headline-index validation. This path opens and hashes the immutable
 * canonical snapshot and is intentionally not used by terminal status.
 */
export async function readCanonicalHistoryShadowHeadlineIndexV1(
  options: Pick<CanonicalHistoryShadowStoreOptions, 'dataDir'> = {},
): Promise<{ head: CanonicalHistoryShadowHeadV1; index: CanonicalHistoryCliHeadlineIndexV1 } | undefined> {
  const dataDir = options.dataDir ?? defaultMetroraDataDir()
  const head = await readCanonicalHistoryShadowHeadV1({ dataDir })
  if (!head) return undefined
  const paths = canonicalHistoryShadowPathsV1(dataDir)
  const snapshotBytes = await readOptionalPrivateFile(join(paths.snapshots, `${head.projectionSha256}.json`))
  if (!snapshotBytes) throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head points to a missing snapshot')
  try {
    const index = await readCanonicalHistoryCliHeadlineIndexV1({ dataDir, projectionSha256: head.projectionSha256, snapshotBytes })
    if (head.snapshotSha256 !== undefined && head.snapshotSha256 !== index.snapshotSha256) {
      throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head snapshot seal does not match the index')
    }
    return { head, index }
  } catch (error) {
    if (error instanceof CanonicalHistoryShadowStoreIntegrityError) throw error
    throw new CanonicalHistoryShadowStoreIntegrityError(error instanceof Error ? error.message : 'canonical history CLI headline index is invalid')
  }
}

export async function readCanonicalHistoryShadowHeadlineIndexFastV1(
  options: Pick<CanonicalHistoryShadowStoreOptions, 'dataDir'> = {},
): Promise<{ head: CanonicalHistoryShadowHeadV1; index: CanonicalHistoryCliHeadlineIndexV1 } | undefined> {
  const dataDir = options.dataDir ?? defaultMetroraDataDir()
  const sealed = await readCanonicalHistoryShadowFastSealV1(options)
  if (!sealed) return undefined
  try {
    const index = await readCanonicalHistoryCliHeadlineIndexFastV1({
      dataDir,
      projectionSha256: sealed.head.projectionSha256,
      snapshotSha256: sealed.head.snapshotSha256,
    })
    return { head: sealed.head, index }
  } catch (error) {
    if (error instanceof CanonicalHistoryShadowStoreIntegrityError) throw error
    throw new CanonicalHistoryShadowStoreIntegrityError(error instanceof Error ? error.message : 'canonical history CLI headline index is invalid')
  }
}
