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
    <Panel title="Evidence actions" right={availability.vault.backend === 'windows-dpapi' ? 'Windows DPAPI' : 'macOS Keychain'}>
      <div className="workspace-actions">
        <button type="button" className="btn btn-s" onClick={() => void onReload()} disabled={busy}>
          {action === 'reload' ? 'Refreshing…' : 'Refresh status'}
        </button>
        <button type="button" className="btn btn-s" onClick={() => void onRecover()} disabled={busy || evidenceView.inspectionPending}>
          {action === 'recover' ? 'Checking…' : 'Check & recover local state'}
        </button>
        <button type="button" className="btn btn-s" onClick={() => void onBatch()} disabled={busy || !workspace || evidenceView.blocked}>
          {action === 'batch' ? 'Signing…' : 'Create signed batch'}
        </button>
        <button type="button" className="btn btn-p" onClick={() => void onExport()} disabled={busy || !workspace || exportBlocked}>
          {action === 'export' ? 'Exporting…' : 'Export verifiable evidence'}
        </button>
      </div>
      <p className="workspace-action-note">
        Evidence verification is automatic and read-only. Recovery remains explicit and bounded; it never deletes, resets, unblocks, reprices, batches, exports, or uploads evidence automatically.
      </p>
      {lastRecovery ? (
        <div className="workspace-source-line" data-testid="workspace-recovery-summary">
          {workspaceRecoveryLabel(lastRecovery)}
        </div>
      ) : null}
      <p className="workspace-action-note">
        {evidenceView.inspectionPending
          ? 'Wait for local verification before producing, signing, or exporting.'
          : evidence.unbatchedEventCount > 0
            ? 'Create a signed batch before export. Production, batching, and export are always explicit.'
            : 'Production, batching, and export are always explicit. Nothing is uploaded or published automatically.'}
      </p>
    </Panel>
  )
}
