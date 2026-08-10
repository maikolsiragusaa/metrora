import { describe, expect, it, vi } from 'vitest'

import type {
  DesktopWorkspaceRuntime,
  DesktopWorkspaceRuntimeState,
  DesktopWorkspaceSnapshot,
} from './local-state'
import { createWorkspaceBridgeHandlers } from './workspace'

function snapshot(): DesktopWorkspaceSnapshot {
  return {
    kind: 'metrora.desktop-workspace-snapshot',
    version: 1,
    localOnly: true,
    identity: {
      endpointId: 'endpoint_1',
      generation: 1,
      publicKeyFingerprintSha256: 'a'.repeat(64),
    },
    workspace: {
      workspaceId: 'workspace_1',
      displayName: 'My workspace',
      slug: 'my-workspace',
      ownership: 'personal',
      status: 'active',
      ownerRole: 'owner',
      endpoint: {
        endpointId: 'endpoint_1',
        displayName: 'This computer',
        os: 'windows',
        architecture: 'x64',
        identityGeneration: 1,
        publicKeyFingerprintSha256: 'a'.repeat(64),
        metroraVersion: '0.9.20',
        collectorVersion: '0.9.20',
        capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
        enrollmentState: 'active',
      },
    },
    productionLifecycle: { mode: 'active', revision: 0, persisted: false, updatedAt: null },
    evidence: {
      state: 'blocked',
      integrity: 'unverified',
      compatibility: 'uninspected',
      pendingEventCount: 0,
      unbatchedEventCount: 0,
      acknowledgedEventCount: 0,
      invalidEventCount: 0,
      quarantinedEventCount: 0,
      pendingBatchCount: 0,
      acknowledgedBatchCount: 0,
      storage: {
        canonicalEventCount: 0,
        historicalEventCount: 0,
        canonicalUnbatchedEventCount: 0,
        historicalUnbatchedEventCount: 0,
        canonicalBatchCount: 0,
        historicalBatchCount: 0,
      },
      blockers: ['Full local evidence inspection is pending.'],
    },
    capabilities: {
      inspection: { allowed: true, reason: null },
      reviewedProduction: { allowed: false, reason: 'inspection-pending' },
      batchSign: { allowed: false, reason: 'inspection-pending' },
      canonicalExport: { allowed: false, reason: 'inspection-pending' },
      recovery: { allowed: true, reason: null },
      productionLifecycle: { allowed: false, reason: 'inspection-pending' },
    },
    privacy: {
      networkRequired: false,
      promptsIncluded: false,
      responsesIncluded: false,
      sourceCodeIncluded: false,
      secretsIncluded: false,
      unrestrictedLocalPathsIncluded: false,
    },
  }
}

function inspectedSnapshot(): DesktopWorkspaceSnapshot {
  const value = snapshot()
  value.evidence = {
    state: 'ready',
    integrity: 'verified',
    compatibility: 'canonical',
    pendingEventCount: 12,
    unbatchedEventCount: 8,
    acknowledgedEventCount: 0,
    invalidEventCount: 0,
    quarantinedEventCount: 0,
    pendingBatchCount: 1,
    acknowledgedBatchCount: 0,
    storage: {
      canonicalEventCount: 12,
      historicalEventCount: 0,
      canonicalUnbatchedEventCount: 8,
      historicalUnbatchedEventCount: 0,
      canonicalBatchCount: 1,
      historicalBatchCount: 0,
    },
    blockers: [],
  }
  value.capabilities = {
    inspection: { allowed: true, reason: null },
    reviewedProduction: { allowed: true, reason: null },
    batchSign: { allowed: true, reason: null },
    canonicalExport: { allowed: false, reason: 'unbatched-evidence' },
    recovery: { allowed: true, reason: null },
    productionLifecycle: { allowed: true, reason: null },
  }
  return value
}

function runtime(): DesktopWorkspaceRuntime & {
  getBootstrapSnapshot(): Promise<DesktopWorkspaceSnapshot>
} {
  return {
    getBootstrapSnapshot: vi.fn(async () => snapshot()),
    getSnapshot: vi.fn(async () => inspectedSnapshot()),
    createWorkspace: vi.fn(),
    setProductionMode: vi.fn(),
    produceReviewedMeasurements: vi.fn(),
    createNextBatch: vi.fn(),
    exportEvidence: vi.fn(),
    dispose: vi.fn(),
  }
}

function ready(value: DesktopWorkspaceRuntime): DesktopWorkspaceRuntimeState {
  return {
    status: 'ready',
    endpointId: 'endpoint_1',
    publicKeyFingerprintSha256: 'a'.repeat(64),
    identityGeneration: 1,
    masterKeyState: 'loaded',
    backend: 'windows-dpapi',
    runtime: value,
  }
}

describe('Workspace bootstrap status', () => {
  it('returns the fail-closed bootstrap snapshot without awaiting full evidence inspection', async () => {
    const privateRuntime = runtime()
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => ready(privateRuntime),
      chooseExportPath: async () => null,
    })

    await expect(handlers['metrora:getWorkspaceStatus']!()).resolves.toMatchObject({
      ok: true,
      value: {
        availability: 'ready',
        inspection: 'pending',
        snapshot: {
          workspace: { displayName: 'My workspace' },
          evidence: { state: 'blocked' },
        },
      },
    })
    expect(privateRuntime.getBootstrapSnapshot).toHaveBeenCalledTimes(1)
    expect(privateRuntime.getSnapshot).not.toHaveBeenCalled()
  })

  it('runs the complete evidence inspection only through the read-only inspection channel', async () => {
    const privateRuntime = runtime()
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => ready(privateRuntime),
      chooseExportPath: async () => null,
    })

    await expect(handlers['metrora:inspectWorkspaceStatus']!()).resolves.toMatchObject({
      ok: true,
      value: {
        availability: 'ready',
        inspection: 'complete',
        snapshot: {
          evidence: {
            state: 'ready',
            pendingEventCount: 12,
            unbatchedEventCount: 8,
          },
        },
      },
    })
    expect(privateRuntime.getSnapshot).toHaveBeenCalledTimes(1)
    expect(privateRuntime.getBootstrapSnapshot).not.toHaveBeenCalled()
    expect(privateRuntime.produceReviewedMeasurements).not.toHaveBeenCalled()
  })
})
