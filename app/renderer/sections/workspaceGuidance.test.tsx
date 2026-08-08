// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DesktopWorkspaceSnapshot } from '../lib/workspace'
import { WorkspaceEvidencePanel, workspaceEvidenceViewState } from './WorkspaceEvidencePanel'
import { WorkspaceGuidancePanel } from './WorkspaceGuidancePanel'
import { WorkspaceIdentityPanel } from './WorkspaceIdentityPanel'
import { workspaceGuidance } from './workspaceGuidance'

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
      state: 'empty',
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

function guidance(value: DesktopWorkspaceSnapshot, inspection: 'pending' | 'complete' = 'complete', inspectionError = false) {
  const view = workspaceEvidenceViewState(value.evidence, inspection, inspectionError)
  return workspaceGuidance({ snapshot: value, evidenceView: view })
}

describe('workspaceGuidance', () => {
  it('maps an unconfigured Workspace to creation without inventing verification blockers', () => {
    const value = snapshot()
    value.workspace = null
    value.productionLifecycle = null
    value.evidence.state = 'workspace-required'

    const result = guidance(value)
    expect(result.collection.label).toBe('Not configured')
    expect(result.verification.label).toBe('Complete')
    expect(result.nextAction.label).toBe('Create the local Workspace')
  })

  it('keeps pending inspection read-only and blocks every next mutation conceptually', () => {
    const result = guidance(snapshot(), 'pending')
    expect(result.verification.label).toBe('Checking local data')
    expect(result.blocker.label).toBe('Waiting for verification')
    expect(result.nextAction.label).toBe('Wait for verification')
  })

  it('maps explicit lifecycle pause without claiming ordinary analytics stopped', () => {
    const value = snapshot()
    value.productionLifecycle = {
      mode: 'paused', revision: 1, persisted: true, updatedAt: '2026-08-04T00:00:00.000Z',
    }
    const result = guidance(value)
    expect(result.collection.label).toBe('Paused')
    expect(result.collection.detail).toContain('Ordinary local analytics continue')
    expect(result.nextAction.label).toBe('Resume verifiable activity')
  })

  it('uses signed-package language for ready evidence while retaining exact internal state', () => {
    const value = snapshot()
    value.evidence.state = 'ready'
    value.evidence.unbatchedEventCount = 3
    const result = guidance(value)
    expect(value.evidence.state).toBe('ready')
    expect(result.nextAction.label).toBe('Create a signed package')
    expect(result.nextAction.detail).not.toContain('outbox')
  })

  it('never hides a blocker that changes the safe next action', () => {
    const value = snapshot()
    value.evidence.state = 'blocked'
    value.evidence.invalidEventCount = 1
    value.evidence.blockers = ['receipt-chain-mismatch']
    const result = guidance(value)
    expect(result.blocker.label).toBe('Local evidence needs attention')
    expect(result.blocker.detail).toContain('1 blocking condition')
    expect(result.nextAction.label).toBe('Check and recover local state')
  })

  it('maps completed signed evidence to explicit export', () => {
    const value = snapshot()
    value.evidence.state = 'acknowledged'
    value.evidence.acknowledgedBatchCount = 1
    expect(guidance(value).nextAction.label).toBe('Export verifiable evidence')
  })
})

describe('Workspace progressive disclosure', () => {
  it('renders all four plain-language answers in the default summary', () => {
    render(<WorkspaceGuidancePanel guidance={guidance(snapshot())} />)
    expect(screen.getByTestId('workspace-guidance-collection')).toHaveTextContent('On')
    expect(screen.getByTestId('workspace-guidance-verification')).toHaveTextContent('Complete')
    expect(screen.getByTestId('workspace-guidance-blocker')).toHaveTextContent('None')
    expect(screen.getByTestId('workspace-guidance-next-action')).toHaveTextContent('Review local activity')
  })

  it('keeps technical identity details reachable behind an explicit disclosure', () => {
    render(<WorkspaceIdentityPanel workspace={snapshot().workspace!} />)
    const details = screen.getByText('Technical identity details').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Technical identity details'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('workspace_local_1')).toBeInTheDocument()
    expect(screen.getByText(/collector 1/)).toBeInTheDocument()
  })

  it('keeps blockers visible while low-level counts remain disclosed', () => {
    const value = snapshot()
    value.evidence.state = 'blocked'
    value.evidence.blockers = ['receipt-chain-mismatch']
    value.evidence.invalidEventCount = 1
    const view = workspaceEvidenceViewState(value.evidence, 'complete', false)
    render(<WorkspaceEvidencePanel evidence={value.evidence} view={view} inspectionError={false} />)

    expect(screen.getByText('receipt-chain-mismatch')).toBeVisible()
    const details = screen.getByText('Technical details').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Technical details'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Invalid')).toBeInTheDocument()
  })
})
