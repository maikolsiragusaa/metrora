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
    workspace: null,
    productionLifecycle: null,
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
  }
}

function baseRuntime(): DesktopWorkspaceRuntime {
  const value = snapshot()
  return {
    getSnapshot: vi.fn(async () => value),
    createWorkspace: vi.fn(async () => ({ outcome: 'created' as const, snapshot: value })),
    setProductionMode: vi.fn(async () => ({ outcome: 'changed' as const, snapshot: value })),
    produceReviewedMeasurements: vi.fn(async () => ({
      summary: {
        kind: 'metrora.canonical-reviewed-production-summary' as const,
        version: 1 as const,
        outcome: 'completed' as const,
        scanned: true,
        eligibleCount: 0,
        producedCount: 0,
        existingCount: 0,
        withheldCount: 0,
        failedCount: 0,
      },
      snapshot: value,
    })),
    createNextBatch: vi.fn(async () => ({ outcome: 'empty' as const, snapshot: value })),
    exportEvidence: vi.fn(async outputPath => ({
      outputPath,
      verification: {
        workspaceId: 'workspace_1',
        endpointId: 'endpoint_1',
        endpointIdentityGeneration: 1,
        exportedAt: '2026-08-01T23:00:00.000Z',
        batchCount: 0,
        eventCount: 0,
        pendingBatchCount: 0,
        acknowledgedBatchCount: 0,
      },
      snapshot: value,
    })),
    dispose: vi.fn(),
  }
}

function ready(runtime: DesktopWorkspaceRuntime): DesktopWorkspaceRuntimeState {
  return {
    status: 'ready',
    endpointId: 'endpoint_1',
    publicKeyFingerprintSha256: 'a'.repeat(64),
    identityGeneration: 1,
    masterKeyState: 'loaded',
    backend: 'windows-dpapi',
    runtime,
  }
}

describe('Workspace recovery IPC', () => {
  it('ignores renderer payloads and returns only bounded recovery state', async () => {
    const recoverLocalState = vi.fn(async () => ({
      summary: {
        kind: 'metrora.desktop-workspace-recovery-summary' as const,
        version: 1 as const,
        outcome: 'reconciled' as const,
        retryAttempted: true,
        blocker: null,
        receiptRepairCount: 1,
        production: {
          kind: 'metrora.canonical-reviewed-production-summary' as const,
          version: 1 as const,
          outcome: 'completed' as const,
          scanned: true,
          eligibleCount: 0,
          producedCount: 0,
          existingCount: 0,
          withheldCount: 0,
          failedCount: 0,
        },
      },
      snapshot: snapshot(),
    }))
    const runtime = Object.assign(baseRuntime(), { recoverLocalState })
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => ready(runtime),
      chooseExportPath: async () => null,
    })

    const result = await handlers['metrora:recoverWorkspaceState']!({
      reset: true,
      deleteEvidence: true,
      sourcePath: '/private/path',
      receipts: ['private-receipt'],
    })

    expect(recoverLocalState).toHaveBeenCalledWith()
    expect(result).toMatchObject({
      ok: true,
      value: {
        summary: {
          outcome: 'reconciled',
          retryAttempted: true,
          receiptRepairCount: 1,
          production: { existingCount: 0 },
        },
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('/private/path')
    expect(serialized).not.toContain('private-receipt')
    expect(serialized).not.toContain('deleteEvidence')
  })

  it('returns a bounded unavailable result for older runtimes', async () => {
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => ready(baseRuntime()),
      chooseExportPath: async () => null,
    })

    await expect(handlers['metrora:recoverWorkspaceState']!()).resolves.toEqual({
      ok: false,
      error: {
        kind: 'workspace-recovery-unavailable',
        message: 'Local Workspace recovery is unavailable in this desktop runtime.',
      },
    })
  })

  it('sanitizes recovery failures without leaking paths', async () => {
    const recoverLocalState = vi.fn(async () => {
      const error = new Error('failed at C:\\Users\\private\\outbox')
      error.name = 'CanonicalReviewedProductionScannerIntegrityError'
      throw error
    })
    const runtime = Object.assign(baseRuntime(), { recoverLocalState })
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => ready(runtime),
      chooseExportPath: async () => null,
    })

    const result = await handlers['metrora:recoverWorkspaceState']!()
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'workspace-production-scan-failed',
        message: 'Canonical local usage could not be validated for reviewed production.',
      },
    })
    expect(JSON.stringify(result)).not.toContain('Users')
    expect(JSON.stringify(result)).not.toContain('outbox')
  })
})
