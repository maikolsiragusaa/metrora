import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CostAssignmentV1 } from '../pricing/cost-assignment.js'
import type { ParsedApiCall } from '../types.js'
import {
  attachDesktopReviewedProductionV1,
  type DesktopReviewedProductionRuntimeV1,
} from './desktop-reviewed-production-runtime.js'
import { createDesktopWorkspaceRuntimeV1 } from './desktop-workspace-runtime.js'
import {
  loadOrCreateLocalEndpointIdentityV1,
  type LoadedLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import type { LocalReviewedMeasurementContextV1 } from './reviewed-measurement-producer.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

const roots: string[] = []
const NOW = '2026-08-01T23:30:00.000Z'
const MASTER_KEY = Buffer.alloc(32, 7)

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-portable-workspace-'))
  roots.push(value)
  return value
}

function assignment(): CostAssignmentV1 {
  return {
    version: 1,
    kind: 'token-price',
    amountMicrosUsd: 200_000,
    priceRecordId: 'openai.portable-model.standard.2026-08-01',
    priceOrigin: 'reviewed-book',
    rateSelection: { kind: 'base' },
  }
}

function call(): ParsedApiCall {
  return {
    provider: 'codex',
    model: 'portable-model',
    modelProvider: 'openai',
    reasoningLevel: 'high',
    reasoningLevelSource: 'explicit',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 25,
      cachedInputTokens: 25,
      reasoningTokens: 5,
      webSearchRequests: 0,
    },
    costUSD: 0.2,
    costAssignment: assignment(),
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: NOW,
    bashCommands: [],
    deduplicationKey: 'portable-workspace-call-1',
  }
}

function context(): LocalReviewedMeasurementContextV1 {
  return {
    session: { mode: 'omit' },
    tool: { name: 'Codex', version: '0.9.19' },
    collector: {
      adapterVersion: '0.9.19',
      sourceFingerprintSha256: '2'.repeat(64),
    },
    genAi: {
      operationName: 'other',
      providerName: 'openai',
    },
  }
}

async function identity(dataDir: string): Promise<LoadedLocalEndpointIdentityV1> {
  return loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(MASTER_KEY),
    now: () => new Date(NOW),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    randomBytes: size => Buffer.alloc(size, 9),
  })
}

function runtime(
  dataDir: string,
  loadedIdentity: LoadedLocalEndpointIdentityV1,
): DesktopReviewedProductionRuntimeV1 {
  const base = createDesktopWorkspaceRuntimeV1({
    dataDir,
    identity: loadedIdentity,
    platform: { os: 'windows', architecture: 'x64' },
    metroraVersion: '0.9.19',
    collectorVersion: '0.9.19',
    now: () => new Date(NOW),
  })
  return attachDesktopReviewedProductionV1({
    runtime: base,
    dataDir,
    identity: loadedIdentity,
    adapterVersion: '0.9.19',
    scanCanonicalCandidates: async () => ({
      candidates: [{ call: call(), context: context() }],
      withheldCount: 0,
      failedCount: 0,
    }),
    now: () => new Date(NOW),
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('portable Workspace lifecycle', () => {
  it('creates, produces, pauses, recovers, resumes, signs, exports, and reopens without data loss', async () => {
    const dataDir = await root()
    const firstIdentity = await identity(dataDir)
    const first = runtime(dataDir, firstIdentity)

    const created = await first.createWorkspace({
      displayName: 'Portable Workspace',
      endpointDisplayName: 'Windows portable',
    })
    const workspaceId = created.snapshot.workspace?.workspaceId
    expect(workspaceId).toBeDefined()

    const produced = await first.produceReviewedMeasurements()
    expect(produced.summary).toMatchObject({ producedCount: 1, existingCount: 0 })
    expect(produced.snapshot.evidence).toMatchObject({ pendingEventCount: 1, unbatchedEventCount: 1 })

    await first.setProductionMode('paused')
    const pausedRecovery = await first.recoverLocalState()
    expect(pausedRecovery.summary).toMatchObject({
      outcome: 'paused', retryAttempted: false, production: null,
    })
    expect(pausedRecovery.snapshot.evidence.pendingEventCount).toBe(1)

    await first.setProductionMode('active')
    const duplicate = await first.produceReviewedMeasurements()
    expect(duplicate.summary).toMatchObject({ producedCount: 0, existingCount: 1 })
    expect(duplicate.snapshot.evidence.pendingEventCount).toBe(1)

    const batch = await first.createNextBatch()
    expect(batch).toMatchObject({
      outcome: 'created',
      batch: { eventCount: 1, firstSequence: 1, lastSequence: 1 },
      snapshot: { evidence: { unbatchedEventCount: 0, pendingBatchCount: 1 } },
    })

    const firstExportPath = join(dataDir, 'exports', 'first.json')
    const exported = await first.exportEvidence(firstExportPath)
    expect(exported.verification).toMatchObject({
      workspaceId,
      endpointId: firstIdentity.metadata.endpointId,
      batchCount: 1,
      eventCount: 1,
      pendingBatchCount: 1,
    })
    const artifact = JSON.parse(await readFile(firstExportPath, 'utf8')) as Record<string, unknown>
    expect(artifact.kind).toBe('metrora.local-workspace-evidence-export')
    expect(JSON.stringify(artifact)).not.toContain('portable-workspace-call-1')
    expect(JSON.stringify(artifact)).not.toContain(dataDir)

    const endpointId = firstIdentity.metadata.endpointId
    first.dispose()
    expect(firstIdentity.privateKeyPkcs8.every(byte => byte === 0)).toBe(true)
    expect(firstIdentity.eventIdentityKey.every(byte => byte === 0)).toBe(true)

    const reopenedIdentity = await identity(dataDir)
    expect(reopenedIdentity.metadata.endpointId).toBe(endpointId)
    const reopened = runtime(dataDir, reopenedIdentity)
    const snapshot = await reopened.getSnapshot()
    expect(snapshot.workspace?.workspaceId).toBe(workspaceId)
    expect(snapshot.productionLifecycle?.mode).toBe('active')
    expect(snapshot.evidence).toMatchObject({
      pendingEventCount: 1,
      unbatchedEventCount: 0,
      pendingBatchCount: 1,
      invalidEventCount: 0,
      quarantinedEventCount: 0,
    })

    const recovery = await reopened.recoverLocalState()
    expect(recovery.summary).toMatchObject({
      outcome: 'reconciled',
      retryAttempted: true,
      production: { producedCount: 0, existingCount: 1 },
    })
    const noSecondBatch = await reopened.createNextBatch()
    expect(noSecondBatch.outcome).toBe('empty')

    const secondExportPath = join(dataDir, 'exports', 'reopened.json')
    const reopenedExport = await reopened.exportEvidence(secondExportPath)
    expect(reopenedExport.verification).toMatchObject({
      workspaceId,
      endpointId,
      batchCount: 1,
      eventCount: 1,
    })
    reopened.dispose()
  })
})
