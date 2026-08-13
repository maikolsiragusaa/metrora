import { join } from 'node:path'

import { readOptionalPrivateFile } from './atomic-file.js'
import { defaultMetroraDataDir } from './endpoint-identity.js'
import {
  canonicalHistoryShadowPathsV1,
  readCanonicalHistoryShadowHeadV1,
  CanonicalHistoryShadowStoreIntegrityError,
  type CanonicalHistoryShadowHeadV1,
  type CanonicalHistoryShadowStoreOptions,
} from './canonical-history-shadow-store.js'
import {
  readCanonicalHistoryCliHeadlineIndexV1,
} from './canonical-history-cli-headline-index-store.js'
import type { CanonicalHistoryCliHeadlineIndexV1 } from './canonical-history-cli-headline-index.js'

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
    return { head, index }
  } catch (error) {
    if (error instanceof CanonicalHistoryShadowStoreIntegrityError) throw error
    throw new CanonicalHistoryShadowStoreIntegrityError(error instanceof Error ? error.message : 'canonical history CLI headline index is invalid')
  }
}
