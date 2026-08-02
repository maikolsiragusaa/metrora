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
  'workspace-required': 'Create the local personal workspace before producing signed evidence.',
  empty: 'No reviewed measurements are waiting in the local outbox.',
  ready: 'Reviewed measurements are available for the next signed batch.',
  acknowledged: 'All currently signed evidence has been acknowledged locally.',
  quarantined: 'Some evidence was isolated and will not enter a signed batch.',
  blocked: 'The runtime found a condition that must be resolved before signing or export.',
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
        ? 'Metrora is verifying local evidence in the background. Counts will appear after the read-only inspection finishes.'
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
    <Panel title="Reviewed evidence" right={view.label}>
      <p className="workspace-evidence-copy">{view.description}</p>
      <div className="workspace-counts" aria-busy={view.inspectionPending}>
        <EvidenceCount label="Pending events" value={view.inspectionComplete ? evidence.pendingEventCount : null} />
        <EvidenceCount label="Unbatched events" value={view.inspectionComplete ? evidence.unbatchedEventCount : null} />
        <EvidenceCount label="Acknowledged events" value={view.inspectionComplete ? evidence.acknowledgedEventCount : null} />
        <EvidenceCount label="Pending batches" value={view.inspectionComplete ? evidence.pendingBatchCount : null} />
        <EvidenceCount label="Acknowledged batches" value={view.inspectionComplete ? evidence.acknowledgedBatchCount : null} />
        <EvidenceCount label="Quarantined" value={view.inspectionComplete ? evidence.quarantinedEventCount : null} />
        <EvidenceCount label="Invalid" value={view.inspectionComplete ? evidence.invalidEventCount : null} />
      </div>
      {view.inspectionPending ? (
        <div className="workspace-source-line" role="status" data-testid="workspace-evidence-inspection">
          Read-only evidence verification in progress…
        </div>
      ) : null}
      {inspectionError ? (
        <div className="workspace-source-line" role="alert" data-testid="workspace-evidence-inspection-error">
          Verification could not complete. Use the bounded recovery action for an explicit retry; no files were deleted or reset.
        </div>
      ) : null}
      {view.inspectionComplete && evidence.blockers.length > 0 ? (
        <ul className="workspace-blockers">
          {evidence.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
        </ul>
      ) : null}
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
