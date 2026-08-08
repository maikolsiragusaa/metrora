import { Panel } from '../components/Panel'
import type {
  DesktopWorkspaceAvailability,
  DesktopWorkspaceRecoverySummary,
  DesktopWorkspaceSnapshot,
} from '../lib/workspace'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'
import { workspaceRecoveryLabel } from './workspaceActionCopy'
import type { WorkspaceAction } from './useWorkspaceStatus'

type ReadyAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>

export function WorkspaceEvidenceActionsPanel({
  availability,
  workspace,
  evidence,
  evidenceView,
  action,
  busy,
  lastRecovery,
  onReload,
  onRecover,
  onBatch,
  onExport,
}: {
  availability: ReadyAvailability
  workspace: DesktopWorkspaceSnapshot['workspace']
  evidence: DesktopWorkspaceSnapshot['evidence']
  evidenceView: WorkspaceEvidenceViewState
  action: WorkspaceAction
  busy: boolean
  lastRecovery: DesktopWorkspaceRecoverySummary | null
  onReload: () => Promise<void>
  onRecover: () => Promise<void>
  onBatch: () => Promise<void>
  onExport: () => Promise<void>
}) {
  const exportBlocked = evidenceView.blocked || evidence.unbatchedEventCount > 0
  return (
    <Panel title="Export & recovery" right="This device">
      <div className="workspace-actions">
        <button type="button" className="btn btn-s" onClick={() => void onReload()} disabled={busy}>
          {action === 'reload' ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="btn btn-s" onClick={() => void onRecover()} disabled={busy || evidenceView.inspectionPending}>
          {action === 'recover' ? 'Checking…' : 'Check & recover'}
        </button>
        <button type="button" className="btn btn-s" onClick={() => void onBatch()} disabled={busy || !workspace || evidenceView.blocked}>
          {action === 'batch' ? 'Signing…' : 'Sign pending usage'}
        </button>
        <button type="button" className="btn btn-p" onClick={() => void onExport()} disabled={busy || !workspace || exportBlocked}>
          {action === 'export' ? 'Exporting…' : 'Export signed data'}
        </button>
      </div>
      <p className="workspace-action-note">
        Metrora checks workspace integrity automatically. Recovery, signing, and export only happen when you request them.
      </p>
      {lastRecovery ? (
        <div className="workspace-source-line" data-testid="workspace-recovery-summary">
          {workspaceRecoveryLabel(lastRecovery)}
        </div>
      ) : null}
      <p className="workspace-action-note">
        {evidenceView.inspectionPending
          ? 'Wait for the local check to finish before signing or exporting.'
          : evidence.unbatchedEventCount > 0
            ? 'Sign the pending usage before exporting it.'
            : 'Nothing is uploaded or published automatically.'}
      </p>
      <details className="workspace-disclosure">
        <summary>Security details</summary>
        <div className="workspace-disclosure-body workspace-action-note">
          Signing keys are protected by {availability.vault.backend === 'windows-dpapi' ? 'Windows DPAPI' : 'macOS Keychain'}. Integrity checks are read-only; recovery never silently deletes, reprices, signs, exports, or uploads data.
        </div>
      </details>
    </Panel>
  )
}
