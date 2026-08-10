import { Panel } from '../components/Panel'
import type {
  DesktopWorkspaceAvailability,
  DesktopWorkspaceRecoverySummary,
} from '../lib/workspace'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'
import { workspaceRecoveryLabel } from './workspaceActionCopy'
import type { WorkspaceAction } from './useWorkspaceStatus'

type ReadyAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>

export function WorkspaceEvidenceActionsPanel({
  availability,
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
  evidenceView: WorkspaceEvidenceViewState
  action: WorkspaceAction
  busy: boolean
  lastRecovery: DesktopWorkspaceRecoverySummary | null
  onReload: () => Promise<void>
  onRecover: () => Promise<void>
  onBatch: () => Promise<void>
  onExport: () => Promise<void>
}) {
  const capabilities = availability.snapshot.capabilities
  return (
    <Panel title="Export & recovery" right="This device">
      <div className="workspace-actions">
        <button type="button" className="btn btn-s" onClick={() => void onReload()} disabled={busy}>
          {action === 'reload' ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="btn btn-s" onClick={() => void onRecover()} disabled={busy || !capabilities.recovery.allowed}>
          {action === 'recover' ? 'Checking…' : 'Check & recover'}
        </button>
        <button type="button" className="btn btn-s" onClick={() => void onBatch()} disabled={busy || !capabilities.batchSign.allowed}>
          {action === 'batch' ? 'Signing…' : 'Sign pending usage'}
        </button>
        <button type="button" className="btn btn-p" onClick={() => void onExport()} disabled={busy || !capabilities.canonicalExport.allowed}>
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
          : capabilities.canonicalExport.reason === 'unbatched-evidence'
            ? 'Sign the pending usage before exporting it.'
            : !capabilities.batchSign.allowed || !capabilities.canonicalExport.allowed
              ? 'This verified Workspace state is readable, but the current runtime does not support this action.'
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
