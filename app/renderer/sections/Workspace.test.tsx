// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveCurrency } from '../lib/format'
import type { MenubarPayload } from '../lib/types'
import type { DesktopWorkspaceAvailability, DesktopWorkspaceSnapshot } from '../lib/workspace'
import { WorkspaceContent, workspaceUsageFromOverview } from './Workspace'

const bridge = vi.hoisted(() => ({
  getWorkspaceStatus: vi.fn(),
  createWorkspace: vi.fn(),
  pauseWorkspaceProduction: vi.fn(),
  resumeWorkspaceProduction: vi.fn(),
  produceWorkspaceMeasurements: vi.fn(),
  createWorkspaceBatch: vi.fn(),
  exportWorkspaceEvidence: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({ metrora: bridge, codeburn: bridge }))

function overviewPayload(): MenubarPayload {
  return {
    current: {
      label: 'Last 7 days',
      cost: 12.34,
      calls: 56,
      sessions: 7,
      inputTokens: 1_234,
      outputTokens: 567,
      cacheReadTokens: 8_900,
      cacheWriteTokens: 321,
      pricingCoverage: 0.987,
    },
  } as unknown as MenubarPayload
}

function snapshot(withWorkspace = true): DesktopWorkspaceSnapshot {
  return {
    kind: 'metrora.desktop-workspace-snapshot',
    version: 1,
    localOnly: true,
    identity: {
      endpointId: 'endpoint_local_1',
      generation: 2,
      publicKeyFingerprintSha256: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    },
    workspace: withWorkspace ? {
      workspaceId: 'workspace_local_1',
      displayName: 'Maikol Workspace',
      slug: 'maikol-workspace',
      ownership: 'personal',
      status: 'active',
      ownerRole: 'owner',
      endpoint: {
        endpointId: 'endpoint_local_1',
        displayName: 'Main PC',
        os: 'windows',
        architecture: 'x64',
        identityGeneration: 2,
        publicKeyFingerprintSha256: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        metroraVersion: '0.9.19',
        collectorVersion: '1',
        capabilities: ['collect', 'normalize', 'aggregate'],
        enrollmentState: 'active',
      },
    } : null,
    productionLifecycle: withWorkspace ? {
      mode: 'active',
      revision: 0,
      persisted: false,
      updatedAt: null,
    } : null,
    evidence: {
      state: withWorkspace ? 'ready' : 'workspace-required',
      pendingEventCount: withWorkspace ? 3 : 0,
      unbatchedEventCount: withWorkspace ? 3 : 0,
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

function batchedSnapshot(): DesktopWorkspaceSnapshot {
  const value = snapshot(true)
  value.evidence.unbatchedEventCount = 0
  return value
}

function readyAvailability(withWorkspace = true): DesktopWorkspaceAvailability {
  return {
    availability: 'ready',
    vault: { backend: 'windows-dpapi', masterKeyState: 'loaded' },
    snapshot: snapshot(withWorkspace),
  }
}

describe('Workspace desktop view', () => {
  beforeEach(() => {
    setActiveCurrency({ code: 'USD', symbol: '$', rate: 1 })
    bridge.getWorkspaceStatus.mockReset()
    bridge.createWorkspace.mockReset()
    bridge.pauseWorkspaceProduction.mockReset()
    bridge.resumeWorkspaceProduction.mockReset()
    bridge.produceWorkspaceMeasurements.mockReset()
    bridge.createWorkspaceBatch.mockReset()
    bridge.exportWorkspaceEvidence.mockReset()
    bridge.getWorkspaceStatus.mockResolvedValue(readyAvailability())
  })

  it('projects exact canonical Overview fields without alternate aggregation', () => {
    expect(workspaceUsageFromOverview(overviewPayload())).toEqual({
      label: 'Last 7 days',
      cost: 12.34,
      calls: 56,
      sessions: 7,
      inputTokens: 1_234,
      outputTokens: 567,
      cacheReadTokens: 8_900,
      cacheWriteTokens: 321,
      pricingCoverage: 0.987,
    })
    expect(workspaceUsageFromOverview(null)).toBeNull()
  })

  it('renders canonical usage and never produces measurements while opening', async () => {
    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)

    expect(await screen.findByRole('heading', { name: 'Maikol Workspace' })).toBeInTheDocument()
    expect(screen.getByText('Last 7 days · All providers')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-cost')).toHaveTextContent('$12.34')
    expect(screen.getByTestId('workspace-calls')).toHaveTextContent('56')
    expect(screen.getByTestId('workspace-sessions')).toHaveTextContent('7')
    expect(screen.getByTestId('workspace-input-tokens')).toHaveTextContent('1.2K')
    expect(screen.getByTestId('workspace-output-tokens')).toHaveTextContent('567')
    expect(screen.getByTestId('workspace-cache-read')).toHaveTextContent('8.9K')
    expect(screen.getByTestId('workspace-cache-write')).toHaveTextContent('321')
    expect(screen.getByTestId('workspace-pricing-coverage')).toHaveTextContent('98.7%')
    expect(screen.getByText(/never recalculate them/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Produce reviewed measurements' })).toBeEnabled()
    expect(bridge.produceWorkspaceMeasurements).not.toHaveBeenCalled()
  })

  it('creates the explicit personal Workspace and reuses the runtime result', async () => {
    bridge.getWorkspaceStatus.mockResolvedValue(readyAvailability(false))
    bridge.createWorkspace.mockResolvedValue({ outcome: 'created', snapshot: snapshot(true) })

    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)

    const workspaceInput = await screen.findByLabelText('Workspace name')
    const endpointInput = screen.getByLabelText('Endpoint name')
    fireEvent.change(workspaceInput, { target: { value: 'Teamless Local' } })
    fireEvent.change(endpointInput, { target: { value: 'Windows workstation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create local Workspace' }))

    await waitFor(() => expect(bridge.createWorkspace).toHaveBeenCalledWith({
      displayName: 'Teamless Local',
      endpointDisplayName: 'Windows workstation',
    }))
    expect(await screen.findByRole('heading', { name: 'Maikol Workspace' })).toBeInTheDocument()
  })

  it('produces only after an explicit zero-argument action and shows bounded counts', async () => {
    const afterProduction = snapshot(true)
    afterProduction.evidence.pendingEventCount = 5
    afterProduction.evidence.unbatchedEventCount = 5
    bridge.produceWorkspaceMeasurements.mockResolvedValue({
      summary: {
        kind: 'metrora.canonical-reviewed-production-summary',
        version: 1,
        outcome: 'completed',
        scanned: true,
        eligibleCount: 6,
        producedCount: 2,
        existingCount: 3,
        withheldCount: 4,
        failedCount: 1,
      },
      snapshot: afterProduction,
    })

    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Produce reviewed measurements' }))

    await waitFor(() => expect(bridge.produceWorkspaceMeasurements).toHaveBeenCalledWith())
    expect(await screen.findByTestId('workspace-production-summary')).toHaveTextContent(
      'Last pass: 2 produced · 3 existing · 4 withheld · 1 failed sources',
    )
    expect(screen.getByText('Pending events').parentElement).toHaveTextContent('5')
  })

  it('pauses before scanning and resumes without touching evidence actions', async () => {
    const paused = snapshot(true)
    paused.productionLifecycle = {
      mode: 'paused', revision: 1, persisted: true, updatedAt: '2026-08-01T22:00:00.000Z',
    }
    const active = snapshot(true)
    active.productionLifecycle = {
      mode: 'active', revision: 2, persisted: true, updatedAt: '2026-08-01T23:00:00.000Z',
    }
    bridge.pauseWorkspaceProduction.mockResolvedValue({ outcome: 'changed', snapshot: paused })
    bridge.resumeWorkspaceProduction.mockResolvedValue({ outcome: 'changed', snapshot: active })

    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause production' }))

    await waitFor(() => expect(bridge.pauseWorkspaceProduction).toHaveBeenCalledWith())
    expect(screen.getByRole('button', { name: 'Produce reviewed measurements' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create signed batch' })).toBeEnabled()
    expect(screen.getByText(/paused before scanning/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume production' }))
    await waitFor(() => expect(bridge.resumeWorkspaceProduction).toHaveBeenCalledWith())
    expect(screen.getByRole('button', { name: 'Produce reviewed measurements' })).toBeEnabled()
  })

  it('requires reviewed events to enter a signed batch before export', async () => {
    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)

    const exportButton = await screen.findByRole('button', { name: 'Export verifiable evidence' })
    expect(exportButton).toBeDisabled()
    expect(screen.getByText(/create a signed batch before export/i)).toBeInTheDocument()
    expect(bridge.exportWorkspaceEvidence).not.toHaveBeenCalled()
  })

  it('keeps signing and export explicit and refreshes from returned public snapshots', async () => {
    const afterBatch = batchedSnapshot()
    bridge.createWorkspaceBatch.mockResolvedValue({
      outcome: 'created',
      batch: {
        batchId: 'batch_1',
        batchSha256: 'abc',
        firstSequence: 1,
        lastSequence: 3,
        eventCount: 3,
        identityGeneration: 2,
      },
      snapshot: afterBatch,
    })
    bridge.exportWorkspaceEvidence.mockResolvedValue({
      outcome: 'exported',
      fileName: 'metrora-workspace.json',
      verification: {
        workspaceId: 'workspace_local_1',
        endpointId: 'endpoint_local_1',
        endpointIdentityGeneration: 2,
        exportedAt: '2026-08-01T17:00:00.000Z',
        batchCount: 3,
        eventCount: 8,
        pendingBatchCount: 1,
        acknowledgedBatchCount: 2,
      },
      snapshot: afterBatch,
    })

    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create signed batch' }))
    await waitFor(() => expect(bridge.createWorkspaceBatch).toHaveBeenCalledTimes(1))

    const exportButton = screen.getByRole('button', { name: 'Export verifiable evidence' })
    await waitFor(() => expect(exportButton).toBeEnabled())
    fireEvent.click(exportButton)
    await waitFor(() => expect(bridge.exportWorkspaceEvidence).toHaveBeenCalledTimes(1))
  })

  it('disables production, signing and export for quarantined evidence and exposes invalid counts', async () => {
    const quarantined = snapshot(true)
    quarantined.evidence.state = 'quarantined'
    quarantined.evidence.invalidEventCount = 2
    quarantined.evidence.quarantinedEventCount = 1
    quarantined.evidence.unbatchedEventCount = 0
    bridge.getWorkspaceStatus.mockResolvedValue({
      availability: 'ready',
      vault: { backend: 'windows-dpapi', masterKeyState: 'loaded' },
      snapshot: quarantined,
    })

    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)

    expect((await screen.findAllByText('Evidence quarantined')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Produce reviewed measurements' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create signed batch' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export verifiable evidence' })).toBeDisabled()
    expect(screen.getByText('Invalid').parentElement).toHaveTextContent('2')
  })

  it('fails closed when the operating-system vault is unavailable', async () => {
    bridge.getWorkspaceStatus.mockResolvedValue({ availability: 'unavailable', reason: 'vault-unavailable' })

    render(<WorkspaceContent payload={overviewPayload()} scope="Last 7 days · All providers" />)

    expect(await screen.findByText(/will not open a plaintext fallback/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create local Workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Produce reviewed measurements' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export verifiable evidence' })).not.toBeInTheDocument()
  })
})
