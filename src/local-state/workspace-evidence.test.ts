import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import {
  loadOrCreateLocalEndpointIdentityV1,
  rotateLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import { createLocalPersonalWorkspaceV1 } from './local-workspace.js'
import {
  enqueueMeasurementEventV1,
  quarantineMeasurementOutboxFileV1,
} from './measurement-outbox.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'
import { acknowledgeSignedMeasurementBatchV1 } from './signed-batch.js'
import {
  createLocalWorkspaceEvidenceExportV1,
  createNextLocalWorkspaceSignedBatchV1,
  inspectLocalWorkspaceEvidenceV1,
  verifyLocalWorkspaceEvidenceExportV1,
} from './workspace-evidence.js'

const roots: string[] = []
const NOW = '2026-08-01T14:00:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-workspace-evidence-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function event(
  workspaceId: string,
  endpointId: string,
  id: string,
  outputTokens: number,
): UsageMeasurementEventV1 {
  return {
    specversion: '1.0',
    id,
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
        outputTokens,
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

async function setup(dataDir: string, keyByte = 3) {
  const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, keyByte))
  const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
  let uuid = 0
  const created = await createLocalPersonalWorkspaceV1({
    dataDir,
    endpointIdentity: identity.metadata,
    intent: {
      workspace: { displayName: 'Maikol Workspace', slug: 'maikol-workspace' },
      endpoint: {
        displayName: 'Windows workstation',
        platform: { os: 'windows', architecture: 'x64' },
        metroraVersion: '0.9.19',
        collectorVersion: '0.9.19',
        capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
      },
    },
    now: () => new Date(NOW),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
  })
  return { protector, identity, workspace: created.state }
}

function batchOptions(dataDir: string, identity: Awaited<ReturnType<typeof loadOrCreateLocalEndpointIdentityV1>>) {
  return {
    dataDir,
    identity,
    metroraVersion: '0.9.19',
    adapterSetSha256: 'a'.repeat(64),
    openTelemetryGenAiVersion: '1.37.0',
    now: () => new Date('2026-08-01T14:05:00.000Z'),
  }
}

describe.sequential('local Workspace signed evidence v1', () => {
  it('reports that an explicit workspace is required', async () => {
    const dataDir = await root()
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 2))
    const identity = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector })
    expect(await inspectLocalWorkspaceEvidenceV1({ dataDir, identity })).toMatchObject({
      state: 'workspace-required',
      unbatchedEventCount: 0,
      blockers: ['local personal workspace is not configured'],
    })
  })

  it('authorizes, signs, exports and independently verifies one workspace chain', async () => {
    const dataDir = await root()
    const { identity, workspace } = await setup(dataDir)
    await enqueueMeasurementEventV1(event(
      workspace.workspace.workspaceId,
      identity.metadata.endpointId,
      'evt_workspace_one',
      10,
    ), { dataDir })

    expect(await inspectLocalWorkspaceEvidenceV1({ dataDir, identity })).toMatchObject({
      state: 'ready',
      unbatchedEventCount: 1,
      pendingBatchCount: 0,
    })
    await expect(createLocalWorkspaceEvidenceExportV1({ dataDir, identity }))
      .rejects.toThrow(/unbatched/)

    const batch = await createNextLocalWorkspaceSignedBatchV1(batchOptions(dataDir, identity))
    expect(batch?.range).toEqual({ firstSequence: 1, lastSequence: 1, eventCount: 1 })

    const exported = await createLocalWorkspaceEvidenceExportV1({
      dataDir,
      identity,
      now: () => new Date('2026-08-01T14:10:00.000Z'),
    })
    expect(verifyLocalWorkspaceEvidenceExportV1(exported)).toMatchObject({
      workspaceId: workspace.workspace.workspaceId,
      endpointId: identity.metadata.endpointId,
      endpointIdentityGeneration: 1,
      batchCount: 1,
      eventCount: 1,
      pendingBatchCount: 1,
      acknowledgedBatchCount: 0,
    })

    const serialized = JSON.stringify(exported)
    expect(serialized).not.toContain('productionKeySha256')
    expect(serialized).not.toContain('privateKey')
    expect(serialized).not.toContain('eventIdentityKey')
    expect(serialized).not.toContain('deduplicationKey')
    expect(serialized).not.toContain(`${dataDir}`)
  })

  it('keeps the full chain verifiable across endpoint signing-key rotation', async () => {
    const dataDir = await root()
    const { protector, identity: firstIdentity, workspace } = await setup(dataDir, 4)
    await enqueueMeasurementEventV1(event(
      workspace.workspace.workspaceId,
      firstIdentity.metadata.endpointId,
      'evt_before_rotation',
      10,
    ), { dataDir })
    const first = await createNextLocalWorkspaceSignedBatchV1(batchOptions(dataDir, firstIdentity))

    const secondIdentity = await rotateLocalEndpointIdentityV1({ dataDir, protector })
    await enqueueMeasurementEventV1(event(
      workspace.workspace.workspaceId,
      secondIdentity.metadata.endpointId,
      'evt_after_rotation',
      20,
    ), { dataDir })
    const second = await createNextLocalWorkspaceSignedBatchV1(batchOptions(dataDir, secondIdentity))

    expect(first?.signature.identityGeneration).toBe(1)
    expect(second?.signature.identityGeneration).toBe(2)
    expect(second?.batch.previousBatchSha256).toBe(first?.batchSha256)

    const exported = await createLocalWorkspaceEvidenceExportV1({ dataDir, identity: secondIdentity })
    expect(verifyLocalWorkspaceEvidenceExportV1(exported)).toMatchObject({
      endpointIdentityGeneration: 2,
      batchCount: 2,
      eventCount: 2,
    })
  })

  it('fails closed when an outbox record belongs to another workspace', async () => {
    const dataDir = await root()
    const { identity } = await setup(dataDir, 5)
    await enqueueMeasurementEventV1(event(
      'workspace_foreign',
      identity.metadata.endpointId,
      'evt_foreign_workspace',
      10,
    ), { dataDir })

    const state = await inspectLocalWorkspaceEvidenceV1({ dataDir, identity })
    expect(state.state).toBe('blocked')
    expect(state.blockers.join(' ')).toMatch(/outside the local workspace endpoint/)
    await expect(createNextLocalWorkspaceSignedBatchV1(batchOptions(dataDir, identity)))
      .rejects.toThrow(/outside the local workspace endpoint/)
  })

  it('surfaces quarantined state and refuses batching or export', async () => {
    const dataDir = await root()
    const { identity, workspace } = await setup(dataDir, 6)
    await enqueueMeasurementEventV1(event(
      workspace.workspace.workspaceId,
      identity.metadata.endpointId,
      'evt_quarantine',
      10,
    ), { dataDir })
    const [eventFile] = await readdir(join(dataDir, 'outbox', 'v1', 'events'))
    await quarantineMeasurementOutboxFileV1(eventFile!, 'manual evidence review', { dataDir })

    expect(await inspectLocalWorkspaceEvidenceV1({ dataDir, identity })).toMatchObject({
      state: 'quarantined',
      quarantinedEventCount: 1,
    })
    await expect(createNextLocalWorkspaceSignedBatchV1(batchOptions(dataDir, identity)))
      .rejects.toThrow(/quarantined/)
    await expect(createLocalWorkspaceEvidenceExportV1({ dataDir, identity }))
      .rejects.toThrow(/quarantined/)
  })

  it('exports acknowledgement state without the private receipt identifier', async () => {
    const dataDir = await root()
    const { identity, workspace } = await setup(dataDir, 7)
    await enqueueMeasurementEventV1(event(
      workspace.workspace.workspaceId,
      identity.metadata.endpointId,
      'evt_ack_export',
      10,
    ), { dataDir })
    const batch = await createNextLocalWorkspaceSignedBatchV1(batchOptions(dataDir, identity))
    await acknowledgeSignedMeasurementBatchV1(batch!.batch.batchId, 'private_receipt_123', {
      dataDir,
      endpointId: identity.metadata.endpointId,
      workspaceId: workspace.workspace.workspaceId,
      now: () => new Date('2026-08-01T14:15:00.000Z'),
    })

    const exported = await createLocalWorkspaceEvidenceExportV1({ dataDir, identity })
    expect(exported.payload.batches[0]).toMatchObject({
      state: 'acknowledged',
      acknowledgement: { acknowledgedAt: '2026-08-01T14:15:00.000Z' },
    })
    expect(JSON.stringify(exported)).not.toContain('private_receipt_123')
    expect(verifyLocalWorkspaceEvidenceExportV1(exported)).toMatchObject({
      pendingBatchCount: 0,
      acknowledgedBatchCount: 1,
    })
  })

  it('rejects payload, summary and signature tampering', async () => {
    const dataDir = await root()
    const { identity, workspace } = await setup(dataDir, 8)
    await enqueueMeasurementEventV1(event(
      workspace.workspace.workspaceId,
      identity.metadata.endpointId,
      'evt_tamper_export',
      10,
    ), { dataDir })
    await createNextLocalWorkspaceSignedBatchV1(batchOptions(dataDir, identity))
    const exported = await createLocalWorkspaceEvidenceExportV1({ dataDir, identity })

    const tampered = structuredClone(exported)
    tampered.payload.summary.eventCount += 1
    expect(() => verifyLocalWorkspaceEvidenceExportV1(tampered)).toThrow(/payload digest/)

    const forgedDigest = structuredClone(exported)
    forgedDigest.payload.summary.eventCount += 1
    forgedDigest.payloadSha256 = 'f'.repeat(64)
    expect(() => verifyLocalWorkspaceEvidenceExportV1(forgedDigest)).toThrow(/payload digest|signature/)

    const badSignature = structuredClone(exported)
    badSignature.signature.signatureBase64 = Buffer.alloc(64, 9).toString('base64')
    expect(() => verifyLocalWorkspaceEvidenceExportV1(badSignature)).toThrow(/signature/)
  })
})