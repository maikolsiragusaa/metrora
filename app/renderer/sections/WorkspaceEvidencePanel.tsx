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
  'workspace-required': 'Setup needed',
  empty: 'Nothing waiting',
  ready: 'Ready to sign',
  acknowledged: 'Signed and ready',
  quarantined: 'Needs attention',
  blocked: 'Action required',
}

const EVIDENCE_DESCRIPTIONS: Record<WorkspaceEvidenceState, string> = {
  'workspace-required': 'Set up your personal workspace before creating signed usage exports.',
  empty: 'There is no reviewed local activity waiting to be signed.',
  ready: 'Reviewed local activity is ready to be signed on this device.',
  acknowledged: 'Your latest signed usage evidence is ready for an explicit export.',
  quarantined: 'Some local records need attention before they can be signed or exported.',
  blocked: 'Resolve the local issue shown below before signing or exporting.',
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
      ? 'Check unavailable'
      : inspectionPending
        ? 'Checking local data'
        : EVIDENCE_LABELS[evidence.state],
    description: inspectionError
      ? 'Metrora could not finish the local integrity check. Existing files were not changed.'
      : inspectionPending
        ? 'Metrora is checking local workspace data in the background. Nothing is being uploaded.'
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
    <Panel title="Signed exports" right={view.label}>
      <p className="workspace-evidence-copy">{view.description}</p>
      {view.inspectionPending ? (
        <div className="workspace-source-line" role="status" data-testid="workspace-evidence-inspection">
          Checking local workspace data…
        </div>
      ) : null}
      {inspectionError ? (
        <div className="workspace-source-line" role="alert" data-testid="workspace-evidence-inspection-error">
          The check could not complete. Use Check &amp; recover below to retry safely; no files were deleted or reset.
        </div>
      ) : null}
      {view.inspectionComplete && evidence.blockers.length > 0 ? (
        <div className="workspace-visible-blockers" role="alert">
          <b>What needs attention</b>
          <ul className="workspace-blockers">
            {evidence.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      ) : null}
      <details className="workspace-disclosure">
        <summary>Technical details</summary>
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
