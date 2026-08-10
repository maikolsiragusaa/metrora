import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceBatchResult,
  DesktopWorkspaceRecoverySummary,
} from '../lib/workspace'
import type { WorkspaceAction } from './useWorkspaceStatus'

export function workspaceActionErrorMessage(action: Exclude<WorkspaceAction, null>): string {
  if (action === 'reload') return 'Workspace status could not be refreshed.'
  if (action === 'create') return 'The local workspace could not be created.'
  if (action === 'produce') return 'Reviewed measurements could not be produced.'
  if (action === 'recover') return 'Local Workspace state could not be checked safely.'
  if (action === 'pause') return 'Reviewed production could not be paused.'
  if (action === 'resume') return 'Reviewed production could not be resumed.'
  if (action === 'batch') return 'The next signed batch could not be created.'
  return 'The Workspace evidence package could not be exported.'
}

export function workspaceProductionToast(summary: DesktopReviewedProductionSummary): string {
  if (summary.outcome === 'paused') return 'Reviewed production is paused.'
  return `${summary.producedCount} produced · ${summary.existingCount} already present · ${summary.withheldCount} withheld · ${summary.failedCount} failed sources.`
}

export function workspaceRecoveryLabel(summary: DesktopWorkspaceRecoverySummary): string {
  if (summary.outcome === 'workspace-required') return 'Recovery: Workspace required · retry skipped'
  if (summary.outcome === 'paused') return 'Recovery: Paused · retry skipped'
  if (summary.outcome === 'verified-read-only') return 'Recovery: Verified · read-only compatibility preserved'
  if (summary.outcome === 'blocked') return `Recovery: Blocked · ${summary.blocker ?? 'blocked-evidence'}`
  if (summary.outcome === 'healthy') return 'Recovery: Healthy · no reconciliation needed'
  return 'Recovery: Reconciled · existing evidence preserved'
}

export function workspaceRecoveryToast(summary: DesktopWorkspaceRecoverySummary): { message: string; error: boolean } {
  if (summary.outcome === 'reconciled') {
    return { message: 'Local Workspace state was reconciled through existing private receipts.', error: false }
  }
  if (summary.outcome === 'blocked') {
    return { message: 'Local evidence remains blocked. Nothing was deleted or reset.', error: true }
  }
  if (summary.outcome === 'paused') {
    return { message: 'Reviewed production is paused. Recovery stopped before scanning.', error: false }
  }
  if (summary.outcome === 'verified-read-only') {
    return { message: 'Verified historical evidence remains unchanged. Current compatibility is read-only.', error: false }
  }
  if (summary.outcome === 'workspace-required') {
    return { message: 'Create the local Workspace before recovery can run.', error: true }
  }
  return { message: 'Local Workspace state is healthy. No reconciliation was needed.', error: false }
}

export function workspaceBatchToast(result: DesktopWorkspaceBatchResult): string {
  return result.outcome === 'created'
    ? `Signed ${result.batch?.eventCount ?? 0} reviewed measurements.`
    : 'No reviewed measurements are waiting to be signed.'
}
