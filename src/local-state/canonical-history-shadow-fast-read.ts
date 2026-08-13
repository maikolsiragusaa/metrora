import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { readOptionalPrivateFile } from './atomic-file.js'
import { defaultMetroraDataDir } from './endpoint-identity.js'
import {
  canonicalHistoryShadowPathsV1,
  CanonicalHistoryShadowStoreIntegrityError,
  parseCanonicalHistoryShadowHeadV1,
  type CanonicalHistoryShadowHeadV1,
  type CanonicalHistoryShadowStoreOptions,
} from './canonical-history-shadow-store.js'

/**
 * Read only the small head/seal metadata needed by the terminal headline
 * consumer. The pointed snapshot is existence-checked but never opened or
 * hashed; the full shadow reader remains the canonical integrity path.
 */
export async function readCanonicalHistoryShadowFastSealV1(
  options: Pick<CanonicalHistoryShadowStoreOptions, 'dataDir'> = {},
): Promise<{ head: CanonicalHistoryShadowHeadV1; snapshotPath: string } | undefined> {
  const dataDir = options.dataDir ?? defaultMetroraDataDir()
  const paths = canonicalHistoryShadowPathsV1(dataDir)
  const headBytes = await readOptionalPrivateFile(paths.head)
  if (!headBytes) return undefined
  const head = parseCanonicalHistoryShadowHeadV1(headBytes)
  const target = join(paths.snapshots, `${head.projectionSha256}.json`)
  try {
    const snapshotStat = await stat(target)
    if (!snapshotStat.isFile()) throw new Error('not a file')
  } catch {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head points to a missing snapshot')
  }
  return { head, snapshotPath: target }
}
