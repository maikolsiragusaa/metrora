import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod/v4'

import { Sha256DigestSchema } from '../contracts/v1/common.js'
import { atomicWritePrivateFile, readOptionalPrivateFile } from './atomic-file.js'
import { canonicalHistoryShadowSnapshotSha256V1 } from './canonical-history-cli-headline-index-store.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import { CanonicalHistoryShadowStoreIntegrityError } from './canonical-history-shadow-errors.js'

const RetainedSnapshotSealV1Schema = z.strictObject({
  projectionSha256: Sha256DigestSchema,
  snapshotSha256: Sha256DigestSchema,
  dev: z.number().finite(),
  ino: z.number().finite(),
  mtimeMs: z.number().finite(),
  sizeBytes: z.number().finite(),
})
const RetainedHistoryIndexWithoutDigestV1Schema = z.strictObject({
  kind: z.literal('metrora.canonical-history-retained-index'),
  version: z.literal(1),
  snapshots: z.array(RetainedSnapshotSealV1Schema),
  observations: z.record(z.string(), Sha256DigestSchema),
  activities: z.record(z.string(), z.array(z.string())),
  dailySnapshots: z.record(z.string(), Sha256DigestSchema),
})
const RetainedHistoryIndexV1Schema = RetainedHistoryIndexWithoutDigestV1Schema.extend({
  indexSha256: Sha256DigestSchema,
})

export type CanonicalHistoryShadowProjectionIndexV1 = {
  observations: Map<string, string>
  activities: Map<string, string>
  dailySnapshots: Map<string, string>
}

export type CanonicalHistoryRetainedProjectionIndexV1 = {
  observations: Map<string, string>
  activities: Map<string, string[]>
  dailySnapshots: Map<string, string>
  snapshots: Array<z.infer<typeof RetainedSnapshotSealV1Schema>>
}

type RetainedHistoryPathsV1 = { root: string; snapshots: string }
type RetainedHistoryIndexV1 = z.infer<typeof RetainedHistoryIndexV1Schema>

function snapshotPath(paths: RetainedHistoryPathsV1, digest: string): string {
  return join(paths.snapshots, `${digest}.json`)
}

function retainedPayloadSha256(payload: string): string {
  return createHash('sha256')
    .update('metrora-canonical-history-retained-entity-v1')
    .update('\0')
    .update(payload)
    .digest('hex')
}

function mergeRetainedEntityIndex(target: Map<string, string>, incoming: Map<string, string>, label: string): void {
  for (const [id, payload] of incoming) {
    const digest = retainedPayloadSha256(payload)
    const prior = target.get(id)
    if (prior !== undefined && prior !== digest) {
      throw new CanonicalHistoryShadowStoreIntegrityError(`${label} identity ${id} conflicts with retained shadow history`)
    }
    target.set(id, prior ?? digest)
  }
}

function retainedIndexPath(paths: RetainedHistoryPathsV1): string {
  return join(paths.root, 'retained-index.v1.json')
}

function retainedIndexDigest(value: Omit<RetainedHistoryIndexV1, 'indexSha256'>): string {
  return createHash('sha256')
    .update('metrora-canonical-history-retained-index-v1')
    .update('\0')
    .update(canonicalizeRfc8785(value))
    .digest('hex')
}

function retainedIndexForWrite(retained: CanonicalHistoryRetainedProjectionIndexV1): RetainedHistoryIndexV1 {
  const unsigned: Omit<RetainedHistoryIndexV1, 'indexSha256'> = {
    kind: 'metrora.canonical-history-retained-index',
    version: 1,
    snapshots: [...retained.snapshots].sort((left, right) => left.projectionSha256.localeCompare(right.projectionSha256)),
    observations: Object.fromEntries([...retained.observations.entries()].sort(([left], [right]) => left.localeCompare(right))),
    activities: Object.fromEntries([...retained.activities.entries()].sort(([left], [right]) => left.localeCompare(right))),
    dailySnapshots: Object.fromEntries([...retained.dailySnapshots.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
  return { ...unsigned, indexSha256: retainedIndexDigest(unsigned) }
}

export async function writeCanonicalHistoryRetainedIndexV1(paths: RetainedHistoryPathsV1, retained: CanonicalHistoryRetainedProjectionIndexV1): Promise<void> {
  await atomicWritePrivateFile(retainedIndexPath(paths), JSON.stringify(retainedIndexForWrite(retained)))
}

function snapshotNamesFromSeals(seals: readonly z.infer<typeof RetainedSnapshotSealV1Schema>[]): string[] {
  return seals.map(seal => `${seal.projectionSha256}.json`).sort()
}

async function readCompactRetainedIndex(paths: RetainedHistoryPathsV1): Promise<CanonicalHistoryRetainedProjectionIndexV1 | undefined> {
  const bytes = await readOptionalPrivateFile(retainedIndexPath(paths))
  if (!bytes) return undefined
  let parsed: RetainedHistoryIndexV1
  try {
    parsed = RetainedHistoryIndexV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
    const { indexSha256: _indexSha256, ...unsigned } = parsed
    if (retainedIndexDigest(unsigned) !== parsed.indexSha256) return undefined
  } catch {
    return undefined
  }
  const entries = await readdir(paths.snapshots, { withFileTypes: true })
  const actualNames = entries.filter(entry => entry.isFile() && !entry.name.includes('.metrora-tmp-')).map(entry => entry.name).sort()
  if (actualNames.length !== parsed.snapshots.length || actualNames.some((name, index) => name !== snapshotNamesFromSeals(parsed.snapshots)[index])) return undefined
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.includes('.metrora-tmp-')) continue
    if (!/^([a-f0-9]{64})\.json$/u.test(entry.name)) return undefined
  }
  for (const seal of parsed.snapshots) {
    const info = await stat(snapshotPath(paths, seal.projectionSha256)).catch(() => undefined)
    if (!info || !info.isFile() || info.dev !== seal.dev || info.ino !== seal.ino || info.mtimeMs !== seal.mtimeMs || info.size !== seal.sizeBytes) return undefined
  }
  const retained: CanonicalHistoryRetainedProjectionIndexV1 = {
    observations: new Map(Object.entries(parsed.observations)),
    activities: new Map(Object.entries(parsed.activities)),
    dailySnapshots: new Map(Object.entries(parsed.dailySnapshots)),
    snapshots: parsed.snapshots,
  }
  for (const history of retained.activities.values()) for (const payload of history) decodeActivityPayload(payload)
  return retained
}

export async function readCanonicalHistoryRetainedIndexV1(
  paths: RetainedHistoryPathsV1,
  parseSnapshot: (bytes: Uint8Array, expectedDigest: string) => { index: CanonicalHistoryShadowProjectionIndexV1 },
): Promise<CanonicalHistoryRetainedProjectionIndexV1> {
  const compact = await readCompactRetainedIndex(paths)
  if (compact) return compact
  const retained: CanonicalHistoryRetainedProjectionIndexV1 = { observations: new Map(), activities: new Map(), dailySnapshots: new Map(), snapshots: [] }
  const entries = await readdir(paths.snapshots, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || entry.name.includes('.metrora-tmp-')) continue
    const match = /^([a-f0-9]{64})\.json$/u.exec(entry.name)
    if (!match) throw new CanonicalHistoryShadowStoreIntegrityError(`canonical history shadow contains unexpected snapshot file ${entry.name}`)
    const digest = match[1]!
    const bytes = await readOptionalPrivateFile(join(paths.snapshots, entry.name))
    if (!bytes) throw new CanonicalHistoryShadowStoreIntegrityError(`canonical history shadow snapshot ${entry.name} disappeared during reconciliation`)
    const parsed = parseSnapshot(bytes, digest)
    const info = await stat(join(paths.snapshots, entry.name))
    retained.snapshots.push({ projectionSha256: digest, snapshotSha256: canonicalHistoryShadowSnapshotSha256V1(bytes), dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, sizeBytes: info.size })
    mergeRetainedEntityIndex(retained.observations, parsed.index.observations, 'observation')
    for (const [id, payload] of parsed.index.activities) {
      const history = retained.activities.get(id) ?? []
      for (const prior of history) if (!activityPayloadsCanBeRevisions(prior, payload)) throw new CanonicalHistoryShadowStoreIntegrityError(`activity identity ${id} conflicts with retained shadow history`)
      if (!history.includes(payload)) history.push(payload)
      retained.activities.set(id, history)
    }
    mergeRetainedEntityIndex(retained.dailySnapshots, parsed.index.dailySnapshots, 'daily snapshot')
  }
  await writeCanonicalHistoryRetainedIndexV1(paths, retained)
  return retained
}

type ActivityPayload = { collector: string; timestamp: string; observationIds: string[] }

function decodeActivityPayload(payload: string): ActivityPayload {
  let value: unknown
  try { value = JSON.parse(payload) } catch { throw new CanonicalHistoryShadowStoreIntegrityError('retained activity payload is not valid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanonicalHistoryShadowStoreIntegrityError('retained activity must be an object')
  const record = value as Record<string, unknown>
  if (typeof record.collector !== 'string' || typeof record.timestamp !== 'string' || !Array.isArray(record.observationIds) || record.observationIds.some(id => typeof id !== 'string')) throw new CanonicalHistoryShadowStoreIntegrityError('retained activity payload is malformed')
  return { collector: record.collector, timestamp: record.timestamp, observationIds: [...record.observationIds] as string[] }
}

export function canonicalHistoryActivityPayloadIsOrderedExtensionV1(priorPayload: string, nextPayload: string): boolean {
  const prior = decodeActivityPayload(priorPayload)
  const next = decodeActivityPayload(nextPayload)
  return prior.collector === next.collector && prior.timestamp === next.timestamp
    && prior.observationIds.length <= next.observationIds.length
    && prior.observationIds.every((id, index) => next.observationIds[index] === id)
}

function activityPayloadsCanBeRevisions(leftPayload: string, rightPayload: string): boolean {
  return canonicalHistoryActivityPayloadIsOrderedExtensionV1(leftPayload, rightPayload) || canonicalHistoryActivityPayloadIsOrderedExtensionV1(rightPayload, leftPayload)
}

export function assertCompatibleWithCanonicalHistoryRetainedV1(retained: CanonicalHistoryRetainedProjectionIndexV1, current: CanonicalHistoryShadowProjectionIndexV1): void {
  for (const [label, previous, next] of [['observation', retained.observations, current.observations], ['daily snapshot', retained.dailySnapshots, current.dailySnapshots]] as const) {
    for (const [id, payload] of next) if (previous.get(id) !== undefined && previous.get(id) !== retainedPayloadSha256(payload)) throw new CanonicalHistoryShadowStoreIntegrityError(`${label} identity ${id} conflicts with retained shadow history`)
  }
}

export function assertActivitiesCompatibleWithCanonicalHistoryRetainedV1(retained: Map<string, string[]>, previous: Map<string, string> | undefined, current: Map<string, string>): void {
  for (const [id, payload] of current) {
    for (const prior of retained.get(id) ?? []) if (prior !== payload && !canonicalHistoryActivityPayloadIsOrderedExtensionV1(prior, payload)) throw new CanonicalHistoryShadowStoreIntegrityError(`activity identity ${id} conflicts with retained shadow history`)
    const previousPayload = previous?.get(id)
    if (previousPayload !== undefined && previousPayload !== payload && !canonicalHistoryActivityPayloadIsOrderedExtensionV1(previousPayload, payload)) throw new CanonicalHistoryShadowStoreIntegrityError(`activity identity ${id} resolved to a non-monotonic revision`)
  }
}

export function addCurrentProjectionToCanonicalHistoryRetainedV1(
  retained: CanonicalHistoryRetainedProjectionIndexV1,
  current: CanonicalHistoryShadowProjectionIndexV1,
  projectionSha256: string,
  snapshotSha256: string,
  info: { dev: number; ino: number; mtimeMs: number; size: number },
): void {
  mergeRetainedEntityIndex(retained.observations, current.observations, 'observation')
  for (const [id, payload] of current.activities) {
    const history = retained.activities.get(id) ?? []
    for (const prior of history) if (!activityPayloadsCanBeRevisions(prior, payload)) throw new CanonicalHistoryShadowStoreIntegrityError(`activity identity ${id} conflicts with retained shadow history`)
    if (!history.includes(payload)) history.push(payload)
    retained.activities.set(id, history)
  }
  mergeRetainedEntityIndex(retained.dailySnapshots, current.dailySnapshots, 'daily snapshot')
  const prior = retained.snapshots.find(value => value.projectionSha256 === projectionSha256)
  if (prior) {
    if (prior.snapshotSha256 !== snapshotSha256 || prior.dev !== info.dev || prior.ino !== info.ino || prior.mtimeMs !== info.mtimeMs || prior.sizeBytes !== info.size) throw new CanonicalHistoryShadowStoreIntegrityError('retained snapshot seal changed unexpectedly')
  } else retained.snapshots.push({ projectionSha256: projectionSha256, snapshotSha256, dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, sizeBytes: info.size })
}
