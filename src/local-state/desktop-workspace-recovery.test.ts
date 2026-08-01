import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CostAssignmentV1 } from '../pricing/cost-assignment.js'
import type { ParsedApiCall } from '../types.js'
import {
  attachDesktopReviewedProductionV1,
  type DesktopReviewedProductionRuntimeV1,
} from './desktop-reviewed-production-runtime.js'
import { createDesktopWorkspaceRuntimeV1 } from './desktop-workspace-runtime.js'
import { loadOrCreateLocalEndpointIdentityV1 } from './endpoint-identity.js'
import type { LocalReviewedMeasurementContextV1 } from './reviewed-measurement-producer.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

const roots: string[] = []
const NOW = '2026-08-01T23:00:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-workspace-recovery-'))
  roots.push(value)
  return value
}

function tokenAssignment(): CostAssignmentV1 {
  return {
    version: 1,
    kind: 'token-price',
    amountMicrosUsd: 123_456,
    priceRecordId: 'openai.test-model.standard.2026-08-01',
    priceOrigin: 'reviewed-book',
    rateSelection: { kind: 'base' },
  }
}

function call(): ParsedApiCall {
  return {
    provider: 'codex',
    model: 'historically-priced-test-model',
    modelProvider: 'openai',
    reasoningLevel: 'high',
    reasoningLevelSource: 'explicit',
    usage: {
      inputTokens: 60,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 40,
      cachedInputTokens: 40,
      reasoningTokens: 5,
      webSearchRequests: 0,
    },
    costUSD: 0.123456,
    costAssignment: tokenAssignment(),
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: NOW,
    bashCommands: [],
    deduplicationKey: 'desktop-recovery-call-1',
  }
}

function context(): LocalReviewedMeasurementContextV1 {
  return {
    session: { mode: 'omit' },
    tool: { name: 'Codex', version: '0.9.19' },
    collector: {
      adapterVersion: '0.9.19',
      sourceFingerprintSha256: '1'.repeat(64),
    },
    genAi: {
      operationName: 'other',
      providerName: 'openai',
    },
  }
}

async function setup(dataDir: string): Promise<DesktopReviewedProductionRuntimeV1> {
  const identity = await loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 7)),
    now: () => new Date(NOW),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    randomBytes: size => Buffer.alloc(size, 9),
  })
  const base = createDesktopWorkspaceRuntimeV1({
    dataDir,
    identity,
    platform: { os: 'windows', architecture: 'x64' },
    metroraVersion: '0.9.19',
    collectorVersion: '0.9.19',
    now: () => new Date(NOW),
  })
  return attachDesktopReviewedProductionV1({
    runtime: base,
    dataDir,
    identity,
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

describe.sequential('desktop Workspace recovery v1', () => {
  it('repairs interrupted event publication from the existing private receipt', async () => {
    const dataDir = await root()
    const runtime = await setup(dataDir)
    await runtime.createWorkspace({
      displayName: 'Local Workspace',
      endpointDisplayName: 'Primary desktop',
    })

    const produced = await runtime.produceReviewedMeasurements()
    expect(produced.summary).toMatchObject({ producedCount: 1, existingCount: 0 })
    const eventDir = join(dataDir, 'outbox', 'v1', 'events')
    const [eventFile] = await readdir(eventDir)
    expect(eventFile).toBeDefined()
    await unlink(join(eventDir, eventFile!))
    expect(await readdir(eventDir)).toEqual([])

    const recovered = await runtime.recoverLocalState()
    expect(recovered).toMatchObject({
      summary: {
        kind: 'metrora.desktop-workspace-recovery-summary',
        version: 1,
        outcome: 'reconciled',
        retryAttempted: true,
        blocker: null,
        production: { producedCount: 0, existingCount: 1 },
      },
      snapshot: {
        evidence: { pendingEventCount: 1, unbatchedEventCount: 1, invalidEventCount: 0 },
      },
    })
    expect(await readdir(eventDir)).toHaveLength(1)
    runtime.dispose()
  })

  it('stops before scanning when production is paused', async () => {
    const dataDir = await root()
    const runtime = await setup(dataDir)
    await runtime.createWorkspace({
      displayName: 'Local Workspace',
      endpointDisplayName: 'Primary desktop',
    })
    await runtime.setProductionMode('paused')

    const recovered = await runtime.recoverLocalState()
    expect(recovered).toMatchObject({
      summary: {
        outcome: 'paused',
        retryAttempted: false,
        blocker: null,
        production: null,
      },
      snapshot: { productionLifecycle: { mode: 'paused' } },
    })
    runtime.dispose()
  })

  it('returns workspace-required without creating state or scanning', async () => {
    const dataDir = await root()
    const runtime = await setup(dataDir)
    const recovered = await runtime.recoverLocalState()
    expect(recovered).toMatchObject({
      summary: {
        outcome: 'workspace-required',
        retryAttempted: false,
        blocker: null,
        production: null,
      },
      snapshot: { workspace: null, evidence: { state: 'workspace-required' } },
    })
    runtime.dispose()
  })

  it('does not retry when public evidence is already quarantined or invalid', async () => {
    const dataDir = await root()
    const base = await setup(dataDir)
    await base.createWorkspace({
      displayName: 'Local Workspace',
      endpointDisplayName: 'Primary desktop',
    })
    const healthy = await base.getSnapshot()
    const scan = vi.fn(async () => ({ candidates: [], withheldCount: 0, failedCount: 0 }))
    const runtime: DesktopReviewedProductionRuntimeV1 = {
      ...base,
      getSnapshot: async () => ({
        ...healthy,
        evidence: {
          ...healthy.evidence,
          state: 'quarantined',
          invalidEventCount: 1,
          quarantinedEventCount: 1,
        },
      }),
      produceReviewedMeasurements: base.produceReviewedMeasurements,
      recoverLocalState: base.recoverLocalState,
    }

    const recovered = await runtime.recoverLocalState()
    expect(recovered.summary).toMatchObject({
      outcome: 'blocked',
      retryAttempted: false,
      blocker: 'invalid-evidence',
      production: null,
    })
    expect(scan).not.toHaveBeenCalled()
    runtime.dispose()
  })
})
