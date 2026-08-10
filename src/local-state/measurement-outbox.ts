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
import {
  legacyEventFileName as legacyOutboxEventFileName,
  objectValue,
  parseStoredOutboxRecord,
} from './legacy-outbox-compatibility.js'
import { withLocalStateLease } from './local-state-lease.js'
import {
  canonicalJson,
  eventDigest,
  semanticEventDigest,
  sha256,
} from './measurement-outbox-digests.js'

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
  legacyPending?: LocalMeasurementOutboxRecordV1[]
  legacyAcknowledged?: Array<{ record: LocalMeasurementOutboxRecordV1; ack: LocalMeasurementOutboxAckV1 }>
  invalid: Array<{ eventFile: string; reason: string }>
  quarantined: LocalMeasurementOutboxQuarantineV1[]
}

type StoredOutboxRecordV1 = {
  record: LocalMeasurementOutboxRecordV1
  legacy: boolean
  eventFile: string
  rawEvent: unknown
}

type StoredProductionReceiptV1 = {
  receipt: LocalMeasurementProductionReceiptV1
  storedRecord: StoredOutboxRecordV1
  legacyRecord: boolean
  rawEvent: unknown
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

function legacyEventFileName(eventId: string): string {
  return legacyOutboxEventFileName(eventId, sha256)
}

function parseRecord(bytes: Uint8Array, expectedFile?: string): StoredOutboxRecordV1 {
  const value = JSON.parse(Buffer.from(bytes).toString('utf-8')) as unknown
  const current = LocalMeasurementOutboxRecordV1Schema.safeParse(value)
  const parsed = parseStoredOutboxRecord(
    value,
    expectedFile,
    current,
    normalized => LocalMeasurementOutboxRecordV1Schema.safeParse(normalized),
    eventDigest,
    eventFileName,
    sha256,
  )
  return {
    record: LocalMeasurementOutboxRecordV1Schema.parse(parsed.record),
    legacy: parsed.legacy,
    eventFile: parsed.eventFile,
    rawEvent: parsed.rawEvent,
  }
}

function parseProductionReceipt(
  bytes: Uint8Array,
  expectedProductionKey: string,
): StoredProductionReceiptV1 {
  const value = objectValue(JSON.parse(Buffer.from(bytes).toString('utf-8')), 'production receipt is not an object')
  const current = LocalMeasurementProductionReceiptV1Schema.safeParse(value)
  const rawRecord = objectValue(value.record, 'production receipt record is invalid')
  const storedRecord = parseRecord(Buffer.from(JSON.stringify(rawRecord)))
  const receipt = current.success
    ? current.data
    : LocalMeasurementProductionReceiptV1Schema.parse({ ...value, record: storedRecord.record })
  if (receipt.productionKeySha256 !== expectedProductionKey) {
    throw new Error('production receipt does not match its private index key')
  }
  if (storedRecord.record.eventSha256 !== receipt.record.eventSha256) {
    throw new Error('production receipt record is invalid')
  }
  if (receipt.semanticEventSha256 !== semanticEventDigest(storedRecord.rawEvent)) {
    throw new Error('production receipt semantic digest does not match its event')
  }
  return {
    receipt,
    storedRecord,
    legacyRecord: storedRecord.legacy,
    rawEvent: storedRecord.rawEvent,
  }
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
): Promise<StoredOutboxRecordV1 | undefined> {
  const candidates = [eventFileName(eventId), legacyEventFileName(eventId)]
  const found: StoredOutboxRecordV1[] = []
  for (const file of candidates) {
    const bytes = await readOptionalPrivateFile(join(paths.events, file))
    if (bytes) found.push(parseRecord(bytes, file))
  }
  if (found.length > 1) {
    throw new Error('event id has multiple persisted outbox representations')
  }
  return found[0]
}

async function readProductionReceipt(
  paths: ReturnType<typeof outboxPaths>,
  productionKeySha256: string,
): Promise<StoredProductionReceiptV1 | undefined> {
  const bytes = await readOptionalPrivateFile(
    join(paths.production, productionReceiptFileName(productionKeySha256)),
  )
  return bytes ? parseProductionReceipt(bytes, productionKeySha256) : undefined
}

export type ValidatedLocalMeasurementProductionReceiptV1 = {
  receipt: LocalMeasurementProductionReceiptV1
  legacyRecord: boolean
  sourcePresent: boolean
}

export async function readValidatedLocalMeasurementProductionReceiptV1(
  dataDir: string,
  productionKeySha256: string,
): Promise<ValidatedLocalMeasurementProductionReceiptV1 | undefined> {
  const paths = outboxPaths(dataDir)
  const stored = await readProductionReceipt(paths, productionKeySha256)
  if (!stored) return undefined
  const sourceBytes = await readOptionalPrivateFile(join(paths.events, stored.storedRecord.eventFile))
  if (!sourceBytes) {
    return {
      receipt: stored.receipt,
      legacyRecord: stored.legacyRecord,
      sourcePresent: false,
    }
  }
  const source = parseRecord(sourceBytes, stored.storedRecord.eventFile)
  if (source.record.eventSha256 !== stored.receipt.record.eventSha256) {
    throw new Error('production receipt does not match its published outbox event')
  }
  return {
    receipt: stored.receipt,
    legacyRecord: stored.legacyRecord,
    sourcePresent: true,
  }
}

async function ensureRecordPublished(
  paths: ReturnType<typeof outboxPaths>,
  stored: StoredOutboxRecordV1,
): Promise<void> {
  if (stored.legacy) return
  const { record } = stored
  const file = eventFileName(record.event.id)
  const path = join(paths.events, file)
  const bytes = await readOptionalPrivateFile(path)
  if (!bytes) {
    await atomicWritePrivateFile(path, JSON.stringify(record))
    return
  }
  const existing = parseRecord(bytes, file)
  if (existing.legacy || canonicalJson(existing.record) !== canonicalJson(record)) {
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
        if (productionReceipt.receipt.semanticEventSha256 !== semanticDigest) {
          throw new Error('outbox production key collision with different measurement payload')
        }
        await ensureRecordPublished(paths, productionReceipt.storedRecord)
        return { status: 'duplicate' as const, record: productionReceipt.storedRecord.record }
      }
    }

    const existing = await readRecordByEventId(paths, event.id)
    if (existing) {
      if (existing.legacy || existing.record.eventSha256 !== digest) {
        throw new Error('outbox event id collision with different payload')
      }
      if (productionKeySha256 !== undefined) {
        const receipt = LocalMeasurementProductionReceiptV1Schema.parse({
          kind: LOCAL_OUTBOX_PRODUCTION_RECEIPT_KIND,
          version: 1,
          productionKeySha256,
          semanticEventSha256: semanticDigest,
          record: existing.record,
        })
        await atomicWritePrivateFile(
          join(paths.production, productionReceiptFileName(productionKeySha256)),
          JSON.stringify(receipt),
        )
      }
      return { status: 'duplicate' as const, record: existing.record }
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
  stored: StoredOutboxRecordV1,
): Promise<LocalMeasurementOutboxAckV1 | undefined> {
  const file = eventFileName(stored.record.event.id)
  const bytes = await readOptionalPrivateFile(join(paths.acknowledgements, file))
  if (!bytes) return undefined
  const ack = LocalMeasurementOutboxAckV1Schema.parse(JSON.parse(bytes.toString('utf-8')))
  if (ack.eventId !== stored.record.event.id || ack.sequence !== stored.record.sequence) {
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
      eventId: record.record.event.id,
      sequence: record.record.sequence,
      acknowledgedAt: now().toISOString(),
      ...(requestedReceiptId !== undefined ? { receiptId: requestedReceiptId } : {}),
    })
    await atomicWritePrivateFile(
      join(paths.acknowledgements, eventFileName(record.record.event.id)),
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
  const legacyPending: LocalMeasurementOutboxRecordV1[] = []
  const legacyAcknowledged: MeasurementOutboxScanV1['legacyAcknowledged'] = []
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
      const stored = parseRecord(bytes, file)
      if (quarantinedFiles.has(file)) continue
      const ack = await readAck(paths, stored)
      if (ack) {
        if (stored.legacy) legacyAcknowledged.push({ record: stored.record, ack })
        else acknowledged.push({ record: stored.record, ack })
      } else if (stored.legacy) {
        legacyPending.push(stored.record)
      } else {
        pending.push(stored.record)
      }
    } catch (error) {
      invalid.push({ eventFile: file, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  pending.sort((a, b) => a.sequence - b.sequence)
  acknowledged.sort((a, b) => a.record.sequence - b.record.sequence)
  legacyPending.sort((a, b) => a.sequence - b.sequence)
  legacyAcknowledged.sort((a, b) => a.record.sequence - b.record.sequence)
  return {
    pending,
    acknowledged,
    ...(legacyPending.length ? { legacyPending } : {}),
    ...(legacyAcknowledged.length ? { legacyAcknowledged } : {}),
    invalid,
    quarantined,
  }
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
