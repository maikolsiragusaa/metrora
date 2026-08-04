import { Panel } from '../components/Panel'
import { formatCompact } from '../lib/format'
import type {
  DesktopWorkspaceAvailability,
  DesktopWorkspaceSnapshot,
  WorkspaceEvidenceState,
} from '../lib/workspace'

type Evidence = DesktopWorkspaceSnapshot['evidence']
type Inspection = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>['inspection']

const EVIDENCE_LABELS: Record<WorkspaceEvidenceState, string> = {
  'workspace-required': 'Workspace required',
  empty: 'No reviewed evidence yet',
  ready: 'Ready to sign',
  acknowledged: 'Evidence acknowledged',
  quarantined: 'Evidence quarantined',
  blocked: 'Action required',
}

const EVIDENCE_DESCRIPTIONS: Record<WorkspaceEvidenceState, string> = {
  'workspace-required': 'Create the local Workspace before preparing verifiable activity.',
  empty: 'No reviewed local activity is currently waiting for signing.',
  ready: 'Reviewed local activity is waiting to be signed.',
  acknowledged: 'The current signed local evidence is available for explicit export.',
  quarantined: 'Some local evidence was isolated and cannot be signed or exported.',
  blocked: 'A local condition must be resolved before signing or export.',
}

export type WorkspaceEvidenceViewState = {
  inspectionPending: boolean
  inspectionComplete: boolean
  label: string
  description: string
  blocked: boolean
  stateClass: WorkspaceEvidenceState
}

export function workspaceEvidenceViewState(
  evidence: Evidence,
  inspection: Inspection,
  inspectionError: boolean,
): WorkspaceEvidenceViewState {
  const inspectionPending = inspection === 'pending' && !inspectionError
  const inspectionComplete = inspection === 'complete'
  return {
    inspectionPending,
    inspectionComplete,
    label: inspectionError
      ? 'Verification unavailable'
      : inspectionPending
        ? 'Checking local data'
        : EVIDENCE_LABELS[evidence.state],
    description: inspectionError
      ? 'The read-only evidence inspection could not complete. Existing files were not changed.'
      : inspectionPending
        ? 'Metrora is verifying local evidence in the background. Details will appear after the read-only check finishes.'
        : EVIDENCE_DESCRIPTIONS[evidence.state],
    blocked: !inspectionComplete || evidence.state === 'blocked' || evidence.state === 'quarantined',
    stateClass: inspectionComplete ? evidence.state : 'blocked',
  }
}

export function WorkspaceEvidencePanel({
  evidence,
  view,
  inspectionError,
}: {
  evidence: Evidence
  view: WorkspaceEvidenceViewState
  inspectionError: boolean
}) {
  return (
    <Panel title="Local verification" right={view.label}>
      <p className="workspace-evidence-copy">{view.description}</p>
      {view.inspectionPending ? (
        <div className="workspace-source-line" role="status" data-testid="workspace-evidence-inspection">
          Read-only evidence verification in progress…
        </div>
      ) : null}
      {inspectionError ? (
        <div className="workspace-source-line" role="alert" data-testid="workspace-evidence-inspection-error">
          Verification could not complete. Use the explicit recovery action for a bounded retry; no files were deleted or reset.
        </div>
      ) : null}
      {view.inspectionComplete && evidence.blockers.length > 0 ? (
        <div className="workspace-visible-blockers" role="alert">
          <b>Blocking conditions</b>
          <ul className="workspace-blockers">
            {evidence.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      ) : null}
      <details className="workspace-disclosure">
        <summary>Audit counts</summary>
        <div className="workspace-counts workspace-disclosure-body" aria-busy={view.inspectionPending}>
          <EvidenceCount label="Pending events" value={view.inspectionComplete ? evidence.pendingEventCount : null} />
          <EvidenceCount label="Unbatched events" value={view.inspectionComplete ? evidence.unbatchedEventCount : null} />
          <EvidenceCount label="Acknowledged events" value={view.inspectionComplete ? evidence.acknowledgedEventCount : null} />
          <EvidenceCount label="Pending batches" value={view.inspectionComplete ? evidence.pendingBatchCount : null} />
          <EvidenceCount label="Acknowledged batches" value={view.inspectionComplete ? evidence.acknowledgedBatchCount : null} />
          <EvidenceCount label="Quarantined" value={view.inspectionComplete ? evidence.quarantinedEventCount : null} />
          <EvidenceCount label="Invalid" value={view.inspectionComplete ? evidence.invalidEventCount : null} />
        </div>
      </details>
    </Panel>
  )
}

function EvidenceCount({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value === null ? '—' : formatCompact(value)}</b>
    </div>
  )
}
