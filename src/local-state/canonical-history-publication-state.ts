import { createHash } from 'node:crypto'
import { join } from 'node:path'
import * as z from 'zod/v4'

import { Sha256DigestSchema } from '../contracts/v1/common.js'
import {
  atomicWritePrivateFile,
  readOptionalPrivateFile,
} from './atomic-file.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'

export const CANONICAL_HISTORY_PUBLICATION_STATE_KIND = 'metrora.canonical-history-publication-state' as const
export const CANONICAL_HISTORY_PUBLICATION_STATE_VERSION = 1 as const

export type CanonicalHistoryPublicationSourceV1 = {
  provider: string
  pathSha256: string
  envFingerprint: string
  fingerprint: {
    dev: number
    ino: number
    mtimeMs: number
    sizeBytes: number
    sqliteWal?: { mtimeMs: number; sizeBytes: number }
  }
  observationIds: string[]
  activityIds: string[]
}

export type CanonicalHistoryPublicationStateV1 = {
  kind: typeof CANONICAL_HISTORY_PUBLICATION_STATE_KIND
  version: typeof CANONICAL_HISTORY_PUBLICATION_STATE_VERSION
  endpointScopeSha256: string
  analyticsGenerationId: string
  sessionPayloadSha256: string
  dailyPayloadSha256: string
  sourceManifestSha256: string
  projectionSha256: string
  snapshotSha256: string
  sources: CanonicalHistoryPublicationSourceV1[]
  stateSha256: string
}

const FingerprintSchema = z.strictObject({
  dev: z.number().finite(),
  ino: z.number().finite(),
  mtimeMs: z.number().finite(),
  sizeBytes: z.number().finite(),
  sqliteWal: z.strictObject({
    mtimeMs: z.number().finite(),
    sizeBytes: z.number().finite(),
  }).optional(),
})
const StateWithoutDigestSchema = z.strictObject({
  kind: z.literal(CANONICAL_HISTORY_PUBLICATION_STATE_KIND),
  version: z.literal(CANONICAL_HISTORY_PUBLICATION_STATE_VERSION),
  endpointScopeSha256: Sha256DigestSchema,
  analyticsGenerationId: Sha256DigestSchema,
  sessionPayloadSha256: Sha256DigestSchema,
  dailyPayloadSha256: Sha256DigestSchema,
  sourceManifestSha256: Sha256DigestSchema,
  projectionSha256: Sha256DigestSchema,
  snapshotSha256: Sha256DigestSchema,
  sources: z.array(z.strictObject({
    provider: z.string().min(1),
    pathSha256: Sha256DigestSchema,
    envFingerprint: z.string(),
    fingerprint: FingerprintSchema,
    observationIds: z.array(z.string().min(1)),
    activityIds: z.array(z.string().min(1)),
  })),
})
const StateSchema = StateWithoutDigestSchema.extend({ stateSha256: Sha256DigestSchema })

export class CanonicalHistoryPublicationStateIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalHistoryPublicationStateIntegrityError'
  }
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update('metrora-canonical-history-publication-state-v1')
    .update('\0')
    .update(canonicalizeRfc8785(value))
    .digest('hex')
}

function withoutDigest(value: CanonicalHistoryPublicationStateV1): Omit<CanonicalHistoryPublicationStateV1, 'stateSha256'> {
  const { stateSha256: _stateSha256, ...rest } = value
  return rest
}

export function canonicalHistoryPublicationStatePathV1(dataDir: string): string {
  return join(dataDir, 'history-shadow', 'v1', 'publication-state.v1.json')
}

export function buildCanonicalHistoryPublicationStateV1(input: Omit<CanonicalHistoryPublicationStateV1, 'kind' | 'version' | 'stateSha256'>): CanonicalHistoryPublicationStateV1 {
  const unsigned: Omit<CanonicalHistoryPublicationStateV1, 'stateSha256'> = {
    kind: CANONICAL_HISTORY_PUBLICATION_STATE_KIND,
    version: CANONICAL_HISTORY_PUBLICATION_STATE_VERSION,
    endpointScopeSha256: input.endpointScopeSha256,
    analyticsGenerationId: input.analyticsGenerationId,
    sessionPayloadSha256: input.sessionPayloadSha256,
    dailyPayloadSha256: input.dailyPayloadSha256,
    sourceManifestSha256: input.sourceManifestSha256,
    projectionSha256: input.projectionSha256,
    snapshotSha256: input.snapshotSha256,
    sources: input.sources
      .map(source => ({
        ...source,
        observationIds: [...new Set(source.observationIds)].sort(),
        activityIds: [...new Set(source.activityIds)].sort(),
      }))
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.pathSha256.localeCompare(right.pathSha256)),
  }
  return { ...unsigned, stateSha256: digest(unsigned) }
}

export async function writeCanonicalHistoryPublicationStateV1(
  dataDir: string,
  state: CanonicalHistoryPublicationStateV1,
): Promise<void> {
  await atomicWritePrivateFile(canonicalHistoryPublicationStatePathV1(dataDir), JSON.stringify(state))
}

export async function readCanonicalHistoryPublicationStateV1(
  dataDir: string,
): Promise<CanonicalHistoryPublicationStateV1 | undefined> {
  const bytes = await readOptionalPrivateFile(canonicalHistoryPublicationStatePathV1(dataDir))
  if (!bytes) return undefined
  let parsed: CanonicalHistoryPublicationStateV1
  try {
    parsed = StateSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
  } catch {
    throw new CanonicalHistoryPublicationStateIntegrityError('canonical history publication state is invalid')
  }
  if (digest(withoutDigest(parsed)) !== parsed.stateSha256) {
    throw new CanonicalHistoryPublicationStateIntegrityError('canonical history publication state digest does not match its contents')
  }
  const seen = new Set<string>()
  for (const source of parsed.sources) {
    const key = `${source.provider}\0${source.pathSha256}`
    if (seen.has(key)) {
      throw new CanonicalHistoryPublicationStateIntegrityError('canonical history publication state contains duplicate sources')
    }
    seen.add(key)
  }
  return parsed
}
