// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import type { DesktopWorkspaceAvailability, DesktopWorkspaceSnapshot } from '../lib/workspace'
import { WorkspaceContent } from './Workspace'

const bridge = vi.hoisted(() => ({
  getWorkspaceStatus: vi.fn(),
  inspectWorkspaceStatus: vi.fn(),
  createWorkspace: vi.fn(),
  pauseWorkspaceProduction: vi.fn(),
  resumeWorkspaceProduction: vi.fn(),
  produceWorkspaceMeasurements: vi.fn(),
  recoverWorkspaceState: vi.fn(),
  createWorkspaceBatch: vi.fn(),
  exportWorkspaceEvidence: vi.fn(),
}))
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../lib/ipc', () => ({ metrora: bridge }))
vi.mock('../lib/toast', () => ({ showToast }))

function overview(): MenubarPayload {
  return {
    current: {
      label: 'Last 7 days',
      cost: 1,
      calls: 2,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 25,
      cacheWriteTokens: 0,
      pricingCoverage: 1,
    },
  } as unknown as MenubarPayload
}

function snapshot(state: 'ready' | 'quarantined' = 'ready'): DesktopWorkspaceSnapshot {
  return {
    kind: 'metrora.desktop-workspace-snapshot',
    version: 1,
    localOnly: true,
    identity: {
      endpointId: 'endpoint_local_1',
      generation: 1,
      publicKeyFingerprintSha256: '1'.repeat(64),
    },
    workspace: {
      workspaceId: 'workspace_local_1',
      displayName: 'Local Workspace',
      slug: 'local-workspace',
      ownership: 'personal',
      status: 'active',
      ownerRole: 'owner',
      endpoint: {
        endpointId: 'endpoint_local_1',
        displayName: 'Primary desktop',
        os: 'windows',
        architecture: 'x64',
        identityGeneration: 1,
        publicKeyFingerprintSha256: '1'.repeat(64),
        metroraVersion: '0.9.19',
        collectorVersion: '0.9.19',
        capabilities: ['collect', 'normalize', 'aggregate'],
        enrollmentState: 'active',
      },
    },
    productionLifecycle: {
      mode: 'active', revision: 0, persisted: false, updatedAt: null,
    },
    evidence: {
      state,
      pendingEventCount: state === 'ready' ? 0 : 1,
      unbatchedEventCount: state === 'ready' ? 0 : 1,
      acknowledgedEventCount: 0,
      invalidEventCount: state === 'quarantined' ? 1 : 0,
      quarantinedEventCount: state === 'quarantined' ? 1 : 0,
      pendingBatchCount: 0,
      acknowledgedBatchCount: 0,
      blockers: state === 'quarantined' ? ['Evidence requires review.'] : [],
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

function availability(value = snapshot()): DesktopWorkspaceAvailability {
  return {
    availability: 'ready',
    inspection: 'complete',
    vault: { backend: 'windows-dpapi', masterKeyState: 'loaded' },
    snapshot: value,
  }
}

function pendingAvailability(): DesktopWorkspaceAvailability {
  const value = snapshot()
  value.evidence = {
    state: 'blocked',
    pendingEventCount: 0,
    unbatchedEventCount: 0,
    acknowledgedEventCount: 0,
    invalidEventCount: 0,
    quarantinedEventCount: 0,
    pendingBatchCount: 0,
    acknowledgedBatchCount: 0,
    blockers: ['Full local evidence inspection is pending.'],
  }
  return {
    availability: 'ready',
    inspection: 'pending',
    vault: { backend: 'windows-dpapi', masterKeyState: 'loaded' },
    snapshot: value,
  }
}

describe('Workspace recovery controls', () => {
  beforeEach(() => {
    for (const mock of Object.values(bridge)) mock.mockReset()
    showToast.mockReset()
    bridge.getWorkspaceStatus.mockResolvedValue(availability())
    bridge.inspectWorkspaceStatus.mockResolvedValue(availability())
  })

  it('does not recover automatically and invokes one zero-argument action explicitly', async () => {
    const reconciled = snapshot()
    reconciled.evidence.pendingEventCount = 1
    reconciled.evidence.unbatchedEventCount = 1
    bridge.recoverWorkspaceState.mockResolvedValue({
      summary: {
        kind: 'metrora.desktop-workspace-recovery-summary',
        version: 1,
        outcome: 'reconciled',
        retryAttempted: true,
        blocker: null,
        receiptRepairCount: 1,
        production: {
          kind: 'metrora.canonical-reviewed-production-summary',
          version: 1,
          outcome: 'completed',
          scanned: true,
          eligibleCount: 0,
          producedCount: 0,
          existingCount: 0,
          withheldCount: 0,
          failedCount: 0,
        },
      },
      snapshot: reconciled,
    })

    render(<WorkspaceContent payload={overview()} scope="Last 7 days · All providers" />)

    const button = await screen.findByRole('button', { name: 'Check & recover' })
    expect(bridge.recoverWorkspaceState).not.toHaveBeenCalled()
    fireEvent.click(button)

    await waitFor(() => expect(bridge.recoverWorkspaceState).toHaveBeenCalledWith())
    expect(await screen.findByTestId('workspace-recovery-summary')).toHaveTextContent(
      'Recovery: Reconciled · existing evidence preserved',
    )
    expect(screen.getByText('Pending events').parentElement).toHaveTextContent('1')
    expect(showToast).toHaveBeenCalledWith(
      'Local Workspace state was reconciled through existing private receipts.',
      undefined,
    )
  })

  it('clears a failed inspection state when explicit recovery returns a valid snapshot', async () => {
    bridge.getWorkspaceStatus.mockResolvedValue(pendingAvailability())
    bridge.inspectWorkspaceStatus.mockRejectedValue(new Error('inspection failed'))
    bridge.recoverWorkspaceState.mockResolvedValue({
      summary: {
        kind: 'metrora.desktop-workspace-recovery-summary',
        version: 1,
        outcome: 'healthy',
        retryAttempted: true,
        blocker: null,
        receiptRepairCount: 0,
        production: {
          kind: 'metrora.canonical-reviewed-production-summary',
          version: 1,
          outcome: 'completed',
          scanned: true,
          eligibleCount: 0,
          producedCount: 0,
          existingCount: 0,
          withheldCount: 0,
          failedCount: 0,
        },
      },
      snapshot: snapshot(),
    })

    render(<WorkspaceContent payload={overview()} scope="Last 7 days · All providers" />)

    expect(await screen.findByTestId('workspace-evidence-inspection-error')).toBeInTheDocument()
    const recover = screen.getByRole('button', { name: 'Check & recover' })
    expect(recover).toBeEnabled()
    fireEvent.click(recover)

    await waitFor(() => expect(bridge.recoverWorkspaceState).toHaveBeenCalledWith())
    await waitFor(() => expect(screen.queryByTestId('workspace-evidence-inspection-error')).not.toBeInTheDocument())
    expect((await screen.findAllByText('Ready to sign')).length).toBeGreaterThan(0)
    expect(screen.getByText('Pending events').parentElement).toHaveTextContent('0')
  })

  it('keeps recovery available for quarantined evidence without producing or unblocking it', async () => {
    const quarantined = snapshot('quarantined')
    bridge.getWorkspaceStatus.mockResolvedValue(availability(quarantined))
    bridge.recoverWorkspaceState.mockResolvedValue({
      summary: {
        kind: 'metrora.desktop-workspace-recovery-summary',
        version: 1,
        outcome: 'blocked',
        retryAttempted: false,
        blocker: 'invalid-evidence',
        receiptRepairCount: 0,
        production: null,
      },
      snapshot: quarantined,
    })

    render(<WorkspaceContent payload={overview()} scope="Last 7 days · All providers" />)

    const recover = await screen.findByRole('button', { name: 'Check & recover' })
    expect(recover).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Produce reviewed measurements' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sign pending usage' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export signed data' })).toBeDisabled()

    fireEvent.click(recover)
    await waitFor(() => expect(bridge.recoverWorkspaceState).toHaveBeenCalledWith())
    expect(bridge.produceWorkspaceMeasurements).not.toHaveBeenCalled()
    expect(await screen.findByTestId('workspace-recovery-summary')).toHaveTextContent(
      'Recovery: Blocked · invalid-evidence',
    )
    expect(screen.getByRole('button', { name: 'Sign pending usage' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export signed data' })).toBeDisabled()
    expect(showToast).toHaveBeenCalledWith(
      'Local evidence remains blocked. Nothing was deleted or reset.',
      'error',
    )
  })
})
