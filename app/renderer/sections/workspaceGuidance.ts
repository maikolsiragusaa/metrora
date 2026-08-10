import type { DesktopWorkspaceSnapshot } from '../lib/workspace'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'

export type WorkspaceGuidanceTone = 'neutral' | 'good' | 'warning' | 'blocked'

export type WorkspaceGuidance = {
  collection: { label: string; detail: string; tone: WorkspaceGuidanceTone }
  verification: { label: string; detail: string; tone: WorkspaceGuidanceTone }
  blocker: { label: string; detail: string; tone: WorkspaceGuidanceTone }
  nextAction: { label: string; detail: string; tone: WorkspaceGuidanceTone }
}

export function workspaceGuidance({
  snapshot,
  evidenceView,
}: {
  snapshot: DesktopWorkspaceSnapshot
  evidenceView: WorkspaceEvidenceViewState
}): WorkspaceGuidance {
  const workspace = snapshot.workspace
  const evidence = snapshot.evidence
  const capabilities = snapshot.capabilities
  const paused = snapshot.productionLifecycle?.mode === 'paused'

  const collection: WorkspaceGuidance['collection'] = !workspace
    ? {
        label: 'Not configured',
        detail: 'Create the local Workspace before Metrora can prepare verifiable activity.',
        tone: 'neutral',
      }
    : paused
      ? {
          label: 'Paused',
          detail: 'No new verifiable activity is prepared. Ordinary local analytics continue unchanged.',
          tone: 'warning',
        }
      : {
          label: 'On',
          detail: 'Verifiable activity can be prepared only when you start the explicit review action.',
          tone: 'good',
        }

  const verification: WorkspaceGuidance['verification'] = evidenceView.inspectionPending
    ? {
        label: 'Checking local data',
        detail: 'Background verification is read-only. Mutation-capable actions stay gated until it finishes.',
        tone: 'neutral',
      }
    : !evidenceView.inspectionComplete
      ? {
          label: 'Unavailable',
          detail: 'Verification did not complete. Existing evidence was not changed.',
          tone: 'blocked',
        }
      : {
          label: 'Complete',
          detail: 'The current local evidence state has been checked without changing it.',
          tone: 'good',
        }

  const hasEvidenceBlocker = evidence.integrity === 'invalid'
    || evidence.integrity === 'quarantined'
    || evidence.blockers.length > 0
    || evidence.invalidEventCount > 0
    || evidence.quarantinedEventCount > 0
  const blocker: WorkspaceGuidance['blocker'] = evidenceView.inspectionPending
    ? {
        label: 'Waiting for verification',
        detail: 'Signing and export wait for the read-only check; Check & recover remains available.',
        tone: 'neutral',
      }
    : !evidenceView.inspectionComplete
      ? {
          label: 'Verification needs attention',
          detail: 'Use the explicit recovery action to retry safely. Nothing is reset automatically.',
          tone: 'blocked',
        }
      : hasEvidenceBlocker
        ? {
            label: 'Local evidence needs attention',
            detail: evidence.blockers.length > 0
              ? `${evidence.blockers.length} blocking condition${evidence.blockers.length === 1 ? '' : 's'} must remain visible before signing or export.`
              : 'Blocked, invalid, or isolated evidence prevents signing and export.',
            tone: 'blocked',
          }
        : {
            label: 'None',
            detail: 'No local evidence blocker is preventing the next safe action.',
            tone: 'good',
          }

  let nextAction: WorkspaceGuidance['nextAction']
  if (!workspace) {
    nextAction = {
      label: 'Create the local Workspace',
      detail: 'This reuses the protected identity already stored on this computer.',
      tone: 'neutral',
    }
  } else if (evidenceView.inspectionPending) {
    nextAction = {
      label: 'Wait for verification',
      detail: 'Metrora will not enable mutation-capable evidence actions early.',
      tone: 'neutral',
    }
  } else if (!evidenceView.inspectionComplete || hasEvidenceBlocker) {
    nextAction = {
      label: 'Check and recover local state',
      detail: 'Recovery is manual, bounded, and preserves existing evidence.',
      tone: 'blocked',
    }
  } else if (paused) {
    nextAction = {
      label: 'Resume verifiable activity',
      detail: 'Resuming changes only evidence preparation; ordinary analytics never stopped.',
      tone: 'warning',
    }
  } else if (!capabilities.batchSign.allowed) {
    nextAction = {
      label: 'Review Workspace compatibility',
      detail: 'The verified local evidence remains readable, but the current runtime keeps signing and export unavailable.',
      tone: 'warning',
    }
  } else if (!capabilities.canonicalExport.allowed && capabilities.canonicalExport.reason === 'unbatched-evidence') {
    nextAction = {
      label: 'Create a signed package',
      detail: 'Reviewed local activity is waiting to be signed before export.',
      tone: 'good',
    }
  } else if (capabilities.canonicalExport.allowed && evidence.pendingBatchCount + evidence.acknowledgedBatchCount > 0) {
    nextAction = {
      label: 'Export verifiable evidence',
      detail: 'The signed local chain is ready for an explicit user-owned export.',
      tone: 'good',
    }
  } else {
    nextAction = {
      label: 'Review local activity',
      detail: 'Start an explicit scan to prepare source-present activity for verification.',
      tone: 'good',
    }
  }

  return { collection, verification, blocker, nextAction }
}
