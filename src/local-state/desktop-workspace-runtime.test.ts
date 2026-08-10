import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import { loadOrCreateLocalEndpointIdentityV1 } from './endpoint-identity.js'
import { enqueueMeasurementEventV1 } from './measurement-outbox.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'
import {
  createDesktopWorkspaceRuntimeV1,
  DesktopWorkspaceSnapshotV1Schema,
} from './desktop-workspace-runtime.js'

const roots: string[] = []
const NOW = '2026-08-01T15:00:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-desktop-workspace-runtime-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function event(workspaceId: string, endpointId: string): UsageMeasurementEventV1 {
  return {
    specversion: '1.0',
    id: 'evt_desktop_workspace_runtime',
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

async function setup(dataDir: string) {
  const identity = await loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 7)),
    now: () => new Date(NOW),
  })
  const runtime = createDesktopWorkspaceRuntimeV1({
    dataDir,
    identity,
    platform: { os: 'windows', architecture: 'x64' },
    metroraVersion: '0.9.19',
    collectorVersion: '0.9.19',
    now: () => new Date(NOW),
  })
  return { identity, runtime }
}

describe.sequential('private desktop Workspace runtime v1', () => {
  it('accepts a pre-lifecycle snapshot v1 without changing its version', () => {
    expect(() => DesktopWorkspaceSnapshotV1Schema.parse({
      kind: 'metrora.desktop-workspace-snapshot',
      version: 1,
      localOnly: true,
      identity: {
        endpointId: 'endpoint_1',
        generation: 1,
        publicKeyFingerprintSha256: 'a'.repeat(64),
      },
      workspace: null,
      evidence: {
        state: 'workspace-required',
        pendingEventCount: 0,
        unbatchedEventCount: 0,
        acknowledgedEventCount: 0,
        invalidEventCount: 0,
        quarantinedEventCount: 0,
        pendingBatchCount: 0,
        acknowledgedBatchCount: 0,
        blockers: [],
      },
      privacy: {
        networkRequired: false,
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        secretsIncluded: false,
        unrestrictedLocalPathsIncluded: false,
      },
    })).not.toThrow()
  })

  it('returns only public local-only state before explicit creation', async () => {
    const dataDir = await root()
    const { runtime } = await setup(dataDir)
    const snapshot = await runtime.getSnapshot()
    expect(snapshot).toMatchObject({
      kind: 'metrora.desktop-workspace-snapshot',
      localOnly: true,
      workspace: null,
      productionLifecycle: null,
      evidence: { state: 'workspace-required' },
      privacy: {
        networkRequired: false,
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        secretsIncluded: false,
        unrestrictedLocalPathsIncluded: false,
      },
    })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('privateKey')
    expect(serialized).not.toContain('eventIdentityKey')
    expect(serialized).not.toContain(dataDir)
    runtime.dispose()
  })

  it('creates the personal workspace explicitly and defaults production to active without a state write', async () => {
    const dataDir = await root()
    const { runtime } = await setup(dataDir)
    const created = await runtime.createWorkspace({
      displayName: 'Maikòl Personal',
      endpointDisplayName: 'Windows workstation',
    })
    expect(created.outcome).toBe('created')
    expect(created.snapshot.workspace).toMatchObject({
      displayName: 'Maikòl Personal',
      slug: 'maikol-personal',
      ownership: 'personal',
      ownerRole: 'owner',
      endpoint: {
        displayName: 'Windows workstation',
        os: 'windows',
        architecture: 'x64',
        metroraVersion: '0.9.19',
        collectorVersion: '0.9.19',
        enrollmentState: 'active',
      },
    })
    expect(created.snapshot.productionLifecycle).toEqual({
      mode: 'active',
      revision: 0,
      persisted: false,
      updatedAt: null,
    })
    expect(created.snapshot.evidence.state).toBe('empty')

    const reopened = await runtime.createWorkspace({
      displayName: 'Maikòl Personal',
      endpointDisplayName: 'Windows workstation',
    })
    expect(reopened.outcome).toBe('existing')
    expect(reopened.snapshot.workspace?.workspaceId).toBe(created.snapshot.workspace?.workspaceId)
    runtime.dispose()
  })

  it('pauses and resumes only future production through bounded snapshots', async () => {
    const dataDir = await root()
    const { runtime } = await setup(dataDir)
    await runtime.createWorkspace({
      displayName: 'Local Workspace',
      endpointDisplayName: 'Primary desktop',
    })

    const paused = await runtime.setProductionMode('paused')
    expect(paused).toMatchObject({
      outcome: 'changed',
      snapshot: {
        productionLifecycle: { mode: 'paused', revision: 1, persisted: true },
        evidence: { state: 'empty', pendingEventCount: 0 },
      },
    })
    const repeated = await runtime.setProductionMode('paused')
    expect(repeated).toMatchObject({
      outcome: 'unchanged',
      snapshot: { productionLifecycle: { mode: 'paused', revision: 1 } },
    })
    const resumed = await runtime.setProductionMode('active')
    expect(resumed).toMatchObject({
      outcome: 'changed',
      snapshot: {
        productionLifecycle: { mode: 'active', revision: 2, persisted: true },
        evidence: { state: 'empty', pendingEventCount: 0 },
      },
    })

    const serialized = JSON.stringify(resumed)
    expect(serialized).not.toContain(dataDir)
    expect(serialized).not.toContain('privateKey')
    expect(serialized).not.toContain('receipt')
    runtime.dispose()
  })

  it('creates one authorized batch and writes an independently verifiable export', async () => {
    const dataDir = await root()
    const { runtime } = await setup(dataDir)
    const created = await runtime.createWorkspace({
      displayName: 'Local Workspace',
      slug: 'local-workspace',
      endpointDisplayName: 'Primary desktop',
    })
    const workspace = created.snapshot.workspace!
    await enqueueMeasurementEventV1(event(workspace.workspaceId, workspace.endpoint.endpointId), { dataDir })

    const batch = await runtime.createNextBatch()
    expect(batch).toMatchObject({
      outcome: 'created',
      batch: { firstSequence: 1, lastSequence: 1, eventCount: 1, identityGeneration: 1 },
      snapshot: {
        productionLifecycle: { mode: 'active' },
        evidence: { state: 'ready', unbatchedEventCount: 0, pendingBatchCount: 1 },
      },
    })

    const outputPath = join(dataDir, 'user-selected', 'workspace-evidence.json')
    const exported = await runtime.exportEvidence(outputPath)
    expect(exported.outputPath).toBe(outputPath)
    expect(exported.verification).toMatchObject({
      workspaceId: workspace.workspaceId,
      endpointId: workspace.endpoint.endpointId,
      batchCount: 1,
      eventCount: 1,
      pendingBatchCount: 1,
    })
    const artifact = await readFile(outputPath, 'utf-8')
    expect(artifact).toContain('metrora.local-workspace-evidence-export')
    expect(artifact).not.toContain(dataDir)
    expect(artifact).not.toContain('privateKey')
    runtime.dispose()
  })

  it('zeroes private buffers and rejects use after disposal', async () => {
    const dataDir = await root()
    const { identity, runtime } = await setup(dataDir)
    expect(identity.privateKeyPkcs8.some(byte => byte !== 0)).toBe(true)
    expect(identity.eventIdentityKey.some(byte => byte !== 0)).toBe(true)
    runtime.dispose()
    expect(identity.privateKeyPkcs8.every(byte => byte === 0)).toBe(true)
    expect(identity.eventIdentityKey.every(byte => byte === 0)).toBe(true)
    await expect(runtime.getSnapshot()).rejects.toThrow(/disposed/)
  })
})