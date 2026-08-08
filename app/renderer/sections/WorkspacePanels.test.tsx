// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesktopWorkspaceAvailability, DesktopWorkspaceSnapshot } from '../lib/workspace'
import { WorkspaceCreationPanel } from './WorkspaceCreationPanel'
import { WorkspaceEvidenceActionsPanel } from './WorkspaceEvidenceActionsPanel'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'
import { WorkspaceIdentityPanel } from './WorkspaceIdentityPanel'
import { WorkspaceProductionPanel } from './WorkspaceProductionPanel'
import { WorkspaceUsagePanel } from './WorkspaceUsagePanel'

function snapshot(): DesktopWorkspaceSnapshot {
  return {
    kind: 'metrora.desktop-workspace-snapshot',
    version: 1,
    localOnly: true,
    identity: {
      endpointId: 'endpoint_local_1',
      generation: 2,
      publicKeyFingerprintSha256: '1234567890abcdef1234567890abcdef',
    },
    workspace: {
      workspaceId: 'workspace_local_1',
      displayName: 'Personal Workspace',
      slug: 'personal-workspace',
      ownership: 'personal',
      status: 'active',
      ownerRole: 'owner',
      endpoint: {
        endpointId: 'endpoint_local_1',
        displayName: 'Main PC',
        os: 'windows',
        architecture: 'x64',
        identityGeneration: 2,
        publicKeyFingerprintSha256: '1234567890abcdef1234567890abcdef',
        metroraVersion: '0.9.19',
        collectorVersion: '1',
        capabilities: ['collect', 'normalize', 'aggregate'],
        enrollmentState: 'active',
      },
    },
    productionLifecycle: {
      mode: 'active', revision: 0, persisted: false, updatedAt: null,
    },
    evidence: {
      state: 'ready',
      pendingEventCount: 3,
      unbatchedEventCount: 3,
      acknowledgedEventCount: 5,
      invalidEventCount: 0,
      quarantinedEventCount: 0,
      pendingBatchCount: 1,
      acknowledgedBatchCount: 2,
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

function readyAvailability(value = snapshot()): Extract<DesktopWorkspaceAvailability, { availability: 'ready' }> {
  return {
    availability: 'ready',
    inspection: 'complete',
    vault: { backend: 'windows-dpapi', masterKeyState: 'loaded' },
    snapshot: value,
  }
}

function evidenceView(overrides: Partial<WorkspaceEvidenceViewState> = {}): WorkspaceEvidenceViewState {
  return {
    inspectionPending: false,
    inspectionComplete: true,
    label: 'Ready to sign',
    description: 'Reviewed measurements are available for the next signed batch.',
    blocked: false,
    stateClass: 'ready',
    ...overrides,
  }
}

describe('Workspace focused panels', () => {
  it('keeps creation fields and protected identity reuse inside the creation panel', () => {
    const setWorkspaceName = vi.fn()
    const setEndpointName = vi.fn()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(
      <WorkspaceCreationPanel
        identity={snapshot().identity}
        workspaceName="My workspace"
        endpointName="This computer"
        action={null}
        busy={false}
        setWorkspaceName={setWorkspaceName}
        setEndpointName={setEndpointName}
        onCreate={onCreate}
      />,
    )

    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Evidence' } })
    fireEvent.change(screen.getByLabelText('Endpoint name'), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create local Workspace' }))

    expect(setWorkspaceName).toHaveBeenCalledWith('Evidence')
    expect(setEndpointName).toHaveBeenCalledWith('Laptop')
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Generation 2/)).toBeInTheDocument()
  })

  it('renders only the exact canonical usage projection supplied by composition', () => {
    render(
      <WorkspaceUsagePanel
        usage={{
          label: 'Last 7 days',
          cost: 12.34,
          calls: 56,
          sessions: 7,
          inputTokens: 1234,
          outputTokens: 567,
          cacheReadTokens: 8900,
          cacheWriteTokens: 321,
          pricingCoverage: 0.987,
        }}
        scope="Last 7 days · All providers"
        analyticsLoading={false}
      />,
    )

    expect(screen.getByTestId('workspace-cost')).toHaveTextContent('$12.34')
    expect(screen.getByTestId('workspace-calls')).toHaveTextContent('56')
    expect(screen.getByTestId('workspace-pricing-coverage')).toHaveTextContent('98.7%')
    expect(screen.getByText(/never recalculate them/i)).toBeInTheDocument()
  })

  it('preserves production enablement for blocked and paused states', () => {
    const onProduce = vi.fn().mockResolvedValue(undefined)
    const onSetProductionMode = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <WorkspaceProductionPanel
        productionPaused={false}
        evidenceView={evidenceView({ blocked: true })}
        action={null}
        busy={false}
        lastProduction={null}
        onProduce={onProduce}
        onSetProductionMode={onSetProductionMode}
      />,
    )

    expect(screen.getByRole('button', { name: 'Produce reviewed measurements' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause production' })).toBeEnabled()

    rerender(
      <WorkspaceProductionPanel
        productionPaused
        evidenceView={evidenceView()}
        action={null}
        busy={false}
        lastProduction={null}
        onProduce={onProduce}
        onSetProductionMode={onSetProductionMode}
      />,
    )
    expect(screen.getByRole('button', { name: 'Produce reviewed measurements' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Resume production' }))
    expect(onSetProductionMode).toHaveBeenCalledWith('active')
  })

  it('keeps technical identity details unchanged in the identity panel', () => {
    const workspace = snapshot().workspace!
    render(<WorkspaceIdentityPanel workspace={workspace} />)

    expect(screen.getByText('workspace_local_1')).toBeInTheDocument()
    expect(screen.getByText('Windows · x64')).toBeInTheDocument()
    expect(screen.getByText(/Metrora 0.9.19 · collector 1/)).toBeInTheDocument()
  })

  it('preserves inspection, batching and export gates in the evidence actions panel', () => {
    const availability = readyAvailability()
    const onReload = vi.fn().mockResolvedValue(undefined)
    const onRecover = vi.fn().mockResolvedValue(undefined)
    const onBatch = vi.fn().mockResolvedValue(undefined)
    const onExport = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <WorkspaceEvidenceActionsPanel
        availability={availability}
        workspace={availability.snapshot.workspace}
        evidence={availability.snapshot.evidence}
        evidenceView={evidenceView({ inspectionPending: true, inspectionComplete: false, blocked: true })}
        action={null}
        busy={false}
        lastRecovery={null}
        onReload={onReload}
        onRecover={onRecover}
        onBatch={onBatch}
        onExport={onExport}
      />,
    )

    expect(screen.getByRole('button', { name: 'Check & recover' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sign pending usage' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export signed data' })).toBeDisabled()

    const batched = snapshot()
    batched.evidence.unbatchedEventCount = 0
    const batchedAvailability = readyAvailability(batched)
    rerender(
      <WorkspaceEvidenceActionsPanel
        availability={batchedAvailability}
        workspace={batched.workspace}
        evidence={batched.evidence}
        evidenceView={evidenceView()}
        action={null}
        busy={false}
        lastRecovery={null}
        onReload={onReload}
        onRecover={onRecover}
        onBatch={onBatch}
        onExport={onExport}
      />,
    )

    expect(screen.getByRole('button', { name: 'Check & recover' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Sign pending usage' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export signed data' })).toBeEnabled()
  })
})
