// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceAvailability,
  DesktopWorkspaceRecoverySummary,
  DesktopWorkspaceSnapshot,
  WorkspaceBridge,
} from '../lib/workspace'
import { useWorkspaceController } from './useWorkspaceController'

const showToast = vi.hoisted(() => vi.fn())

vi.mock('../lib/ipc', () => ({ metrora: {} }))
vi.mock('../lib/toast', () => ({ showToast }))

const bridge = {
  getWorkspaceStatus: vi.fn<WorkspaceBridge['getWorkspaceStatus']>(),
  inspectWorkspaceStatus: vi.fn<WorkspaceBridge['inspectWorkspaceStatus']>(),
  createWorkspace: vi.fn<WorkspaceBridge['createWorkspace']>(),
  pauseWorkspaceProduction: vi.fn<WorkspaceBridge['pauseWorkspaceProduction']>(),
  resumeWorkspaceProduction: vi.fn<WorkspaceBridge['resumeWorkspaceProduction']>(),
  produceWorkspaceMeasurements: vi.fn<WorkspaceBridge['produceWorkspaceMeasurements']>(),
  recoverWorkspaceState: vi.fn<WorkspaceBridge['recoverWorkspaceState']>(),
  createWorkspaceBatch: vi.fn<WorkspaceBridge['createWorkspaceBatch']>(),
  exportWorkspaceEvidence: vi.fn<WorkspaceBridge['exportWorkspaceEvidence']>(),
} satisfies WorkspaceBridge

function snapshot(withWorkspace = true): DesktopWorkspaceSnapshot {
  return {
    kind: 'metrora.desktop-workspace-snapshot',
    version: 1,
    localOnly: true,
    identity: {
      endpointId: 'endpoint_local_1',
      generation: 2,
      publicKeyFingerprintSha256: '1234567890abcdef',
    },
    workspace: withWorkspace ? {
      workspaceId: 'workspace_local_1',
      displayName: 'Local Workspace',
      slug: 'local-workspace',
      ownership: 'personal',
      status: 'active',
      ownerRole: 'owner',
      endpoint: {
        endpointId: 'endpoint_local_1',
        displayName: 'This computer',
        os: 'windows',
        architecture: 'x64',
        identityGeneration: 2,
        publicKeyFingerprintSha256: '1234567890abcdef',
        metroraVersion: '0.9.19',
        collectorVersion: '1',
        capabilities: ['collect', 'normalize', 'aggregate'],
        enrollmentState: 'active',
      },
    } : null,
    productionLifecycle: withWorkspace ? {
      mode: 'active', revision: 0, persisted: false, updatedAt: null,
    } : null,
    evidence: {
      state: withWorkspace ? 'ready' : 'workspace-required',
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

function ready(value = snapshot()): DesktopWorkspaceAvailability {
  return {
    availability: 'ready',
    inspection: 'complete',
    vault: { backend: 'windows-dpapi', masterKeyState: 'loaded' },
    snapshot: value,
  }
}

function production(): DesktopReviewedProductionSummary {
  return {
    kind: 'metrora.canonical-reviewed-production-summary',
    version: 1,
    outcome: 'completed',
    scanned: true,
    eligibleCount: 3,
    producedCount: 2,
    existingCount: 1,
    withheldCount: 0,
    failedCount: 0,
  }
}

function recovery(): DesktopWorkspaceRecoverySummary {
  return {
    kind: 'metrora.desktop-workspace-recovery-summary',
    version: 1,
    outcome: 'reconciled',
    retryAttempted: true,
    blocker: null,
    receiptRepairCount: 1,
    production: production(),
  }
}

describe('useWorkspaceController', () => {
  beforeEach(() => {
    showToast.mockReset()
    for (const method of Object.values(bridge)) method.mockReset()
    bridge.getWorkspaceStatus.mockResolvedValue(ready())
    bridge.inspectWorkspaceStatus.mockResolvedValue(ready())
  })

  it('blocks every mutation while the Workspace bootstrap is opening', async () => {
    let resolveStatus!: (value: DesktopWorkspaceAvailability) => void
    bridge.getWorkspaceStatus.mockReturnValue(new Promise(resolve => { resolveStatus = resolve }))

    const { result } = renderHook(() => useWorkspaceController(bridge))
    expect(result.current.action).toBe('reload')
    expect(result.current.busy).toBe(true)

    await act(async () => {
      await result.current.createWorkspace()
      await result.current.produceMeasurements()
      await result.current.recoverLocalState()
      await result.current.setProductionMode('paused')
      await result.current.createBatch()
      await result.current.exportEvidence()
    })

    expect(bridge.createWorkspace).not.toHaveBeenCalled()
    expect(bridge.produceWorkspaceMeasurements).not.toHaveBeenCalled()
    expect(bridge.recoverWorkspaceState).not.toHaveBeenCalled()
    expect(bridge.pauseWorkspaceProduction).not.toHaveBeenCalled()
    expect(bridge.createWorkspaceBatch).not.toHaveBeenCalled()
    expect(bridge.exportWorkspaceEvidence).not.toHaveBeenCalled()

    resolveStatus(ready())
    await waitFor(() => expect(result.current.busy).toBe(false))
  })

  it('trims creation input, accepts the returned snapshot and clears bounded result state', async () => {
    const created = snapshot(true)
    bridge.createWorkspace.mockResolvedValue({ outcome: 'created', snapshot: created })
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.busy).toBe(false))

    act(() => {
      result.current.setWorkspaceName('  Personal evidence  ')
      result.current.setEndpointName('  Main PC  ')
    })
    await act(async () => { await result.current.createWorkspace() })

    expect(bridge.createWorkspace).toHaveBeenCalledWith({
      displayName: 'Personal evidence',
      endpointDisplayName: 'Main PC',
    })
    expect(result.current.availability).toEqual(ready(created))
    expect(showToast).toHaveBeenCalledWith('Local workspace created.')
    expect(result.current.action).toBeNull()
  })

  it('keeps production and recovery explicit while preserving returned summaries', async () => {
    const afterProduction = snapshot()
    afterProduction.evidence.pendingEventCount = 2
    bridge.produceWorkspaceMeasurements.mockResolvedValue({
      summary: production(),
      snapshot: afterProduction,
    })
    bridge.recoverWorkspaceState.mockResolvedValue({
      summary: recovery(),
      snapshot: afterProduction,
    })
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.busy).toBe(false))

    await act(async () => { await result.current.produceMeasurements() })
    expect(bridge.produceWorkspaceMeasurements).toHaveBeenCalledWith()
    expect(result.current.lastProduction).toEqual(production())
    expect(result.current.lastRecovery).toBeNull()

    await act(async () => { await result.current.recoverLocalState() })
    expect(bridge.recoverWorkspaceState).toHaveBeenCalledWith()
    expect(result.current.lastRecovery).toEqual(recovery())
    expect(result.current.lastProduction).toEqual(production())
    expect(showToast).toHaveBeenLastCalledWith(
      'Local Workspace state was reconciled through existing private receipts.',
      undefined,
    )
  })

  it('sanitizes bridge failures instead of exposing thrown details', async () => {
    bridge.produceWorkspaceMeasurements.mockRejectedValue(
      new Error('C:\\Users\\private\\secret-source.jsonl'),
    )
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.busy).toBe(false))

    await act(async () => { await result.current.produceMeasurements() })

    expect(showToast).toHaveBeenCalledWith('Reviewed measurements could not be produced.', 'error')
    expect(JSON.stringify(showToast.mock.calls)).not.toContain('secret-source')
    expect(result.current.action).toBeNull()
  })

  it('keeps pause, signing and export as separate zero-argument actions', async () => {
    const paused = snapshot()
    paused.productionLifecycle = {
      mode: 'paused', revision: 1, persisted: true, updatedAt: '2026-08-04T00:00:00.000Z',
    }
    bridge.pauseWorkspaceProduction.mockResolvedValue({ outcome: 'changed', snapshot: paused })
    bridge.createWorkspaceBatch.mockResolvedValue({ outcome: 'empty', snapshot: paused })
    bridge.exportWorkspaceEvidence.mockResolvedValue({ outcome: 'cancelled' })
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.busy).toBe(false))

    await act(async () => { await result.current.setProductionMode('paused') })
    await act(async () => { await result.current.createBatch() })
    await act(async () => { await result.current.exportEvidence() })

    expect(bridge.pauseWorkspaceProduction).toHaveBeenCalledWith()
    expect(bridge.createWorkspaceBatch).toHaveBeenCalledWith()
    expect(bridge.exportWorkspaceEvidence).toHaveBeenCalledWith()
    expect(showToast).toHaveBeenCalledWith('Reviewed production paused.')
    expect(showToast).toHaveBeenCalledWith('No reviewed measurements are waiting to be signed.')
  })
})
