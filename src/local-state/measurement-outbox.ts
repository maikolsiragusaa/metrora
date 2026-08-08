import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod/v4'

import {
  PositiveIntegerSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '../contracts/v1/common.js'
import {
  UsageMeasurementEventV1Schema,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import {
  atomicWritePrivateFile,
  cleanupStaleAtomicTemps,
  ensurePrivateDirectory,
  readOptionalPrivateFile,
} from './atomic-file.js'
import { defaultMetroraDataDir } from './endpoint-identity.js'
import { withLocalStateLease } from './local-state-lease.js'

export const LOCAL_OUTBOX_RECORD_KIND = 'metrora.local-measurement-outbox-record' as const
export const LOCAL_OUTBOX_ACK_KIND = 'metrora.local-measurement-outbox-ack' as const
export const LOCAL_OUTBOX_QUARANTINE_KIND = 'metrora.local-measurement-outbox-quarantine' as const
export const LOCAL_OUTBOX_PRODUCTION_RECEIPT_KIND = 'metrora.local-measurement-production-receipt' as const

const OutboxEventIdSchema = z.string().min(3).max(128)
const OutboxReceiptIdSchema = z.string().trim().min(1).max(240)

export const LocalMeasurementOutboxRecordV1Schema = z.strictObject({
  kind: z.literal(LOCAL_OUTBOX_RECORD_KIND),
  version: z.literal(1),
  sequence: PositiveIntegerSchema,
  enqueuedAt: TimestampSchema,
  canonicalization: z.literal('metrora-sorted-json-v1'),
  eventSha256: Sha256DigestSchema,
  event: UsageMeasurementEventV1Schema,
})

export const LocalMeasurementOutboxAckV1Schema = z.strictObject({
  kind: z.literal(LOCAL_OUTBOX_ACK_KIND),
  version: z.literal(1),
  eventId: OutboxEventIdSchema,
  sequence: PositiveIntegerSchema,
  acknowledgedAt: TimestampSchema,
  receiptId: OutboxReceiptIdSchema.optional(),
})

const LocalMeasurementOutboxCounterV1Schema = z.strictObject({
  version: z.literal(1),
  nextSequence: PositiveIntegerSchema,
})

export const LocalMeasurementOutboxQuarantineV1Schema = z.strictObject({
  kind: z.literal(LOCAL_OUTBOX_QUARANTINE_KIND),
  version: z.literal(1),
  eventFile: z.string().regex(/^[a-f0-9]{64}\.json$/),
  sourceSha256: Sha256DigestSchema,
  quarantinedAt: TimestampSchema,
  reason: z.string().trim().min(1).max(1000),
})

export const LocalMeasurementProductionReceiptV1Schema = z.strictObject({
  kind: z.literal(LOCAL_OUTBOX_PRODUCTION_RECEIPT_KIND),
  version: z.literal(1),
  productionKeySha256: Sha256DigestSchema,
  semanticEventSha256: Sha256DigestSchema,
  record: LocalMeasurementOutboxRecordV1Schema,
})

export type LocalMeasurementOutboxRecordV1 = z.infer<typeof LocalMeasurementOutboxRecordV1Schema>
export type LocalMeasurementOutboxAckV1 = z.infer<typeof LocalMeasurementOutboxAckV1Schema>
export type LocalMeasurementOutboxQuarantineV1 = z.infer<typeof LocalMeasurementOutboxQuarantineV1Schema>
export type LocalMeasurementProductionReceiptV1 = z.infer<typeof LocalMeasurementProductionReceiptV1Schema>

export type MeasurementOutboxOptions = {
  dataDir?: string
  now?: () => Date
}

export type EnqueueMeasurementEventV1Options = MeasurementOutboxOptions & {
  /**
   * Private, already-hashed producer identity. It is stored only in the local
   * receipt index and never copied into a public event or signed batch.
   */
  productionKeySha256?: string
}

export type MeasurementOutboxScanV1 = {
  pending: LocalMeasurementOutboxRecordV1[]
  acknowledged: Array<{ record: LocalMeasurementOutboxRecordV1; ack: LocalMeasurementOutboxAckV1 }>
  invalid: Array<{ eventFile: string; reason: string }>
  quarantined: LocalMeasurementOutboxQuarantineV1[]
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('outbox canonical JSON accepts only finite safe integers')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  throw new Error('outbox canonical JSON cannot encode this value')
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function eventDigest(event: UsageMeasurementEventV1): string {
  return sha256(canonicalJson(event))
}

function semanticEventDigest(event: UsageMeasurementEventV1): string {
  const {
    id: _eventId,
    data: {
      collector: {
        adapterVersion: _adapterVersion,
        ...collectorWithoutReleaseVersion
      },
      ...dataWithoutCollector
    },
    ...eventWithoutRotatingIdAndData
  } = event

  // The endpoint HMAC key and the Metrora release may rotate while the source
  // measurement remains identical. Both public event ID and adapterVersion are
  // therefore excluded from the private receipt's semantic collision check.
  // Evidence profile, source kind/fingerprint, token/cost facts, scope,
  // provider/model identity, disclosure and every other public field remain
  // strictly bound.
  return sha256(canonicalJson({
    ...eventWithoutRotatingIdAndData,
    data: {
      ...dataWithoutCollector,
      collector: collectorWithoutReleaseVersion,
    },
  }))
}

function eventFileName(eventId: string): string {
  return `${sha256(`metrora-outbox-event-v1\0${eventId}`)}.json`
}

function productionReceiptFileName(productionKeySha256: string): string {
  return `${productionKeySha256}.json`
}

function outboxPaths(dataDir: string) {
  const root = join(dataDir, 'outbox', 'v1')
  return {
    root,
    events: join(root, 'events'),
    acknowledgements: join(root, 'acks'),
    quarantine: join(root, 'quarantine'),
    production: join(root, 'production'),
    counter: join(root, 'next-sequence.json'),
  }
}

async function prepare(paths: ReturnType<typeof outboxPaths>): Promise<void> {
  await Promise.all([
    ensurePrivateDirectory(paths.events),
    ensurePrivateDirectory(paths.acknowledgements),
    ensurePrivateDirectory(paths.quarantine),
    ensurePrivateDirectory(paths.production),
  ])
  await Promise.all([
    cleanupStaleAtomicTemps(paths.events),
    cleanupStaleAtomicTemps(paths.acknowledgements),
    cleanupStaleAtomicTemps(paths.quarantine),
    cleanupStaleAtomicTemps(paths.production),
  ])
}

function parseRecord(bytes: Uint8Array, expectedFile?: string): LocalMeasurementOutboxRecordV1 {
  const record = LocalMeasurementOutboxRecordV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
  const expectedDigest = eventDigest(record.event)
  if (record.eventSha256 !== expectedDigest) throw new Error('event digest does not match its canonical payload')
  if (expectedFile && eventFileName(record.event.id) !== expectedFile) {
    throw new Error('event id does not match its outbox filename')
  }
  return record
}

function parseProductionReceipt(
  bytes: Uint8Array,
  expectedProductionKey: string,
): LocalMeasurementProductionReceiptV1 {
  const receipt = LocalMeasurementProductionReceiptV1Schema.parse(
    JSON.parse(Buffer.from(bytes).toString('utf-8')),
  )
  if (receipt.productionKeySha256 !== expectedProductionKey) {
    throw new Error('production receipt does not match its private index key')
  }
  const record = parseRecord(Buffer.from(JSON.stringify(receipt.record)))
  if (record.eventSha256 !== receipt.record.eventSha256) {
    throw new Error('production receipt record is invalid')
  }
  if (receipt.semanticEventSha256 !== semanticEventDigest(record.event)) {
    throw new Error('production receipt semantic digest does not match its event')
  }
  return receipt
}

async function readCounter(path: string): Promise<number> {
  const bytes = await readOptionalPrivateFile(path)
  if (!bytes) return 1
  try {
    return LocalMeasurementOutboxCounterV1Schema.parse(JSON.parse(bytes.toString('utf-8'))).nextSequence
  } catch {
    throw new Error('local outbox sequence counter is invalid; recovery is required')
  }
}

async function readRecordByEventId(
  paths: ReturnType<typeof outboxPaths>,
  eventId: string,
): Promise<LocalMeasurementOutboxRecordV1 | undefined> {
  const file = eventFileName(eventId)
  const bytes = await readOptionalPrivateFile(join(paths.events, file))
  return bytes ? parseRecord(bytes, file) : undefined
}

async function readProductionReceipt(
  paths: ReturnType<typeof outboxPaths>,
  productionKeySha256: string,
): Promise<LocalMeasurementProductionReceiptV1 | undefined> {
  const bytes = await readOptionalPrivateFile(
    join(paths.production, productionReceiptFileName(productionKeySha256)),
  )
  return bytes ? parseProductionReceipt(bytes, productionKeySha256) : undefined
}

async function ensureRecordPublished(
  paths: ReturnType<typeof outboxPaths>,
  record: LocalMeasurementOutboxRecordV1,
): Promise<void> {
  const file = eventFileName(record.event.id)
  const path = join(paths.events, file)
  const bytes = await readOptionalPrivateFile(path)
  if (!bytes) {
    await atomicWritePrivateFile(path, JSON.stringify(record))
    return
  }
  const existing = parseRecord(bytes, file)
  if (canonicalJson(existing) !== canonicalJson(record)) {
    throw new Error('production receipt conflicts with the published outbox event')
  }
}

export async function enqueueMeasurementEventV1(
  eventInput: UsageMeasurementEventV1,
  options: EnqueueMeasurementEventV1Options = {},
): Promise<{ status: 'enqueued' | 'duplicate'; record: LocalMeasurementOutboxRecordV1 }> {
  const event = UsageMeasurementEventV1Schema.parse(eventInput)
  const productionKeySha256 = options.productionKeySha256 === undefined
    ? undefined
    : Sha256DigestSchema.parse(options.productionKeySha256)
  const paths = outboxPaths(options.dataDir ?? defaultMetroraDataDir())
  const now = options.now ?? (() => new Date())
  await prepare(paths)

  return withLocalStateLease(paths.root, async () => {
    const digest = eventDigest(event)
    const semanticDigest = semanticEventDigest(event)

    if (productionKeySha256 !== undefined) {
      const productionReceipt = await readProductionReceipt(paths, productionKeySha256)
      if (productionReceipt) {
        if (productionReceipt.semanticEventSha256 !== semanticDigest) {
          throw new Error('outbox production key collision with different measurement payload')
        }
        await ensureRecordPublished(paths, productionReceipt.record)
        return { status: 'duplicate' as const, record: productionReceipt.record }
      }
    }

    const existing = await readRecordByEventId(paths, event.id)
    if (existing) {
      if (existing.eventSha256 !== digest) throw new Error('outbox event id collision with different payload')
      if (productionKeySha256 !== undefined) {
        const receipt = LocalMeasurementProductionReceiptV1Schema.parse({
          kind: LOCAL_OUTBOX_PRODUCTION_RECEIPT_KIND,
          version: 1,
          productionKeySha256,
          semanticEventSha256: semanticDigest,
          record: existing,
        })
        await atomicWritePrivateFile(
          join(paths.production, productionReceiptFileName(productionKeySha256)),
          JSON.stringify(receipt),
        )
      }
      return { status: 'duplicate' as const, record: existing }
    }

    const sequence = await readCounter(paths.counter)
    if (sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('local outbox sequence space is exhausted')
    }
    // Reserve first. A crash after this write creates a harmless gap rather than
    // allowing the next process to reuse a sequence already present on disk.
    await atomicWritePrivateFile(paths.counter, JSON.stringify({ version: 1, nextSequence: sequence + 1 }))
    const record = LocalMeasurementOutboxRecordV1Schema.parse({
      kind: LOCAL_OUTBOX_RECORD_KIND,
      version: 1,
      sequence,
      enqueuedAt: now().toISOString(),
      canonicalization: 'metrora-sorted-json-v1',
      eventSha256: digest,
      event,
    })

    if (productionKeySha256 !== undefined) {
      // Publish the private recovery receipt before the public outbox file. If
      // the process stops between these writes, the next identical production
      // repairs the event from the immutable receipt. The receipt also keeps the
      // original event ID stable across endpoint HMAC-key rotation.
      const receipt = LocalMeasurementProductionReceiptV1Schema.parse({
        kind: LOCAL_OUTBOX_PRODUCTION_RECEIPT_KIND,
        version: 1,
        productionKeySha256,
        semanticEventSha256: semanticDigest,
        record,
      })
      await atomicWritePrivateFile(
        join(paths.production, productionReceiptFileName(productionKeySha256)),
        JSON.stringify(receipt),
      )
    }

    await atomicWritePrivateFile(join(paths.events, eventFileName(event.id)), JSON.stringify(record))
    return { status: 'enqueued' as const, record }
  })
}

async function readAck(
  paths: ReturnType<typeof outboxPaths>,
  record: LocalMeasurementOutboxRecordV1,
): Promise<LocalMeasurementOutboxAckV1 | undefined> {
  const bytes = await readOptionalPrivateFile(join(paths.acknowledgements, eventFileName(record.event.id)))
  if (!bytes) return undefined
  const ack = LocalMeasurementOutboxAckV1Schema.parse(JSON.parse(bytes.toString('utf-8')))
  if (ack.eventId !== record.event.id || ack.sequence !== record.sequence) {
    throw new Error('outbox acknowledgement does not match its immutable event')
  }
  return ack
}

export async function acknowledgeMeasurementEventV1(
  eventIdInput: string,
  options: MeasurementOutboxOptions & { receiptId?: string } = {},
): Promise<{ status: 'acknowledged' | 'duplicate'; ack: LocalMeasurementOutboxAckV1 }> {
  const eventId = OutboxEventIdSchema.parse(eventIdInput)
  const requestedReceiptId = options.receiptId === undefined
    ? undefined
    : OutboxReceiptIdSchema.parse(options.receiptId)
  const paths = outboxPaths(options.dataDir ?? defaultMetroraDataDir())
  const now = options.now ?? (() => new Date())
  await prepare(paths)

  return withLocalStateLease(paths.root, async () => {
    const record = await readRecordByEventId(paths, eventId)
    if (!record) throw new Error('cannot acknowledge an event that is not in the local outbox')
    const existing = await readAck(paths, record)
    if (existing) {
      if (requestedReceiptId !== undefined && existing.receiptId !== requestedReceiptId) {
        throw new Error('outbox event was already acknowledged with a different receipt')
      }
      return { status: 'duplicate' as const, ack: existing }
    }

    const ack = LocalMeasurementOutboxAckV1Schema.parse({
      kind: LOCAL_OUTBOX_ACK_KIND,
      version: 1,
      eventId: record.event.id,
      sequence: record.sequence,
      acknowledgedAt: now().toISOString(),
      ...(requestedReceiptId !== undefined ? { receiptId: requestedReceiptId } : {}),
    })
    await atomicWritePrivateFile(
      join(paths.acknowledgements, eventFileName(record.event.id)),
      JSON.stringify(ack),
    )
    return { status: 'acknowledged' as const, ack }
  })
}

export async function scanMeasurementOutboxV1(
  options: MeasurementOutboxOptions = {},
): Promise<MeasurementOutboxScanV1> {
  const paths = outboxPaths(options.dataDir ?? defaultMetroraDataDir())
  await prepare(paths)
  const pending: LocalMeasurementOutboxRecordV1[] = []
  const acknowledged: MeasurementOutboxScanV1['acknowledged'] = []
  const invalid: MeasurementOutboxScanV1['invalid'] = []
  const quarantined: LocalMeasurementOutboxQuarantineV1[] = []
  const quarantinedFiles = new Set<string>()

  const quarantineFiles = (await readdir(paths.quarantine)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()
  for (const file of quarantineFiles) {
    try {
      const [markerBytes, sourceBytes] = await Promise.all([
        readOptionalPrivateFile(join(paths.quarantine, file)),
        readOptionalPrivateFile(join(paths.events, file)),
      ])
      if (!markerBytes || !sourceBytes) continue
      const marker = LocalMeasurementOutboxQuarantineV1Schema.parse(JSON.parse(markerBytes.toString('utf-8')))
      if (marker.eventFile !== file || marker.sourceSha256 !== sha256(sourceBytes)) continue
      quarantined.push(marker)
      quarantinedFiles.add(file)
    } catch {
      // An invalid quarantine marker cannot hide or mutate the source event.
    }
  }

  const eventFiles = (await readdir(paths.events)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()
  for (const file of eventFiles) {
    try {
      const bytes = await readOptionalPrivateFile(join(paths.events, file))
      if (!bytes) continue
      const record = parseRecord(bytes, file)
      if (quarantinedFiles.has(file)) continue
      const ack = await readAck(paths, record)
      if (ack) acknowledged.push({ record, ack })
      else pending.push(record)
    } catch (error) {
      invalid.push({ eventFile: file, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  pending.sort((a, b) => a.sequence - b.sequence)
  acknowledged.sort((a, b) => a.record.sequence - b.record.sequence)
  return { pending, acknowledged, invalid, quarantined }
}

export async function readPendingMeasurementEventsV1(
  limit: number,
  options: MeasurementOutboxOptions = {},
): Promise<LocalMeasurementOutboxRecordV1[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error('outbox read limit must be an integer from 1 to 10000')
  }
  return (await scanMeasurementOutboxV1(options)).pending.slice(0, limit)
}

export async function quarantineMeasurementOutboxFileV1(
  eventFile: string,
  reason: string,
  options: MeasurementOutboxOptions = {},
): Promise<LocalMeasurementOutboxQuarantineV1> {
  if (!/^[a-f0-9]{64}\.json$/.test(eventFile)) throw new Error('invalid outbox event filename')
  const paths = outboxPaths(options.dataDir ?? defaultMetroraDataDir())
  const now = options.now ?? (() => new Date())
  await prepare(paths)

  return withLocalStateLease(paths.root, async () => {
    const source = await readOptionalPrivateFile(join(paths.events, eventFile))
    if (!source) throw new Error('cannot quarantine a missing outbox event file')
    const marker = LocalMeasurementOutboxQuarantineV1Schema.parse({
      kind: LOCAL_OUTBOX_QUARANTINE_KIND,
      version: 1,
      eventFile,
      sourceSha256: sha256(source),
      quarantinedAt: now().toISOString(),
      reason,
    })
    const markerPath = join(paths.quarantine, eventFile)
    const existingBytes = await readOptionalPrivateFile(markerPath)
    if (existingBytes) {
      const existing = LocalMeasurementOutboxQuarantineV1Schema.parse(JSON.parse(existingBytes.toString('utf-8')))
      if (
        existing.eventFile === marker.eventFile
        && existing.sourceSha256 === marker.sourceSha256
        && existing.reason === marker.reason
      ) return existing
      throw new Error('outbox event already has a different quarantine decision')
    }
    await atomicWritePrivateFile(markerPath, JSON.stringify(marker))
    return marker
  })
}
