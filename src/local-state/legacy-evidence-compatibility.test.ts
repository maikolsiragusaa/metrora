import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import {
  LEGACY_LOCAL_OUTBOX_RECORD_KIND,
  LEGACY_MEASUREMENT_BATCH_KIND,
  LEGACY_OUTBOX_CANONICALIZATION,
  LEGACY_OUTBOX_EVENT_FILE_PREFIX,
  LEGACY_OUTBOX_EVENT_SOURCE_PREFIX,
  LEGACY_SEMANTIC_CONVENTIONS_KEY,
  LEGACY_SIGNED_BATCH_KIND,
  LEGACY_SOFTWARE_VERSION_FIELD,
  LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  LEGACY_USAGE_MEASUREMENT_EVENT_TYPE,
} from './legacy-identity-compatibility.js'
import {
  loadOrCreateLocalEndpointIdentityV1,
  signWithLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import { createLocalPersonalWorkspaceV1 } from './local-workspace.js'
import {
  LocalMeasurementOutboxRecordV1Schema,
  scanMeasurementOutboxV1,
} from './measurement-outbox.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'
import {
  listSignedMeasurementBatchStatesV1,
} from './signed-batch.js'
import {
  createLocalWorkspaceEvidenceExportV1,
  inspectLocalWorkspaceEvidenceV1,
} from './workspace-evidence.js'
import { reconcileMeasurementProductionReceiptsV1 } from './measurement-production-recovery.js'

const roots: string[] = []
const NOW = '2026-08-02T00:05:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-legacy-evidence-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function sortedJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${sortedJson(object[key])}`).join(',')}}`
  }
  throw new Error('unsupported JSON value')
}

function semanticEventDigest(event: Record<string, unknown>): string {
  const data = event.data as Record<string, unknown>
  const collector = data.collector as Record<string, unknown>
  const { id: _id, data: _data, ...eventRest } = event
  const { collector: _collector, ...dataRest } = data
  const { adapterVersion: _adapterVersion, ...collectorRest } = collector
  return sha256(sortedJson({
    ...eventRest,
    data: { ...dataRest, collector: collectorRest },
  }))
}

function event(endpointId: string, workspaceId: string): UsageMeasurementEventV1 {
  return {
    specversion: '1.0',
    id: 'evt_legacy_transition',
    source: `urn:metrora:endpoint:${endpointId}`,
    type: USAGE_MEASUREMENT_EVENT_TYPE,
    time: NOW,
    subject: `workspace/${workspaceId}/endpoint/${endpointId}`,
    datacontenttype: 'application/json',
    dataschema: USAGE_MEASUREMENT_DATA_SCHEMA_URI,
    data: {
      version: 1,
      workspaceId,
      endpointId,
      tool: { name: 'Codex', version: '0.9.19' },
      collector: {
        adapterId: 'codex-rollout-token-count-v1',
        adapterVersion: '0.9.19',
        sourceKind: 'codex-rollout-jsonl-token-count',
        sourceFingerprintSha256: '1'.repeat(64),
      },
      genAi: {
        operationName: 'chat',
        providerName: 'openai',
        responseModel: 'gpt-5.6-luna',
      },
      usage: {
        calls: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
      },
      cost: { kind: 'unavailable' },
      reasoning: { level: 'high', source: 'explicit' },
      quality: {
        tokenCounts: 'measured',
        modelIdentity: 'exact',
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

async function fixture() {
  const dataDir = await root()
  const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 21))
  const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
  const workspace = await createLocalPersonalWorkspaceV1({
    dataDir,
    endpointIdentity: identity.metadata,
    intent: {
      workspace: { displayName: 'Legacy fixture workspace', slug: 'legacy-fixture-workspace' },
      endpoint: {
        displayName: 'Legacy fixture endpoint',
        platform: { os: 'windows', architecture: 'x64' },
        metroraVersion: '1.0.0-rc.9',
        collectorVersion: '1.0.0-rc.9',
        capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
      },
    },
    now: () => new Date(NOW),
    randomUUID: () => '00000000-0000-4000-8000-000000000021',
  })

  const currentEvent = event(identity.metadata.endpointId, workspace.state.workspace.workspaceId)
  const legacyEvent = {
    ...currentEvent,
    source: `${LEGACY_OUTBOX_EVENT_SOURCE_PREFIX}${identity.metadata.endpointId}`,
    type: LEGACY_USAGE_MEASUREMENT_EVENT_TYPE,
    dataschema: LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  }
  const legacyRecord = {
    kind: LEGACY_LOCAL_OUTBOX_RECORD_KIND,
    version: 1,
    sequence: 1,
    enqueuedAt: NOW,
    canonicalization: LEGACY_OUTBOX_CANONICALIZATION,
    eventSha256: sha256(sortedJson(legacyEvent)),
    event: legacyEvent,
  }
  const eventFile = `${sha256(`${LEGACY_OUTBOX_EVENT_FILE_PREFIX}${legacyEvent.id}`)}.json`

  const range = { firstSequence: 1, lastSequence: 1, eventCount: 1 }
  const legacyBatch = {
    kind: LEGACY_MEASUREMENT_BATCH_KIND,
    version: 1,
    batchId: 'batch_legacy_transition',
    createdAt: NOW,
    producer: {
      endpointId: identity.metadata.endpointId,
      [LEGACY_SOFTWARE_VERSION_FIELD]: '0.9.19',
      adapterSetSha256: 'a'.repeat(64),
    },
    semanticConventions: {
      cloudEvents: '1.0',
      openTelemetryGenAi: { version: '1.37.0', stability: 'development' },
      [LEGACY_SEMANTIC_CONVENTIONS_KEY]: '1',
    },
    events: [legacyEvent],
  }
  const batchSha256 = sha256(canonicalizeRfc8785(legacyBatch))
  const signedPayload = canonicalizeRfc8785({
    canonicalization: 'RFC8785',
    range,
    batchSha256,
    batch: legacyBatch,
  })
  const signature = signWithLocalEndpointIdentityV1(identity, Buffer.from(signedPayload, 'utf8'))
  const signed = {
    kind: LEGACY_SIGNED_BATCH_KIND,
    version: 1,
    canonicalization: 'RFC8785',
    range,
    batchSha256,
    signedPayloadSha256: sha256(signedPayload),
    batch: legacyBatch,
    signature: {
      algorithm: 'ed25519',
      identityGeneration: identity.metadata.generation,
      publicKeySpkiBase64: identity.metadata.publicKeySpkiBase64,
      publicKeyFingerprintSha256: identity.metadata.publicKeyFingerprintSha256,
      signatureBase64: Buffer.from(signature).toString('base64'),
    },
  }
  const batchFile = `0000000000000001-0000000000000001-${batchSha256}.json`
  const productionKeySha256 = 'b'.repeat(64)
  const productionReceipt = {
    kind: 'metrora.local-measurement-production-receipt',
    version: 1,
    productionKeySha256,
    semanticEventSha256: semanticEventDigest(legacyEvent),
    record: legacyRecord,
  }

  await mkdir(join(dataDir, 'outbox', 'v1', 'events'), { recursive: true })
  await mkdir(join(dataDir, 'outbox', 'v1', 'production'), { recursive: true })
  await mkdir(join(dataDir, 'batches', 'v1', 'signed'), { recursive: true })
  await writeFile(join(dataDir, 'outbox', 'v1', 'events', eventFile), JSON.stringify(legacyRecord))
  await writeFile(join(dataDir, 'outbox', 'v1', 'production', `${productionKeySha256}.json`), JSON.stringify(productionReceipt))
  await writeFile(join(dataDir, 'batches', 'v1', 'signed', batchFile), JSON.stringify(signed))
  await writeFile(join(dataDir, 'outbox', 'v1', 'next-sequence.json'), JSON.stringify({ version: 1, nextSequence: 2 }))

  return { dataDir, identity, workspace: workspace.state, eventFile, batchFile, legacyRecord, signed }
}

describe.sequential('historical Workspace evidence compatibility', () => {
  it('inspects exact historical outbox, receipt and signed batch forms without rewriting them', async () => {
    const value = await fixture()
    const eventPath = join(value.dataDir, 'outbox', 'v1', 'events', value.eventFile)
    const batchPath = join(value.dataDir, 'batches', 'v1', 'signed', value.batchFile)
    const eventBefore = await readFile(eventPath)
    const batchBefore = await readFile(batchPath)

    expect(LocalMeasurementOutboxRecordV1Schema.safeParse(value.legacyRecord).success).toBe(false)
    expect(await scanMeasurementOutboxV1({ dataDir: value.dataDir })).toMatchObject({
      pending: [],
      acknowledged: [],
      legacyPending: [expect.objectContaining({ sequence: 1 })],
      invalid: [],
    })
    expect((await scanMeasurementOutboxV1({ dataDir: value.dataDir })).legacyAcknowledged ?? []).toEqual([])
    const batches = await listSignedMeasurementBatchStatesV1({
      dataDir: value.dataDir,
      endpointId: value.identity.metadata.endpointId,
      workspaceId: value.workspace.workspace.workspaceId,
    })
    expect(batches).toMatchObject([{ storageFormat: 'legacy', signed: { range: { firstSequence: 1, lastSequence: 1 } } }])

    const first = await inspectLocalWorkspaceEvidenceV1({ dataDir: value.dataDir, identity: value.identity })
    const second = await inspectLocalWorkspaceEvidenceV1({ dataDir: value.dataDir, identity: value.identity })
    expect(first).toMatchObject({
      state: 'ready',
      pendingEventCount: 1,
      unbatchedEventCount: 0,
      invalidEventCount: 0,
      pendingBatchCount: 1,
      acknowledgedBatchCount: 0,
    })
    expect(second).toEqual(first)
    expect(await readFile(eventPath)).toEqual(eventBefore)
    expect(await readFile(batchPath)).toEqual(batchBefore)

    await expect(createLocalWorkspaceEvidenceExportV1({ dataDir: value.dataDir, identity: value.identity }))
      .rejects.toThrow(/immutable|canonical schema/)
    await expect(reconcileMeasurementProductionReceiptsV1({ dataDir: value.dataDir }))
      .resolves.toMatchObject({ receiptCount: 1, repairedEventCount: 0 })
    expect(value.identity.metadata.generation).toBe(1)
    expect(value.workspace.endpointIdentityGeneration).toBe(1)
    expect(value.workspace.workspace.workspaceId).toBe(value.workspace.endpoint.workspaceId)
  })

  it('rejects a legacy lookalike whose historical digest was changed and does not quarantine it', async () => {
    const value = await fixture()
    const eventPath = join(value.dataDir, 'outbox', 'v1', 'events', value.eventFile)
    const changed = { ...value.legacyRecord, eventSha256: 'f'.repeat(64) }
    await writeFile(eventPath, JSON.stringify(changed))

    const scan = await scanMeasurementOutboxV1({ dataDir: value.dataDir })
    expect(scan.legacyPending ?? []).toHaveLength(0)
    expect(scan.invalid).toHaveLength(1)
    expect(scan.quarantined).toHaveLength(0)
    expect(await readFile(eventPath, 'utf8')).toContain('f'.repeat(64))
  })

  it('rejects signed legacy payload tampering before any normalization can be used', async () => {
    const value = await fixture()
    const batchPath = join(value.dataDir, 'batches', 'v1', 'signed', value.batchFile)
    const changed = structuredClone(value.signed) as typeof value.signed
    changed.signature.signatureBase64 = Buffer.alloc(64, 7).toString('base64')
    const tampered = Buffer.from(JSON.stringify(changed))
    await writeFile(batchPath, tampered)

    await expect(listSignedMeasurementBatchStatesV1({
      dataDir: value.dataDir,
      endpointId: value.identity.metadata.endpointId,
      workspaceId: value.workspace.workspace.workspaceId,
    })).rejects.toThrow(/legacy signed batch signature is invalid/)
    expect(await readFile(batchPath)).toEqual(tampered)
  })
})
