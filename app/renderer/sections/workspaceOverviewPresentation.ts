import type { DesktopWorkspaceSnapshot } from '../lib/workspace'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'

export type WorkspaceEvidenceSummaryTone = 'neutral' | 'good' | 'warning' | 'blocked'

export type WorkspaceEvidenceSummary = {
  label: 'Verified' | 'Ready' | 'Read-only' | 'Needs attention' | 'Unavailable' | 'Checking'
  detail: string
  shortDetail: string
  tone: WorkspaceEvidenceSummaryTone
}

/**
 * The Overview card intentionally compresses the technical evidence state into
 * a small, truthful product-facing vocabulary. The complete disposition stays
 * available in Local evidence.
 */
export function workspaceEvidenceSummary(
  snapshot: DesktopWorkspaceSnapshot,
  evidenceView: WorkspaceEvidenceViewState,
  inspectionError: boolean,
): WorkspaceEvidenceSummary {
  if (inspectionError) {
    return {
      label: 'Unavailable',
      detail: 'The local evidence check could not complete.',
      shortDetail: 'Evidence check incomplete',
      tone: 'blocked',
    }
  }

  if (evidenceView.inspectionPending) {
    return {
      label: 'Checking',
      detail: 'Metrora is checking local evidence.',
      shortDetail: 'Checking local evidence',
      tone: 'neutral',
    }
  }

  if (!evidenceView.inspectionComplete) {
    return {
      label: 'Unavailable',
      detail: 'The local evidence state is not available yet.',
      shortDetail: 'Evidence state unavailable',
      tone: 'blocked',
    }
  }

  if (!snapshot.workspace) {
    return {
      label: 'Unavailable',
      detail: 'Create a personal Workspace to enable local evidence.',
      shortDetail: 'No Workspace yet',
      tone: 'neutral',
    }
  }

  const evidence = snapshot.evidence
  if (evidence.integrity === 'unverified') {
    return {
      label: 'Unavailable',
      detail: 'Local evidence has not been verified yet.',
      shortDetail: 'Not verified yet',
      tone: 'neutral',
    }
  }
  const needsAttention = evidence.integrity === 'invalid'
    || evidence.integrity === 'quarantined'
    || evidence.state === 'blocked'
    || evidence.state === 'quarantined'
    || evidence.blockers.length > 0
    || evidence.invalidEventCount > 0
    || evidence.quarantinedEventCount > 0

  if (needsAttention) {
    return {
      label: 'Needs attention',
      detail: evidence.blockers.length > 0
        ? `${evidence.blockers.length} local condition${evidence.blockers.length === 1 ? '' : 's'} need review.`
        : 'The local evidence state needs review before signing or export.',
      shortDetail: evidence.blockers.length > 0
        ? `${evidence.blockers.length} condition${evidence.blockers.length === 1 ? '' : 's'} need review`
        : 'Review needed before signing',
      tone: 'blocked',
    }
  }

  if (evidence.compatibility === 'historical-read-only' || evidence.compatibility === 'mixed') {
    return {
      label: 'Read-only',
      detail: 'Verified evidence is readable, but signing and export are unavailable for this evidence state.',
      shortDetail: 'Verified evidence · signing/export unavailable',
      tone: 'warning',
    }
  }

  if (evidence.state === 'ready') {
    return {
      label: 'Ready',
      detail: 'Reviewed local evidence is ready for the next explicit action.',
      shortDetail: 'Stored locally on this device',
      tone: 'good',
    }
  }

  if (evidence.integrity === 'verified' || evidence.state === 'acknowledged' || evidence.state === 'empty') {
    return {
      label: 'Verified',
      detail: evidence.state === 'empty'
        ? 'Local evidence is verified; no reviewed activity is waiting.'
        : 'Local evidence has been verified on this device.',
      shortDetail: evidence.state === 'empty'
        ? 'Verified · nothing waiting'
        : 'Verified on this device',
      tone: 'good',
    }
  }

  return {
    label: 'Unavailable',
    detail: 'The current local evidence state is not available for this view.',
    shortDetail: 'State unavailable',
    tone: 'blocked',
  }
}

export function workspacePlatformLabel(value: NonNullable<DesktopWorkspaceSnapshot['workspace']>['endpoint']['os']): string {
  if (value === 'macos') return 'macOS'
  if (value === 'windows') return 'Windows'
  if (value === 'linux') return 'Linux'
  if (value === 'android') return 'Android'
  return 'Other'
}

export function workspaceArchitectureLabel(value: NonNullable<DesktopWorkspaceSnapshot['workspace']>['endpoint']['architecture']): string {
  if (value === 'arm64') return 'ARM64'
  if (value === 'x64') return 'x64'
  if (value === 'arm') return 'ARM'
  return 'Other'
}
