import { createHash } from 'node:crypto'
import { join } from 'node:path'

import {
  atomicWritePrivateFile,
  cleanupStaleAtomicTemps,
  ensurePrivateDirectory,
  readOptionalPrivateFile,
} from './atomic-file.js'
import {
  buildCanonicalHistoryCliHeadlineIndexV1,
  parseCanonicalHistoryCliHeadlineIndexV1,
  type CanonicalHistoryCliHeadlineIndexV1,
} from './canonical-history-cli-headline-index.js'
import type { CanonicalHistoryReadProjectionV1 } from './canonical-history-read-projection.js'

function indexPath(dataDir: string, projectionSha256: string): string {
  return join(dataDir, 'history-shadow', 'v1', 'headline-indexes', `${projectionSha256}.json`)
}

export function canonicalHistoryShadowSnapshotSha256V1(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function prepareCanonicalHistoryCliHeadlineIndexStoreV1(directory: string): Promise<void> {
  await ensurePrivateDirectory(directory)
  await cleanupStaleAtomicTemps(directory)
}

export async function ensureCanonicalHistoryCliHeadlineIndexV1(input: {
  dataDir: string
  projection: CanonicalHistoryReadProjectionV1
  projectionSha256: string
  snapshotBytes: Uint8Array
  authorityGeneration?: {
    sessionPayloadSha256: string
    dailyPayloadSha256: string
    sourceManifestSha256: string
    analyticsGenerationId?: string
  }
}): Promise<void> {
  const index = buildCanonicalHistoryCliHeadlineIndexV1({
    projection: input.projection,
    projectionSha256: input.projectionSha256,
    snapshotSha256: canonicalHistoryShadowSnapshotSha256V1(input.snapshotBytes),
    authorityGeneration: input.authorityGeneration,
  })
  const path = indexPath(input.dataDir, input.projectionSha256)
  const existingBytes = await readOptionalPrivateFile(path)
  if (existingBytes) {
    try {
      const existing = parseCanonicalHistoryCliHeadlineIndexV1(existingBytes)
      if (
        existing.projectionSha256 === index.projectionSha256
        && existing.snapshotSha256 === index.snapshotSha256
        && existing.sessionAuthorityGenerationSha256 === index.sessionAuthorityGenerationSha256
        && existing.dailyAuthorityGenerationSha256 === index.dailyAuthorityGenerationSha256
        && existing.sessionSourceManifestSha256 === index.sessionSourceManifestSha256
        && existing.analyticsGenerationId === index.analyticsGenerationId
      ) return
    } catch {
      // Regenerate a derived index from the immutable canonical projection.
    }
  }
  await atomicWritePrivateFile(path, JSON.stringify(index))
}

export async function readCanonicalHistoryCliHeadlineIndexV1(input: {
  dataDir: string
  projectionSha256: string
  snapshotBytes: Uint8Array
}): Promise<CanonicalHistoryCliHeadlineIndexV1> {
  const bytes = await readOptionalPrivateFile(indexPath(input.dataDir, input.projectionSha256))
  if (!bytes) throw new Error('canonical history CLI headline index is missing')
  const index = parseCanonicalHistoryCliHeadlineIndexV1(bytes)
  if (index.projectionSha256 !== input.projectionSha256) {
    throw new Error('canonical history CLI headline index names a different projection')
  }
  if (canonicalHistoryShadowSnapshotSha256V1(input.snapshotBytes) !== index.snapshotSha256) {
    throw new Error('canonical history CLI headline index snapshot digest does not match')
  }
  return index
}
