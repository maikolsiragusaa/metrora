import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
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
  updatedAt: TimestampSchema,
})

export type CanonicalHistoryShadowSnapshotV1 = z.infer<typeof CanonicalHistoryShadowSnapshotV1Schema>
export type CanonicalHistoryShadowHeadV1 = z.infer<typeof CanonicalHistoryShadowHeadV1Schema>

export type CanonicalHistoryShadowStoreOptions = {
  dataDir?: string
  now?: () => Date
}

export type CanonicalHistoryShadowEntityReconciliationV1 = {
  added: number
  unchanged: number
  retainedOnly: number
}

export type CanonicalHistoryShadowReconciliationV1 = {
  observations: CanonicalHistoryShadowEntityReconciliationV1
  activities: CanonicalHistoryShadowEntityReconciliationV1
  dailySnapshots: CanonicalHistoryShadowEntityReconciliationV1
}

export type PersistCanonicalHistoryShadowResultV1 = {
  status: 'initialized' | 'unchanged' | 'advanced' | 'recovered-head'
  projectionSha256: string
  previousProjectionSha256?: string
  reconciliation: CanonicalHistoryShadowReconciliationV1
}

export class CanonicalHistoryShadowStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalHistoryShadowStoreIntegrityError'
  }
}

type EntityIndex = Map<string, string>

type ProjectionIndex = {
  observations: EntityIndex
  activities: EntityIndex
  dailySnapshots: EntityIndex
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

function indexProjection(value: unknown): ProjectionIndex {
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

function mergeEntityIndex(target: EntityIndex, incoming: EntityIndex, label: string): void {
  for (const [id, payload] of incoming) {
    const prior = target.get(id)
    if (prior !== undefined && prior !== payload) {
      throw new CanonicalHistoryShadowStoreIntegrityError(
        `${label} identity ${id} conflicts with retained shadow history`,
      )
    }
    target.set(id, prior ?? payload)
  }
}

async function readRetainedIndex(
  paths: ReturnType<typeof canonicalHistoryShadowPathsV1>,
): Promise<ProjectionIndex> {
  const retained: ProjectionIndex = {
    observations: new Map(),
    activities: new Map(),
    dailySnapshots: new Map(),
  }
  const entries = await readdir(paths.snapshots, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || entry.name.includes('.metrora-tmp-')) continue
    const match = /^([a-f0-9]{64})\.json$/u.exec(entry.name)
    if (!match) {
      throw new CanonicalHistoryShadowStoreIntegrityError(
        `canonical history shadow contains unexpected snapshot file ${entry.name}`,
      )
    }
    const digest = match[1]!
    const bytes = await readOptionalPrivateFile(join(paths.snapshots, entry.name))
    if (!bytes) {
      throw new CanonicalHistoryShadowStoreIntegrityError(
        `canonical history shadow snapshot ${entry.name} disappeared during reconciliation`,
      )
    }
    const parsed = parseSnapshot(bytes, digest)
    mergeEntityIndex(retained.observations, parsed.index.observations, 'observation')
    mergeEntityIndex(retained.activities, parsed.index.activities, 'activity')
    mergeEntityIndex(retained.dailySnapshots, parsed.index.dailySnapshots, 'daily snapshot')
  }
  return retained
}

function assertCompatibleWithRetainedHistory(
  retained: ProjectionIndex,
  current: ProjectionIndex,
): void {
  for (const [label, previous, next] of [
    ['observation', retained.observations, current.observations],
    ['activity', retained.activities, current.activities],
    ['daily snapshot', retained.dailySnapshots, current.dailySnapshots],
  ] as const) {
    for (const [id, payload] of next) {
      const prior = previous.get(id)
      if (prior !== undefined && prior !== payload) {
        throw new CanonicalHistoryShadowStoreIntegrityError(
          `${label} identity ${id} conflicts with retained shadow history`,
        )
      }
    }
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
  previous: ProjectionIndex | undefined,
  current: ProjectionIndex,
): CanonicalHistoryShadowReconciliationV1 {
  return {
    observations: reconcileEntities(previous?.observations, current.observations, 'observation'),
    activities: reconcileEntities(previous?.activities, current.activities, 'activity'),
    dailySnapshots: reconcileEntities(previous?.dailySnapshots, current.dailySnapshots, 'daily snapshot'),
  }
}

export function canonicalHistoryShadowPathsV1(dataDir: string) {
  const root = join(dataDir, 'history-shadow', 'v1')
  return {
    root,
    snapshots: join(root, 'snapshots'),
    head: join(root, 'head.json'),
  }
}

function snapshotPath(paths: ReturnType<typeof canonicalHistoryShadowPathsV1>, digest: string): string {
  return join(paths.snapshots, `${digest}.json`)
}

async function prepare(paths: ReturnType<typeof canonicalHistoryShadowPathsV1>): Promise<void> {
  await ensurePrivateDirectory(paths.snapshots)
  await cleanupStaleAtomicTemps(paths.snapshots)
  await cleanupStaleAtomicTemps(paths.root)
}

function parseSnapshot(
  bytes: Uint8Array,
  expectedDigest: string,
): { record: CanonicalHistoryShadowSnapshotV1; index: ProjectionIndex } {
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

async function readHeadSnapshot(
  paths: ReturnType<typeof canonicalHistoryShadowPathsV1>,
): Promise<{ head: CanonicalHistoryShadowHeadV1; snapshot: CanonicalHistoryShadowSnapshotV1; index: ProjectionIndex } | undefined> {
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
    const previous = await readHeadSnapshot(paths)
    const retained = await readRetainedIndex(paths)
    assertCompatibleWithRetainedHistory(retained, currentIndex)
    const previousDigest = previous?.head.projectionSha256
    const targetPath = snapshotPath(paths, projectionSha256)
    const targetBytes = await readOptionalPrivateFile(targetPath)
    const target = targetBytes ? parseSnapshot(targetBytes, projectionSha256) : undefined

    if (
      target &&
      canonicalProjectionJson(target.record.projection) !== canonicalProjectionJson(projection)
    ) {
      throw new CanonicalHistoryShadowStoreIntegrityError('canonical history shadow digest collision')
    }

    const reconciliation = reconcileProjection(previous?.index, currentIndex)

    if (previousDigest === projectionSha256) {
      return {
        status: 'unchanged' as const,
        projectionSha256,
        reconciliation,
      }
    }

    if (!target) {
      const record = CanonicalHistoryShadowSnapshotV1Schema.parse({
        kind: CANONICAL_HISTORY_SHADOW_SNAPSHOT_KIND,
        version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
        projectionSha256,
        createdAt: now().toISOString(),
        projection,
      })
      await atomicWritePrivateFile(targetPath, JSON.stringify(record))
    }

    const head = CanonicalHistoryShadowHeadV1Schema.parse({
      kind: CANONICAL_HISTORY_SHADOW_HEAD_KIND,
      version: CANONICAL_HISTORY_SHADOW_STORE_VERSION,
      projectionSha256,
      updatedAt: now().toISOString(),
    })
    await atomicWritePrivateFile(paths.head, JSON.stringify(head))

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
