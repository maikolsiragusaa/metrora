import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

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
      blockers: ['Local personal workspace is not configured.'],
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

function runtime(overrides: Partial<DesktopWorkspaceRuntime> = {}): DesktopWorkspaceRuntime {
  const current = snapshot()
  return {
    getSnapshot: vi.fn(async () => current),
    createWorkspace: vi.fn(async () => ({ outcome: 'created' as const, snapshot: current })),
    setProductionMode: vi.fn(async () => ({ outcome: 'changed' as const, snapshot: current })),
    produceReviewedMeasurements: vi.fn(async () => ({
      summary: {
        kind: 'metrora.canonical-reviewed-production-summary' as const,
        version: 1 as const,
        outcome: 'completed' as const,
        scanned: true,
        eligibleCount: 4,
        producedCount: 2,
        existingCount: 1,
        withheldCount: 1,
        failedCount: 0,
      },
      snapshot: current,
    })),
    createNextBatch: vi.fn(async () => ({ outcome: 'empty' as const, snapshot: current })),
    exportEvidence: vi.fn(async outputPath => ({
      outputPath,
      verification: {
        workspaceId: 'workspace_1',
        endpointId: 'endpoint_1',
        endpointIdentityGeneration: 1,
        exportedAt: '2026-08-01T15:00:00.000Z',
        batchCount: 0,
        eventCount: 0,
        pendingBatchCount: 0,
        acknowledgedBatchCount: 0,
      },
      snapshot: current,
    })),
    dispose: vi.fn(),
    ...overrides,
  }
}

function readyState(value = runtime()): DesktopWorkspaceRuntimeState {
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

describe('Workspace IPC bridge', () => {
  it('returns the public snapshot and vault state without secret material', async () => {
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => readyState(),
      chooseExportPath: async () => null,
    })
    const result = await handlers['metrora:getWorkspaceStatus']!()
    expect(result).toMatchObject({
      ok: true,
      value: {
        availability: 'ready',
        vault: { backend: 'windows-dpapi', masterKeyState: 'loaded' },
        snapshot: { identity: { endpointId: 'endpoint_1' }, productionLifecycle: null },
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('privateKey')
    expect(serialized).not.toContain('eventIdentityKey')
    expect(serialized).not.toContain('dataDir')
  })

  it('surfaces unsupported and unavailable states without throwing', async () => {
    const unsupported = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => ({ status: 'unsupported-platform', platform: 'linux' }),
      chooseExportPath: async () => null,
    })
    await expect(unsupported['metrora:getWorkspaceStatus']!()).resolves.toEqual({
      ok: true,
      value: { availability: 'unsupported-platform', platform: 'linux' },
    })
    await expect(unsupported['metrora:createWorkspace']!({
      displayName: 'Local', endpointDisplayName: 'Desktop',
    })).resolves.toMatchObject({ ok: false, error: { kind: 'workspace-unsupported' } })
    await expect(unsupported['metrora:produceWorkspaceMeasurements']!()).resolves.toMatchObject({
      ok: false,
      error: { kind: 'workspace-unsupported' },
    })

    const unavailable = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => ({ status: 'unavailable', reason: 'vault-unavailable' }),
      chooseExportPath: async () => null,
    })
    await expect(unavailable['metrora:getWorkspaceStatus']!()).resolves.toEqual({
      ok: true,
      value: { availability: 'unavailable', reason: 'vault-unavailable' },
    })
  })

  it('validates create input before invoking the private runtime', async () => {
    const privateRuntime = runtime()
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => readyState(privateRuntime),
      chooseExportPath: async () => null,
    })
    for (const invalid of [null, [], { displayName: '', endpointDisplayName: 'Desktop' }]) {
      await expect(handlers['metrora:createWorkspace']!(invalid)).resolves.toEqual({
        ok: false,
        error: { kind: 'bad-args', message: 'Workspace input is invalid.' },
      })
    }
    expect(privateRuntime.createWorkspace).not.toHaveBeenCalled()

    await expect(handlers['metrora:createWorkspace']!({
      displayName: 'Maikol Workspace',
      slug: 'maikol-workspace',
      endpointDisplayName: 'Desktop',
    })).resolves.toMatchObject({ ok: true, value: { outcome: 'created' } })
    expect(privateRuntime.createWorkspace).toHaveBeenCalledWith({
      displayName: 'Maikol Workspace',
      slug: 'maikol-workspace',
      endpointDisplayName: 'Desktop',
    })
  })

  it('maps pause and resume to fixed private runtime modes without renderer input', async () => {
    const privateRuntime = runtime()
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => readyState(privateRuntime),
      chooseExportPath: async () => null,
    })

    await expect(handlers['metrora:pauseWorkspaceProduction']!({ arbitrary: 'ignored' })).resolves.toMatchObject({
      ok: true,
      value: { outcome: 'changed' },
    })
    await expect(handlers['metrora:resumeWorkspaceProduction']!('ignored')).resolves.toMatchObject({
      ok: true,
      value: { outcome: 'changed' },
    })
    expect(privateRuntime.setProductionMode).toHaveBeenNthCalledWith(1, 'paused')
    expect(privateRuntime.setProductionMode).toHaveBeenNthCalledWith(2, 'active')
  })

  it('invokes reviewed production without accepting renderer evidence inputs', async () => {
    const privateRuntime = runtime()
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => readyState(privateRuntime),
      chooseExportPath: async () => null,
    })

    const result = await handlers['metrora:produceWorkspaceMeasurements']!({
      calls: [{ private: true }],
      sourcePath: '/private/path',
      provider: 'invented',
    })

    expect(privateRuntime.produceReviewedMeasurements).toHaveBeenCalledWith()
    expect(result).toMatchObject({
      ok: true,
      value: {
        summary: {
          outcome: 'completed',
          eligibleCount: 4,
          producedCount: 2,
          existingCount: 1,
          withheldCount: 1,
          failedCount: 0,
        },
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('/private/path')
    expect(serialized).not.toContain('invented')
    expect(serialized).not.toContain('calls')
  })

  it('creates batches through the private runtime', async () => {
    const privateRuntime = runtime()
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => readyState(privateRuntime),
      chooseExportPath: async () => null,
    })
    await expect(handlers['metrora:createWorkspaceBatch']!()).resolves.toMatchObject({
      ok: true,
      value: { outcome: 'empty' },
    })
    expect(privateRuntime.createNextBatch).toHaveBeenCalledTimes(1)
  })

  it('keeps the selected export path in main and returns only the filename', async () => {
    const privateRuntime = runtime()
    const selected = path.resolve('/private/user/documents/Metrora-Workspace-Evidence-2026-08-01.json')
    const chooseExportPath = vi.fn(async () => selected)
    const handlers = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => readyState(privateRuntime),
      chooseExportPath,
      now: () => new Date('2026-08-01T15:00:00.000Z'),
    })
    const result = await handlers['metrora:exportWorkspaceEvidence']!()
    expect(chooseExportPath).toHaveBeenCalledWith('Metrora-Workspace-Evidence-2026-08-01.json')
    expect(privateRuntime.exportEvidence).toHaveBeenCalledWith(selected)
    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: 'exported',
        fileName: 'Metrora-Workspace-Evidence-2026-08-01.json',
      },
    })
    expect(JSON.stringify(result)).not.toContain('/private/user/documents')
  })

  it('returns cancellation and sanitizes runtime, lifecycle, and scanner failures', async () => {
    const privateRuntime = runtime({
      createNextBatch: vi.fn(async () => { throw new Error('/secret/path should not cross IPC') }),
      setProductionMode: vi.fn(async () => {
        const error = new Error('/private/lifecycle/path')
        error.name = 'LocalWorkspaceProductionLifecycleRecoveryRequiredError'
        throw error
      }),
      produceReviewedMeasurements: vi.fn(async () => {
        const error = new Error('/private/cache/path')
        error.name = 'CanonicalReviewedProductionScannerIntegrityError'
        throw error
      }),
    })
    const cancelled = createWorkspaceBridgeHandlers({
      getRuntimeState: async () => readyState(privateRuntime),
      chooseExportPath: async () => null,
    })
    await expect(cancelled['metrora:exportWorkspaceEvidence']!()).resolves.toEqual({
      ok: true,
      value: { outcome: 'cancelled' },
    })
    expect(privateRuntime.exportEvidence).not.toHaveBeenCalled()

    const failed = await cancelled['metrora:createWorkspaceBatch']!()
    expect(failed).toEqual({
      ok: false,
      error: { kind: 'workspace-action-failed', message: 'The local Workspace action failed.' },
    })
    expect(JSON.stringify(failed)).not.toContain('/secret/path')

    const lifecycle = await cancelled['metrora:pauseWorkspaceProduction']!()
    expect(lifecycle).toEqual({
      ok: false,
      error: {
        kind: 'workspace-lifecycle-recovery-required',
        message: 'Local Workspace production state requires recovery.',
      },
    })
    expect(JSON.stringify(lifecycle)).not.toContain('/private/lifecycle/path')

    const scanner = await cancelled['metrora:produceWorkspaceMeasurements']!()
    expect(scanner).toEqual({
      ok: false,
      error: {
        kind: 'workspace-production-scan-failed',
        message: 'Canonical local usage could not be validated for reviewed production.',
      },
    })
    expect(JSON.stringify(scanner)).not.toContain('/private/cache/path')
  })
})
