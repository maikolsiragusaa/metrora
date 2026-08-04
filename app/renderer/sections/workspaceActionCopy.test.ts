import { describe, expect, it } from 'vitest'

import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceBatchResult,
  DesktopWorkspaceRecoverySummary,
} from '../lib/workspace'
import {
  workspaceActionErrorMessage,
  workspaceBatchToast,
  workspaceProductionToast,
  workspaceRecoveryLabel,
  workspaceRecoveryToast,
} from './workspaceActionCopy'

function production(outcome: 'paused' | 'completed' = 'completed'): DesktopReviewedProductionSummary {
  return {
    kind: 'metrora.canonical-reviewed-production-summary',
    version: 1,
    outcome,
    scanned: outcome === 'completed',
    eligibleCount: 6,
    producedCount: 2,
    existingCount: 3,
    withheldCount: 4,
    failedCount: 1,
  }
}

function recovery(
  outcome: DesktopWorkspaceRecoverySummary['outcome'],
  blocker: DesktopWorkspaceRecoverySummary['blocker'] = null,
): DesktopWorkspaceRecoverySummary {
  return {
    kind: 'metrora.desktop-workspace-recovery-summary',
    version: 1,
    outcome,
    retryAttempted: outcome === 'reconciled',
    blocker,
    receiptRepairCount: outcome === 'reconciled' ? 1 : 0,
    production: null,
  }
}

describe('Workspace action copy', () => {
  it('keeps bridge failures generic and free of implementation details', () => {
    expect(workspaceActionErrorMessage('create')).toBe('The local workspace could not be created.')
    expect(workspaceActionErrorMessage('produce')).toBe('Reviewed measurements could not be produced.')
    expect(workspaceActionErrorMessage('recover')).toBe('Local Workspace state could not be checked safely.')
    expect(workspaceActionErrorMessage('export')).toBe('The Workspace evidence package could not be exported.')
  })

  it('formats reviewed production without changing canonical counts', () => {
    expect(workspaceProductionToast(production())).toBe(
      '2 produced · 3 already present · 4 withheld · 1 failed sources.',
    )
    expect(workspaceProductionToast(production('paused'))).toBe('Reviewed production is paused.')
  })

  it('maps every recovery outcome to bounded status and toast copy', () => {
    expect(workspaceRecoveryLabel(recovery('workspace-required'))).toBe('Recovery: Workspace required · retry skipped')
    expect(workspaceRecoveryLabel(recovery('paused'))).toBe('Recovery: Paused · retry skipped')
    expect(workspaceRecoveryLabel(recovery('blocked', 'invalid-evidence'))).toBe('Recovery: Blocked · invalid-evidence')
    expect(workspaceRecoveryLabel(recovery('healthy'))).toBe('Recovery: Healthy · no reconciliation needed')
    expect(workspaceRecoveryLabel(recovery('reconciled'))).toBe('Recovery: Reconciled · existing evidence preserved')

    expect(workspaceRecoveryToast(recovery('blocked', 'quarantined-evidence'))).toEqual({
      message: 'Local evidence remains blocked. Nothing was deleted or reset.',
      error: true,
    })
    expect(workspaceRecoveryToast(recovery('healthy'))).toEqual({
      message: 'Local Workspace state is healthy. No reconciliation was needed.',
      error: false,
    })
  })

  it('formats signed-batch results without inferring missing events', () => {
    const created = {
      outcome: 'created',
      batch: {
        batchId: 'batch_1',
        batchSha256: 'abc',
        firstSequence: 1,
        lastSequence: 3,
        eventCount: 3,
        identityGeneration: 2,
      },
      snapshot: {} as never,
    } satisfies DesktopWorkspaceBatchResult
    const empty = { outcome: 'empty', snapshot: {} as never } satisfies DesktopWorkspaceBatchResult

    expect(workspaceBatchToast(created)).toBe('Signed 3 reviewed measurements.')
    expect(workspaceBatchToast(empty)).toBe('No reviewed measurements are waiting to be signed.')
  })
})
