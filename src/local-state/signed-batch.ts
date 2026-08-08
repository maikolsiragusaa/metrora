import { createHash, createPublicKey, verify } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod/v4'

import {
  MeasurementBatchV1Schema,
  type MeasurementBatchV1,
} from '../contracts/v1/measurement.js'
import {
  OpaqueIdSchema,
  PositiveIntegerSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '../contracts/v1/common.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import { atomicWritePrivateFile, ensurePrivateDirectory, readOptionalPrivateFile } from './atomic-file.js'
import {
  signWithLocalEndpointIdentityV1,
  type LoadedLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import { withLocalStateLease } from './local-state-lease.js'
import {
  acknowledgeMeasurementEventV1,
  scanMeasurementOutboxV1,
  type LocalMeasurementOutboxRecordV1,
} from './measurement-outbox.js'

export const LOCAL_SIGNED_BATCH_KIND = 'metrora.local-signed-measurement-batch' as const
export const LOCAL_SIGNED_BATCH_ACK_KIND = 'metrora.local-signed-measurement-batch-ack' as const

const CanonicalBase64Schema = z.string().min(1).refine(value => {
  try { return Buffer.from(value, 'base64').toString('base64') === value } catch { return false }
}, 'must be canonical base64')

const BatchRangeV1Schema = z.strictObject({
  firstSequence: PositiveIntegerSchema,
  lastSequence: PositiveIntegerSchema,
  eventCount: PositiveIntegerSchema,
})

export const LocalSignedMeasurementBatchV1Schema = z.strictObject({
  kind: z.literal(LOCAL_SIGNED_BATCH_KIND),
  version: z.literal(1),
  canonicalization: z.literal('RFC8785'),
  range: BatchRangeV1Schema,
  batchSha256: Sha256DigestSchema,
  signedPayloadSha256: Sha256DigestSchema,
  batch: MeasurementBatchV1Schema,
  signature: z.strictObject({
    algorithm: z.literal('ed25519'),
    identityGeneration: PositiveIntegerSchema,
    publicKeySpkiBase64: CanonicalBase64Schema,
    publicKeyFingerprintSha256: Sha256DigestSchema,
    signatureBase64: CanonicalBase64Schema,
  }),
})

export const LocalSignedMeasurementBatchAckV1Schema = z.strictObject({
  kind: z.literal(LOCAL_SIGNED_BATCH_ACK_KIND),
  version: z.literal(1),
  batchId: OpaqueIdSchema,
  batchSha256: Sha256DigestSchema,
  acceptedThroughSequence: PositiveIntegerSchema,
  acknowledgedAt: TimestampSchema,
  receiptId: z.string().trim().min(1).max(200),
})

export type LocalSignedMeasurementBatchV1 = z.infer<typeof LocalSignedMeasurementBatchV1Schema>
export type LocalSignedMeasurementBatchAckV1 = z.infer<typeof LocalSignedMeasurementBatchAckV1Schema>

type BatchRangeV1 = z.infer<typeof BatchRangeV1Schema>

export type CreateSignedMeasurementBatchV1Options = {
  dataDir: string
  identity: LoadedLocalEndpointIdentityV1
  metroraVersion: string
  adapterSetSha256: string
  openTelemetryGenAiVersion: string
  /** Frozen public batch v1 has no top-level workspace field. When supplied,
   * every stored and candidate event is authorized against this workspace. */
  workspaceId?: string
  maxEvents?: number
  now?: () => Date
}

export type SignedMeasurementBatchStoreOptions = {
  dataDir: string
  endpointId: string
  workspaceId?: string
}

export type LocalSignedMeasurementBatchStateV1 = {
  signed: LocalSignedMeasurementBatchV1
  acknowledgement?: LocalSignedMeasurementBatchAckV1
}

export type VerifyLocalSignedMeasurementBatchV1Options = {
  endpointId: string
  workspaceId?: string
  expectedFile?: string
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function batchPaths(dataDir: string) {
  const root = join(dataDir, 'batches', 'v1')
  return {
    root,
    batches: join(root, 'signed'),
    acknowledgements: join(root, 'acks'),
  }
}

function batchFileName(batch: LocalSignedMeasurementBatchV1): string {
  const first = String(batch.range.firstSequence).padStart(16, '0')
  const last = String(batch.range.lastSequence).padStart(16, '0')
  return `${first}-${last}-${batch.batchSha256}.json`
}

function ackFileName(batchId: string): string {
  return `${sha256(`metrora-batch-ack-v1\0${batchId}`)}.json`
}

function canonicalBatch(batch: MeasurementBatchV1): string {
  return canonicalizeRfc8785(MeasurementBatchV1Schema.parse(batch))
}

function canonicalSignedPayload(
  range: BatchRangeV1,
  batchSha256: string,
  batch: MeasurementBatchV1,
): string {
  return canonicalizeRfc8785({
    canonicalization: 'RFC8785',
    range: BatchRangeV1Schema.parse(range),
    batchSha256: Sha256DigestSchema.parse(batchSha256),
    batch: MeasurementBatchV1Schema.parse(batch),
  })
}

function verifySignature(signed: LocalSignedMeasurementBatchV1, payload: string): boolean {
  const publicKeyBytes = Buffer.from(signed.signature.publicKeySpkiBase64, 'base64')
  if (sha256(publicKeyBytes) !== signed.signature.publicKeyFingerprintSha256) return false
  try {
    const publicKey = createPublicKey({ key: publicKeyBytes, type: 'spki', format: 'der' })
    return verify(
      null,
      Buffer.from(payload, 'utf-8'),
      publicKey,
      Buffer.from(signed.signature.signatureBase64, 'base64'),
    )
  } catch {
    return false
  }
}

function parseSignedInput(input: unknown): LocalSignedMeasurementBatchV1 {
  if (input instanceof Uint8Array) {
    return LocalSignedMeasurementBatchV1Schema.parse(JSON.parse(Buffer.from(input).toString('utf-8')))
  }
  return LocalSignedMeasurementBatchV1Schema.parse(input)
}

export function verifyLocalSignedMeasurementBatchV1(
  input: unknown,
  options: VerifyLocalSignedMeasurementBatchV1Options,
): LocalSignedMeasurementBatchV1 {
  const endpointId = OpaqueIdSchema.parse(options.endpointId)
  const workspaceId = options.workspaceId === undefined
    ? undefined
    : OpaqueIdSchema.parse(options.workspaceId)
  const signed = parseSignedInput(input)
  if (signed.range.firstSequence > signed.range.lastSequence) throw new Error('signed batch sequence range is reversed')
  if (signed.range.eventCount !== signed.batch.events.length) throw new Error('signed batch event count is invalid')
  if (signed.batch.producer.endpointId !== endpointId) throw new Error('signed batch belongs to another endpoint')
  if (signed.batch.events.some(event => event.data.endpointId !== endpointId)) {
    throw new Error('signed batch contains an event from another endpoint')
  }
  if (workspaceId !== undefined && signed.batch.events.some(event => event.data.workspaceId !== workspaceId)) {
    throw new Error('signed batch contains an event from another workspace')
  }

  const canonical = canonicalBatch(signed.batch)
  if (sha256(canonical) !== signed.batchSha256) throw new Error('signed batch digest does not match its RFC 8785 payload')
  const signedPayload = canonicalSignedPayload(signed.range, signed.batchSha256, signed.batch)
  if (sha256(signedPayload) !== signed.signedPayloadSha256) throw new Error('signed payload digest is invalid')
  if (!verifySignature(signed, signedPayload)) throw new Error('signed batch signature is invalid')
  if (options.expectedFile && batchFileName(signed) !== options.expectedFile) {
    throw new Error('signed batch filename does not match its payload')
  }
  return signed
}

export function verifyLocalSignedMeasurementBatchChainV1(
  inputs: readonly unknown[],
  options: Omit<VerifyLocalSignedMeasurementBatchV1Options, 'expectedFile'>,
): LocalSignedMeasurementBatchV1[] {
  const result: LocalSignedMeasurementBatchV1[] = []
  let previousDigest: string | undefined
  let previousLast = 0
  for (const input of inputs) {
    const signed = verifyLocalSignedMeasurementBatchV1(input, options)
    if (signed.range.firstSequence <= previousLast) throw new Error('signed batch sequence ranges overlap or are out of order')
    if (signed.batch.previousBatchSha256 !== previousDigest) throw new Error('signed batch digest chain is broken')
    result.push(signed)
    previousDigest = signed.batchSha256
    previousLast = signed.range.lastSequence
  }
  return result
}

async function listSignedBatches(
  paths: ReturnType<typeof batchPaths>,
  endpointId: string,
  workspaceId?: string,
): Promise<Array<{ file: string; signed: LocalSignedMeasurementBatchV1 }>> {
  await ensurePrivateDirectory(paths.batches)
  const files = (await readdir(paths.batches)).filter(file => /^\d{16}-\d{16}-[a-f0-9]{64}\.json$/.test(file)).sort()
  const result: Array<{ file: string; signed: LocalSignedMeasurementBatchV1 }> = []
  for (const file of files) {
    const bytes = await readOptionalPrivateFile(join(paths.batches, file))
    if (!bytes) continue
    result.push({
      file,
      signed: verifyLocalSignedMeasurementBatchV1(bytes, {
        endpointId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        expectedFile: file,
      }),
    })
  }
  result.sort((a, b) => a.signed.range.firstSequence - b.signed.range.firstSequence)
  verifyLocalSignedMeasurementBatchChainV1(
    result.map(item => item.signed),
    { endpointId, ...(workspaceId !== undefined ? { workspaceId } : {}) },
  )
  return result
}

function buildBatchId(
  endpointId: string,
  previousBatchSha256: string | undefined,
  records: LocalMeasurementOutboxRecordV1[],
): string {
  const preimage = canonicalizeRfc8785({
    endpointId,
    previousBatchSha256: previousBatchSha256 ?? null,
    records: records.map(record => ({ sequence: record.sequence, eventSha256: record.eventSha256 })),
  })
  return `batch_${sha256(preimage)}`
}

function recordBelongsTo(
  record: LocalMeasurementOutboxRecordV1,
  endpointId: string,
  workspaceId?: string,
): boolean {
  return record.event.data.endpointId === endpointId
    && (workspaceId === undefined || record.event.data.workspaceId === workspaceId)
}

export async function createNextSignedMeasurementBatchV1(
  options: CreateSignedMeasurementBatchV1Options,
): Promise<LocalSignedMeasurementBatchV1 | undefined> {
  const maxEvents = options.maxEvents ?? 500
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 10_000) {
    throw new Error('signed batch maxEvents must be an integer from 1 to 10000')
  }
  if (!options.dataDir.trim()) throw new Error('signed batch creation requires an explicit Metrora data directory')
  const endpointId = OpaqueIdSchema.parse(options.identity.metadata.endpointId)
  const workspaceId = options.workspaceId === undefined
    ? undefined
    : OpaqueIdSchema.parse(options.workspaceId)
  const paths = batchPaths(options.dataDir)

  return withLocalStateLease(paths.root, async () => {
    await Promise.all([ensurePrivateDirectory(paths.batches), ensurePrivateDirectory(paths.acknowledgements)])
    const existing = await listSignedBatches(paths, endpointId, workspaceId)
    const previous = existing.at(-1)?.signed
    const scan = await scanMeasurementOutboxV1({ dataDir: options.dataDir })
    if (scan.invalid.length) throw new Error('cannot create a signed batch while invalid outbox events require review')
    if (workspaceId !== undefined && scan.quarantined.length) {
      throw new Error('cannot create a workspace signed batch while quarantined outbox events require review')
    }

    if (workspaceId !== undefined) {
      const allVisibleRecords = [
        ...scan.pending,
        ...scan.acknowledged.map(item => item.record),
      ]
      if (allVisibleRecords.some(record => !recordBelongsTo(record, endpointId, workspaceId))) {
        throw new Error('outbox contains an event outside the authorized workspace endpoint')
      }
    }

    const afterSequence = previous?.range.lastSequence ?? 0
    const records = scan.pending
      .filter(record => record.sequence > afterSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, maxEvents)
    if (!records.length) return undefined

    for (const record of records) {
      if (!recordBelongsTo(record, endpointId, workspaceId)) {
        throw new Error(workspaceId === undefined
          ? 'outbox contains an event from another endpoint'
          : 'outbox contains an event outside the authorized workspace endpoint')
      }
    }

    const previousDigest = previous?.batchSha256
    const batch = MeasurementBatchV1Schema.parse({
      kind: 'metrora.measurement-batch',
      version: 1,
      batchId: buildBatchId(endpointId, previousDigest, records),
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      producer: {
        endpointId,
        metroraVersion: options.metroraVersion,
        adapterSetSha256: options.adapterSetSha256,
      },
      semanticConventions: {
        cloudEvents: '1.0',
        openTelemetryGenAi: {
          version: options.openTelemetryGenAiVersion,
          stability: 'development',
        },
        metrora: '1',
      },
      ...(previousDigest ? { previousBatchSha256: previousDigest } : {}),
      events: records.map(record => record.event),
    })
    const range = BatchRangeV1Schema.parse({
      firstSequence: records[0]!.sequence,
      lastSequence: records.at(-1)!.sequence,
      eventCount: records.length,
    })
    const batchSha256 = sha256(canonicalBatch(batch))
    const signedPayload = canonicalSignedPayload(range, batchSha256, batch)
    const signature = signWithLocalEndpointIdentityV1(options.identity, Buffer.from(signedPayload, 'utf-8'))
    const signed = LocalSignedMeasurementBatchV1Schema.parse({
      kind: LOCAL_SIGNED_BATCH_KIND,
      version: 1,
      canonicalization: 'RFC8785',
      range,
      batchSha256,
      signedPayloadSha256: sha256(signedPayload),
      batch,
      signature: {
        algorithm: 'ed25519',
        identityGeneration: options.identity.metadata.generation,
        publicKeySpkiBase64: options.identity.metadata.publicKeySpkiBase64,
        publicKeyFingerprintSha256: options.identity.metadata.publicKeyFingerprintSha256,
        signatureBase64: Buffer.from(signature).toString('base64'),
      },
    })
    const file = batchFileName(signed)
    const target = join(paths.batches, file)
    const already = await readOptionalPrivateFile(target)
    if (already) {
      const parsed = verifyLocalSignedMeasurementBatchV1(already, {
        endpointId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        expectedFile: file,
      })
      if (parsed.signedPayloadSha256 !== signed.signedPayloadSha256) throw new Error('signed batch filename collision')
      return parsed
    }
    await atomicWritePrivateFile(target, JSON.stringify(signed))
    return signed
  })
}

async function readAck(
  paths: ReturnType<typeof batchPaths>,
  signed: LocalSignedMeasurementBatchV1,
): Promise<LocalSignedMeasurementBatchAckV1 | undefined> {
  const bytes = await readOptionalPrivateFile(join(paths.acknowledgements, ackFileName(signed.batch.batchId)))
  if (!bytes) return undefined
  const ack = LocalSignedMeasurementBatchAckV1Schema.parse(JSON.parse(bytes.toString('utf-8')))
  if (
    ack.batchId !== signed.batch.batchId
    || ack.batchSha256 !== signed.batchSha256
    || ack.acceptedThroughSequence !== signed.range.lastSequence
  ) throw new Error('signed batch acknowledgement does not match its immutable batch')
  return ack
}

export async function listSignedMeasurementBatchStatesV1(
  options: SignedMeasurementBatchStoreOptions,
): Promise<LocalSignedMeasurementBatchStateV1[]> {
  if (!options.dataDir.trim()) throw new Error('signed batch listing requires an explicit Metrora data directory')
  const endpointId = OpaqueIdSchema.parse(options.endpointId)
  const workspaceId = options.workspaceId === undefined
    ? undefined
    : OpaqueIdSchema.parse(options.workspaceId)
  const paths = batchPaths(options.dataDir)
  await ensurePrivateDirectory(paths.acknowledgements)
  const batches = await listSignedBatches(paths, endpointId, workspaceId)
  const result: LocalSignedMeasurementBatchStateV1[] = []
  for (const { signed } of batches) {
    const acknowledgement = await readAck(paths, signed)
    result.push({ signed, ...(acknowledgement ? { acknowledgement } : {}) })
  }
  return result
}

export async function listUnacknowledgedSignedMeasurementBatchesV1(
  options: SignedMeasurementBatchStoreOptions,
): Promise<LocalSignedMeasurementBatchV1[]> {
  return (await listSignedMeasurementBatchStatesV1(options))
    .filter(item => item.acknowledgement === undefined)
    .map(item => item.signed)
}

export async function acknowledgeSignedMeasurementBatchV1(
  batchIdInput: string,
  receiptIdInput: string,
  options: SignedMeasurementBatchStoreOptions & { now?: () => Date },
): Promise<{ status: 'acknowledged' | 'duplicate'; ack: LocalSignedMeasurementBatchAckV1 }> {
  if (!options.dataDir.trim()) throw new Error('signed batch acknowledgement requires an explicit Metrora data directory')
  const endpointId = OpaqueIdSchema.parse(options.endpointId)
  const workspaceId = options.workspaceId === undefined
    ? undefined
    : OpaqueIdSchema.parse(options.workspaceId)
  const batchId = OpaqueIdSchema.parse(batchIdInput)
  const receiptId = z.string().trim().min(1).max(200).parse(receiptIdInput)
  const paths = batchPaths(options.dataDir)
  await ensurePrivateDirectory(paths.acknowledgements)
  const batches = await listSignedBatches(paths, endpointId, workspaceId)
  const signed = batches.find(item => item.signed.batch.batchId === batchId)?.signed
  if (!signed) throw new Error('cannot acknowledge an unknown signed batch')
  const existing = await readAck(paths, signed)
  if (existing) {
    if (existing.receiptId !== receiptId) throw new Error('signed batch already has a different receipt')
    return { status: 'duplicate', ack: existing }
  }

  const eventReceipt = `batch:${receiptId}`
  for (const event of signed.batch.events) {
    await acknowledgeMeasurementEventV1(event.id, { dataDir: options.dataDir, receiptId: eventReceipt })
  }

  return withLocalStateLease(paths.root, async () => {
    const raced = await readAck(paths, signed)
    if (raced) {
      if (raced.receiptId !== receiptId) throw new Error('signed batch already has a different receipt')
      return { status: 'duplicate' as const, ack: raced }
    }
    const ack = LocalSignedMeasurementBatchAckV1Schema.parse({
      kind: LOCAL_SIGNED_BATCH_ACK_KIND,
      version: 1,
      batchId: signed.batch.batchId,
      batchSha256: signed.batchSha256,
      acceptedThroughSequence: signed.range.lastSequence,
      acknowledgedAt: (options.now ?? (() => new Date()))().toISOString(),
      receiptId,
    })
    await atomicWritePrivateFile(
      join(paths.acknowledgements, ackFileName(signed.batch.batchId)),
      JSON.stringify(ack),
    )
    return { status: 'acknowledged' as const, ack }
  })
}