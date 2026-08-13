import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod/v4'

import { Sha256DigestSchema, TimestampSchema } from '../contracts/v1/common.js'
import {
  atomicWritePrivateFile,
  cleanupStaleAtomicTemps,
  ensurePrivateDirectory,
  readOptionalPrivateFile,
} from './atomic-file.js'
import {
  CANONICAL_HISTORY_READ_PROJECTION_VERSION,
  type CanonicalHistoryReadProjectionV1,
} from './canonical-history-read-projection.js'
import { authorityGenerationForSidecarV1, type CurrentCacheAuthorityGenerationV1 } from '../cache-generation.js'
import {
  canonicalHistoryShadowSnapshotSha256V1,
  ensureCanonicalHistoryCliHeadlineIndexV1,
  prepareCanonicalHistoryCliHeadlineIndexStoreV1,
} from './canonical-history-cli-headline-index-store.js'
import {
  buildCanonicalHistoryPublicationStateV1,
  writeCanonicalHistoryPublicationStateV1,
  type CanonicalHistoryPublicationSourceV1,
} from './canonical-history-publication-state.js'
import {
  addCurrentProjectionToCanonicalHistoryRetainedV1,
  assertActivitiesCompatibleWithCanonicalHistoryRetainedV1,
  assertCompatibleWithCanonicalHistoryRetainedV1,
  canonicalHistoryActivityPayloadIsOrderedExtensionV1,
  readCanonicalHistoryRetainedIndexV1,
  writeCanonicalHistoryRetainedIndexV1,
} from './canonical-history-retained-index.js'
import { CanonicalHistoryShadowStoreIntegrityError } from './canonical-history-shadow-errors.js'
import {
  clearCanonicalHistoryShadowTrustMemoV1 as clearPublicationTrustMemoV1,
  readCanonicalHistoryPublicationTrustV1,
  rememberCanonicalHistoryPublicationTrustV1,
  type CanonicalHistoryShadowPublicationTrustV1,
} from './canonical-history-publication-trust.js'
import { defaultMetroraDataDir } from './endpoint-identity.js'
import { withLocalStateLease } from './local-state-lease.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'

export const CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND = 'metrora.canonical-history-shadow-snapshot' as const
export const CANONICAL_HISTORY_SHADOW_HEAD_KIND = 'metrora.canonical-history-shadow-head' as const
export const CANONICAL_HISTORY_SHADOW_STORE_VERSION = 1 as const

const CanonicalHistoryShadowSnapshotV1Schema = z.strictObject({
  kind: z.literal(CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND),
  version: z.literal(CANONICAL_HISTORY_SHADOW_STORE_VERSION),
  projectionSha256: Sha256DigestSchema,
  createdAt: TimestampSchema,
  projection: z.unknown(),
})

const CanonicalHistoryShadowHeadV1Schema = z.strictObject({
  kind: z.literal(CANONICAL_HISTORY_SHADOW_HEAD_KIND),
  version: z.literal(CANONICAL_HISTORY_SHADOW_STORE_VERSION),
  projectionSha256: Sha256DigestSchema,
  snapshotSha256: Sha256DigestSchema.optional(),
  updatedAt: TimestampSchema,
})

export type CanonicalHistoryShadowSnapshotV1 = z.infer<typeof CanonicalHistoryShadowSnapshotV1Schema>
export type CanonicalHistoryShadowHeadV1 = z.infer<typeof CanonicalHistoryShadowHeadV1Schema>

export type ReadCanonicalHistoryShadowProjectionV1 = { head: CanonicalHistoryShadowHeadV1; snapshot: CanonicalHistoryShadowSnapshotV1; projection: CanonicalHistoryReadProjectionV1 }

export type CanonicalHistoryShadowStoreOptions = {
  dataDir?: string
  now?: () => Date
  authorityGeneration?: CurrentCacheAuthorityGenerationV1
  analyticsGenerationId?: string
  endpointScopeSha256?: string
  sourceIndex?: CanonicalHistoryPublicationSourceV1[]
  previousState?: CanonicalHistoryShadowLoadedStateV1
  /** Optional diagnostic timing hook; it never changes publication semantics. */
  onHeadlineIndexPersisted?: (elapsedMs: number) => void
}

export type CanonicalHistoryShadowEntityReconciliationV1 = {
  added: number
  unchanged: number
  retainedOnly: number
}

export type CanonicalHistoryShadowActivityReconciliationV1 = CanonicalHistoryShadowEntityReconciliationV1 & {
  revised: number
}

export type CanonicalHistoryShadowReconciliationV1 = {
  observations: CanonicalHistoryShadowEntityReconciliationV1
  activities: CanonicalHistoryShadowActivityReconciliationV1
  dailySnapshots: CanonicalHistoryShadowEntityReconciliationV1
}

export type PersistCanonicalHistoryShadowResultV1 = {
  status: 'initialized' | 'unchanged' | 'advanced' | 'recovered-head'
  projectionSha256: string
  previousProjectionSha256?: string
  reconciliation: CanonicalHistoryShadowReconciliationV1
}

export { CanonicalHistoryShadowStoreIntegrityError } from './canonical-history-shadow-errors.js'

type EntityIndex = Map<string, string>

export type CanonicalHistoryShadowProjectionIndexV1 = {
  observations: EntityIndex
  activities: EntityIndex
  dailySnapshots: EntityIndex
}

export type CanonicalHistoryShadowLoadedStateV1 = {
  head: CanonicalHistoryShadowHeadV1
  snapshot: CanonicalHistoryShadowSnapshotV1
  index: CanonicalHistoryShadowProjectionIndexV1
}

const FORBIDDEN_PERSISTED_KEYS = new Set([
  'path',
  'sourcePath',
  'projectPath',
  'sessionId',
  'deduplicationKey',
  'privateDeduplicationKey',
  'userMessage',
  'assistantMessage',
  'prompt',
  'response',
  'command',
  'commands',
  'toolInput',
  'toolArguments',
])

function canonicalProjectionJson(value: unknown): string {
  try {
    return canonicalizeRfc8785(value)
  } catch {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow projection is not valid canonical JSON')
  }
}

export function canonicalHistoryShadowProjectionSha256V1(value: unknown): string {
  return createHash('sha256')
    .update('metrora-canonical-history-shadow-projection-v1')
    .update('\0')
    .update(canonicalProjectionJson(value))
    .digest('hex')
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalHistoryShadowStoreIntegrityError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertPrivacyBoundary(value: unknown, path = 'projection'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertPrivacyBoundary(child, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PERSISTED_KEYS.has(key)) {
      throw new CanonicalHistoryShadowStoreIntegrityError(`${path}.${key} is forbidden in shadow history`)
    }
    assertPrivacyBoundary(child, `${path}.${key}`)
  }
}

function indexEntities(
  input: unknown,
  collection: string,
  idField: string,
): EntityIndex {
  if (!Array.isArray(input)) {
    throw new CanonicalHistoryShadowStoreIntegrityError(`${collection} must be an array`)
  }
  const index = new Map<string, string>()
  for (const [position, value] of input.entries()) {
    const record = objectRecord(value, `${collection}[${position}]`)
    const id = record[idField]
    if (typeof id !== 'string' || id.trim() === '') {
      throw new CanonicalHistoryShadowStoreIntegrityError(`${collection}[${position}].${idField} must be a non-empty string`)
    }
    if (index.has(id)) {
      throw new CanonicalHistoryShadowStoreIntegrityError(`${collection} contains duplicate identity ${id}`)
    }
    index.set(id, canonicalProjectionJson(record))
  }
  return index
}

function indexProjection(value: unknown): CanonicalHistoryShadowProjectionIndexV1 {
  const projection = objectRecord(value, 'projection')
  if (projection.version !== CANONICAL_HISTORY_READ_PROJECTION_VERSION) {
    throw new CanonicalHistoryShadowStoreIntegrityError('shadow projection has an unsupported version')
  }
  const authority = objectRecord(projection.authority, 'projection.authority')
  if (
    authority.observations !== 'shadow-session-cache' ||
    authority.activities !== 'shadow-session-cache' ||
    authority.totals !== 'trusted-daily-cache' ||
    authority.additiveAcrossAuthorities !== false
  ) {
    throw new CanonicalHistoryShadowStoreIntegrityError('shadow projection authority boundary is invalid')
  }
  assertPrivacyBoundary(projection)
  return {
    observations: indexEntities(projection.observations, 'projection.observations', 'observationId'),
    activities: indexEntities(projection.activities, 'projection.activities', 'activityId'),
    dailySnapshots: indexEntities(projection.dailySnapshots, 'projection.dailySnapshots', 'snapshotId'),
  }
}

function reconcileEntities(
  previous: EntityIndex | undefined,
  current: EntityIndex,
  label: string,
): CanonicalHistoryShadowEntityReconciliationV1 {
  if (!previous) return { added: current.size, unchanged: 0, retainedOnly: 0 }
  let added = 0
  let unchanged = 0
  for (const [id, payload] of current) {
    const prior = previous.get(id)
    if (prior === undefined) {
      added++
      continue
    }
    if (prior !== payload) {
      throw new CanonicalHistoryShadowStoreIntegrityError(`${label} identity ${id} resolved to a conflicting payload`)
    }
    unchanged++
  }
  let retainedOnly = 0
  for (const id of previous.keys()) {
    if (!current.has(id)) retainedOnly++
  }
  return { added, unchanged, retainedOnly }
}

function reconcileProjection(
  previous: CanonicalHistoryShadowProjectionIndexV1 | undefined,
  current: CanonicalHistoryShadowProjectionIndexV1,
): CanonicalHistoryShadowReconciliationV1 {
  const activities = reconcileActivities(previous?.activities, current.activities)
  return {
    observations: reconcileEntities(previous?.observations, current.observations, 'observation'),
    activities,
    dailySnapshots: reconcileEntities(previous?.dailySnapshots, current.dailySnapshots, 'daily snapshot'),
  }
}

function reconcileActivities(
  previous: EntityIndex | undefined,
  current: EntityIndex,
): CanonicalHistoryShadowActivityReconciliationV1 {
  if (!previous) return { added: current.size, unchanged: 0, revised: 0, retainedOnly: 0 }
  let added = 0
  let unchanged = 0
  let revised = 0
  for (const [id, payload] of current) {
    const prior = previous.get(id)
    if (prior === undefined) {
      added++
      continue
    }
    if (prior === payload) {
      unchanged++
      continue
    }
    if (!canonicalHistoryActivityPayloadIsOrderedExtensionV1(prior, payload)) {
      throw new CanonicalHistoryShadowStoreIntegrityError(
        `activity identity ${id} resolved to a conflicting payload`,
      )
    }
    revised++
  }
  let retainedOnly = 0
  for (const id of previous.keys()) {
    if (!current.has(id)) retainedOnly++
  }
  return { added, unchanged, revised, retainedOnly }
}

export type CanonicalHistoryShadowPathsV1 = {
  root: string
  snapshots: string
  headlineIndexes: string
  head: string
}

export function canonicalHistoryShadowPathsV1(dataDir: string): CanonicalHistoryShadowPathsV1 {
  const root = join(dataDir, 'history-shadow', 'v1')
  return {
    root,
    snapshots: join(root, 'snapshots'),
    headlineIndexes: join(root, 'headline-indexes'),
    head: join(root, 'head.json'),
  }
}

function snapshotPath(paths: ReturnType<typeof canonicalHistoryShadowPathsV1>, digest: string): string {
  return join(paths.snapshots, `${digest}.json`)
}

async function prepare(paths: ReturnType<typeof canonicalHistoryShadowPathsV1>): Promise<void> {
  await ensurePrivateDirectory(paths.snapshots)
  await cleanupStaleAtomicTemps(paths.snapshots)
  await prepareCanonicalHistoryCliHeadlineIndexStoreV1(paths.headlineIndexes)
  await cleanupStaleAtomicTemps(paths.root)
}

function parseSnapshot(
  bytes: Uint8Array,
  expectedDigest: string,
): { record: CanonicalHistoryShadowSnapshotV1; index: CanonicalHistoryShadowProjectionIndexV1 } {
  let record: CanonicalHistoryShadowSnapshotV1
  try {
    record = CanonicalHistoryShadowSnapshotV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
  } catch {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow snapshot is invalid')
  }
  if (record.projectionSha256 !== expectedDigest) {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow snapshot names a different digest')
  }
  const actualDigest = canonicalHistoryShadowProjectionSha256V1(record.projection)
  if (actualDigest !== expectedDigest) {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow snapshot digest does not match its projection')
  }
  return { record, index: indexProjection(record.projection) }
}

function parseHead(bytes: Uint8Array): CanonicalHistoryShadowHeadV1 {
  try {
    return CanonicalHistoryShadowHeadV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
  } catch {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head is invalid')
  }
}

export type { CanonicalHistoryShadowPublicationTrustV1 } from './canonical-history-publication-trust.js'
export const clearCanonicalHistoryShadowTrustMemoV1 = clearPublicationTrustMemoV1

export async function readCanonicalHistoryShadowPublicationTrustV1(
  options: Pick<CanonicalHistoryShadowStoreOptions, 'dataDir'> = {},
): Promise<CanonicalHistoryShadowPublicationTrustV1 | undefined> {
  const dataDir = options.dataDir ?? defaultMetroraDataDir()
  const paths = canonicalHistoryShadowPathsV1(dataDir)
  return readCanonicalHistoryPublicationTrustV1({
    dataDir,
    paths,
    parseHead,
    parseSnapshot,
  })
}

async function readHeadSnapshot(
  paths: ReturnType<typeof canonicalHistoryShadowPathsV1>,
): Promise<CanonicalHistoryShadowLoadedStateV1 | undefined> {
  const headBytes = await readOptionalPrivateFile(paths.head)
  if (!headBytes) return undefined
  const head = parseHead(headBytes)
  const snapshotBytes = await readOptionalPrivateFile(snapshotPath(paths, head.projectionSha256))
  if (!snapshotBytes) {
    throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow head points to a missing snapshot')
  }
  const parsed = parseSnapshot(snapshotBytes, head.projectionSha256)
  return { head, snapshot: parsed.record, index: parsed.index }
}

async function usePreviousStateIfCurrent(
  paths: ReturnType<typeof canonicalHistoryShadowPathsV1>,
  candidate: CanonicalHistoryShadowLoadedStateV1 | undefined,
): Promise<CanonicalHistoryShadowLoadedStateV1 | undefined> {
  if (!candidate) return readHeadSnapshot(paths)
  const headBytes = await readOptionalPrivateFile(paths.head)
  if (!headBytes) return readHeadSnapshot(paths)
  const head = parseHead(headBytes)
  if (
    head.projectionSha256 === candidate.head.projectionSha256
    && head.snapshotSha256 === candidate.head.snapshotSha256
  ) return candidate
  return readHeadSnapshot(paths)
}

export async function persistCanonicalHistoryShadowV1(
  projectionInput: CanonicalHistoryReadProjectionV1,
  options: CanonicalHistoryShadowStoreOptions = {},
): Promise<PersistCanonicalHistoryShadowResultV1> {
  const dataDir = options.dataDir ?? defaultMetroraDataDir()
  const now = options.now ?? (() => new Date())
  const paths = canonicalHistoryShadowPathsV1(dataDir)
  const projection = structuredClone(projectionInput)
  const currentIndex = indexProjection(projection)
  const projectionSha256 = canonicalHistoryShadowProjectionSha256V1(projection)
  await prepare(paths)

  return withLocalStateLease(paths.root, async () => {
    // A compact retained index is acceleration evidence only. If this is the
    // first publication in a process with an existing head, establish the
    // canonical deep-validation trust boundary before reading it.
    await readCanonicalHistoryShadowPublicationTrustV1({ dataDir })
    const previous = await usePreviousStateIfCurrent(paths, options.previousState)
    const retained = await readCanonicalHistoryRetainedIndexV1(paths, parseSnapshot)
    assertCompatibleWithCanonicalHistoryRetainedV1(retained, currentIndex)
    assertActivitiesCompatibleWithCanonicalHistoryRetainedV1(retained.activities, previous?.index.activities, currentIndex.activities)
    const previousDigest = previous?.head.projectionSha256
    const reconciliation = reconcileProjection(previous?.index, currentIndex)
    const targetPath = snapshotPath(paths, projectionSha256)
    const targetBytes = await readOptionalPrivateFile(targetPath)
    const target = targetBytes ? parseSnapshot(targetBytes, projectionSha256) : undefined

    if (target && canonicalProjectionJson(target.record.projection) !== canonicalProjectionJson(projection)) {
      throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow digest collision')
    }

    let immutableSnapshotBytes = targetBytes
    if (!target) {
      const record = CanonicalHistoryShadowSnapshotV1Schema.parse({
        kind: CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND,
        version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
        projectionSha256,
        createdAt: now().toISOString(),
        projection,
      })
      immutableSnapshotBytes = Buffer.from(JSON.stringify(record), 'utf-8')
      await atomicWritePrivateFile(targetPath, immutableSnapshotBytes)
    }
    if (!immutableSnapshotBytes) throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow snapshot bytes are unavailable')
    const snapshotSha256 = canonicalHistoryShadowSnapshotSha256V1(immutableSnapshotBytes)
    const targetInfo = await stat(targetPath)
    addCurrentProjectionToCanonicalHistoryRetainedV1(retained, currentIndex, projectionSha256, snapshotSha256, targetInfo)
    await writeCanonicalHistoryRetainedIndexV1(paths, retained)

    const headlineIndexStartedAt = performance.now()
    await ensureCanonicalHistoryCliHeadlineIndexV1({
      dataDir,
      projection,
      projectionSha256,
      snapshotBytes: immutableSnapshotBytes,
      authorityGeneration: options.authorityGeneration
        ? {
            ...authorityGenerationForSidecarV1(options.authorityGeneration),
            ...(options.analyticsGenerationId ? { analyticsGenerationId: options.analyticsGenerationId } : {}),
            ...(options.endpointScopeSha256 ? { endpointScopeSha256: options.endpointScopeSha256 } : {}),
          }
        : undefined,
      previous: previous
        ? {
            projection: previous.snapshot.projection as CanonicalHistoryReadProjectionV1,
            projectionSha256: previous.head.projectionSha256,
            snapshotSha256: previous.head.snapshotSha256 ?? canonicalHistoryShadowSnapshotSha256V1(
              Buffer.from(JSON.stringify(previous.snapshot), 'utf8'),
            ),
          }
        : undefined,
    })
    options.onHeadlineIndexPersisted?.(performance.now() - headlineIndexStartedAt)

    if (
      options.authorityGeneration
      && options.analyticsGenerationId
      && options.endpointScopeSha256
      && options.sourceIndex
    ) {
      const state = buildCanonicalHistoryPublicationStateV1({
        endpointScopeSha256: options.endpointScopeSha256,
        analyticsGenerationId: options.analyticsGenerationId,
        sessionPayloadSha256: options.authorityGeneration.session.payloadSha256,
        dailyPayloadSha256: options.authorityGeneration.daily.payloadSha256,
        sourceManifestSha256: options.authorityGeneration.session.sourceManifestSha256,
        projectionSha256,
        snapshotSha256,
        sources: options.sourceIndex,
      })
      await writeCanonicalHistoryPublicationStateV1(dataDir, state)
    }

    let head: CanonicalHistoryShadowHeadV1
    if (previousDigest === projectionSha256 && previous?.head.snapshotSha256 === snapshotSha256) {
      head = previous.head
    } else {
      head = CanonicalHistoryShadowHeadV1Schema.parse({
        kind: CANONICAL_HISTORY_SHADOW_HEAD_KIND,
        version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
        projectionSha256,
        snapshotSha256,
        updatedAt: now().toISOString(),
      })
      await atomicWritePrivateFile(paths.head, JSON.stringify(head))
    }
    await rememberCanonicalHistoryPublicationTrustV1(dataDir, paths, head, retained)

    if (previousDigest === projectionSha256 && previous?.head.snapshotSha256 === snapshotSha256) {
      return {
        status: 'unchanged' as const,
        projectionSha256,
        reconciliation,
      }
    }

    return {
      status: previous
        ? 'advanced' as const
        : target
          ? 'recovered-head' as const
          : 'initialized' as const,
      projectionSha256,
      ...(previousDigest ? { previousProjectionSha256: previousDigest } : {}),
      reconciliation,
    }
  })
}

export async function readCanonicalHistoryShadowHeadV1(
  options: Pick<CanonicalHistoryShadowStoreOptions, 'dataDir'> = {},
): Promise<CanonicalHistoryShadowHeadV1 | undefined> {
  const paths = canonicalHistoryShadowPathsV1(options.dataDir ?? defaultMetroraDataDir())
  const loaded = await readHeadSnapshot(paths)
  return loaded?.head
}

export async function readCanonicalHistoryShadowStateV1(
  options: Pick<CanonicalHistoryShadowStoreOptions, 'dataDir'> = {},
): Promise<CanonicalHistoryShadowLoadedStateV1 | undefined> {
  const paths = canonicalHistoryShadowPathsV1(options.dataDir ?? defaultMetroraDataDir())
  return readHeadSnapshot(paths)
}

export function parseCanonicalHistoryShadowHeadV1(bytes: Uint8Array): CanonicalHistoryShadowHeadV1 {
  return parseHead(bytes)
}

export async function readCanonicalHistoryShadowProjectionV1(
  options: Pick<CanonicalHistoryShadowStoreOptions, 'dataDir'> = {},
): Promise<ReadCanonicalHistoryShadowProjectionV1 | undefined> {
  const paths = canonicalHistoryShadowPathsV1(options.dataDir ?? defaultMetroraDataDir())
  const loaded = await readHeadSnapshot(paths)
  if (!loaded) return undefined
  return {
    head: loaded.head,
    snapshot: loaded.snapshot,
    projection: loaded.snapshot.projection as CanonicalHistoryReadProjectionV1,
  }
}
