import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import { loadOrCreateLocalEndpointIdentityV1, rotateLocalEndpointIdentityV1 } from './endpoint-identity.js'
import { enqueueMeasurementEventV1, scanMeasurementOutboxV1 } from './measurement-outbox.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'
import {
  acknowledgeSignedMeasurementBatchV1,
  createNextSignedMeasurementBatchV1,
  listUnacknowledgedSignedMeasurementBatchesV1,
} from './signed-batch.js'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-signed-batch-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function event(endpointId: string, id: string, outputTokens: number): UsageMeasurementEventV1 {
  return {
    specversion: '1.0',
    id,
    source: `urn:metrora:endpoint:${endpointId}`,
    type: USAGE_MEASUREMENT_EVENT_TYPE,
    time: '2026-07-31T16:00:00.000Z',
    subject: `workspace/ws_test/endpoint/${endpointId}`,
    datacontenttype: 'application/json',
    dataschema: USAGE_MEASUREMENT_DATA_SCHEMA_URI,
    data: {
      version: 1,
      workspaceId: 'ws_test',
      endpointId,
      tool: { name: 'Codex', version: '1.0.0' },
      collector: {
        adapterId: 'codex-rollout-token-count-v1',
        adapterVersion: '0.9.19',
        sourceKind: 'codex-rollout-jsonl-token-count',
        sourceFingerprintSha256: '1'.repeat(64),
      },
      genAi: {
        operationName: 'chat',
        providerName: 'openai',
        responseModel: 'gpt-5.6',
      },
      usage: {
        calls: 1,
        inputTokens: 100,
        outputTokens,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
      },
      cost: { kind: 'unavailable' },
      reasoning: { level: 'high', source: 'explicit' },
      quality: {
        tokenCounts: 'measured',
        modelIdentity: 'normalized',
        sessionIdentity: 'unknown',
      },
      privacy: {
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        patchesIncluded: false,
        secretsIncluded: false,
        localPathsIncluded: false,
      },
    },
  }
}

function createOptions(dataDir: string, identity: Awaited<ReturnType<typeof loadOrCreateLocalEndpointIdentityV1>>) {
  return {
    dataDir,
    identity,
    metroraVersion: '0.9.19',
    adapterSetSha256: 'a'.repeat(64),
    openTelemetryGenAiVersion: '1.37.0',
    now: () => new Date('2026-07-31T16:05:00.000Z'),
  }
}

describe.sequential('local signed measurement batches v1', () => {
  it('creates immutable RFC 8785 batches with monotonic chained ranges', async () => {
    const dataDir = await root()
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 7))
    const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
    await enqueueMeasurementEventV1(event(identity.metadata.endpointId, 'evt_one', 10), { dataDir })
    await enqueueMeasurementEventV1(event(identity.metadata.endpointId, 'evt_two', 20), { dataDir })
    await enqueueMeasurementEventV1(event(identity.metadata.endpointId, 'evt_three', 30), { dataDir })

    const first = await createNextSignedMeasurementBatchV1({ ...createOptions(dataDir, identity), maxEvents: 2 })
    const second = await createNextSignedMeasurementBatchV1({ ...createOptions(dataDir, identity), maxEvents: 2 })
    const empty = await createNextSignedMeasurementBatchV1({ ...createOptions(dataDir, identity), maxEvents: 2 })

    expect(first?.canonicalization).toBe('RFC8785')
    expect(first?.range).toEqual({ firstSequence: 1, lastSequence: 2, eventCount: 2 })
    expect(second?.range).toEqual({ firstSequence: 3, lastSequence: 3, eventCount: 1 })
    expect(second?.batch.previousBatchSha256).toBe(first?.batchSha256)
    expect(empty).toBeUndefined()
    expect(await listUnacknowledgedSignedMeasurementBatchesV1({
      dataDir,
      endpointId: identity.metadata.endpointId,
    })).toEqual([first, second])
  })

  it('keeps old batches verifiable after endpoint key rotation', async () => {
    const dataDir = await root()
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 8))
    const firstIdentity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
    await enqueueMeasurementEventV1(event(firstIdentity.metadata.endpointId, 'evt_before_rotation', 10), { dataDir })
    const first = await createNextSignedMeasurementBatchV1(createOptions(dataDir, firstIdentity))

    const secondIdentity = await rotateLocalEndpointIdentityV1({ dataDir, protector })
    await enqueueMeasurementEventV1(event(secondIdentity.metadata.endpointId, 'evt_after_rotation', 20), { dataDir })
    const second = await createNextSignedMeasurementBatchV1(createOptions(dataDir, secondIdentity))

    expect(secondIdentity.metadata.endpointId).toBe(firstIdentity.metadata.endpointId)
    expect(second?.signature.publicKeyFingerprintSha256).not.toBe(first?.signature.publicKeyFingerprintSha256)
    expect(await listUnacknowledgedSignedMeasurementBatchesV1({
      dataDir,
      endpointId: secondIdentity.metadata.endpointId,
    })).toEqual([first, second])
  })

  it('binds range and batch bytes to the Ed25519 signature', async () => {
    const dataDir = await root()
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 9))
    const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
    await enqueueMeasurementEventV1(event(identity.metadata.endpointId, 'evt_tamper', 10), { dataDir })
    await createNextSignedMeasurementBatchV1(createOptions(dataDir, identity))

    const directory = join(dataDir, 'batches', 'v1', 'signed')
    const [file] = await readdir(directory)
    const path = join(directory, file!)
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as { range: { lastSequence: number } }
    parsed.range.lastSequence += 1
    await writeFile(path, JSON.stringify(parsed))

    await expect(listUnacknowledgedSignedMeasurementBatchesV1({
      dataDir,
      endpointId: identity.metadata.endpointId,
    })).rejects.toThrow(/signed payload digest|signature|filename/)
  })

  it('records immutable batch acknowledgements and idempotently acknowledges member events', async () => {
    const dataDir = await root()
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 10))
    const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
    await enqueueMeasurementEventV1(event(identity.metadata.endpointId, 'evt_ack_one', 10), { dataDir })
    await enqueueMeasurementEventV1(event(identity.metadata.endpointId, 'evt_ack_two', 20), { dataDir })
    const batch = await createNextSignedMeasurementBatchV1(createOptions(dataDir, identity))
    expect(batch).toBeDefined()

    const first = await acknowledgeSignedMeasurementBatchV1(batch!.batch.batchId, 'receipt_123', {
      dataDir,
      endpointId: identity.metadata.endpointId,
      now: () => new Date('2026-07-31T16:10:00.000Z'),
    })
    const duplicate = await acknowledgeSignedMeasurementBatchV1(batch!.batch.batchId, 'receipt_123', {
      dataDir,
      endpointId: identity.metadata.endpointId,
    })

    expect(first.status).toBe('acknowledged')
    expect(duplicate).toEqual({ status: 'duplicate', ack: first.ack })
    expect(await listUnacknowledgedSignedMeasurementBatchesV1({
      dataDir,
      endpointId: identity.metadata.endpointId,
    })).toEqual([])
    const outbox = await scanMeasurementOutboxV1({ dataDir })
    expect(outbox.pending).toHaveLength(0)
    expect(outbox.acknowledged).toHaveLength(2)
    await expect(acknowledgeSignedMeasurementBatchV1(batch!.batch.batchId, 'different_receipt', {
      dataDir,
      endpointId: identity.metadata.endpointId,
    })).rejects.toThrow(/different receipt/)
  })

  it('rejects negative-zero evidence before reserving an outbox sequence', async () => {
    const dataDir = await root()
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 12))
    const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })

    await expect(enqueueMeasurementEventV1(
      event(identity.metadata.endpointId, 'evt_negative_zero', -0),
      { dataDir },
    )).rejects.toThrow(/negative zero/)

    const afterRejection = await scanMeasurementOutboxV1({ dataDir })
    expect(afterRejection.pending).toHaveLength(0)
    expect(afterRejection.acknowledged).toHaveLength(0)
    expect(afterRejection.invalid).toHaveLength(0)

    const accepted = await enqueueMeasurementEventV1(
      event(identity.metadata.endpointId, 'evt_after_negative_zero', 10),
      { dataDir },
    )
    expect(accepted.record.sequence).toBe(1)

    const batch = await createNextSignedMeasurementBatchV1(createOptions(dataDir, identity))
    expect(batch?.range).toEqual({ firstSequence: 1, lastSequence: 1, eventCount: 1 })
  })

  it('fails closed when the immutable event outbox is corrupt', async () => {
    const dataDir = await root()
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 11))
    const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
    await enqueueMeasurementEventV1(event(identity.metadata.endpointId, 'evt_corrupt_source', 10), { dataDir })
    const eventsDir = join(dataDir, 'outbox', 'v1', 'events')
    const [file] = await readdir(eventsDir)
    await writeFile(join(eventsDir, file!), '{broken')

    await expect(createNextSignedMeasurementBatchV1(createOptions(dataDir, identity)))
      .rejects.toThrow(/invalid outbox events/)
  })
})
