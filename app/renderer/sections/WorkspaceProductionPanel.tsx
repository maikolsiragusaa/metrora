import { Panel } from '../components/Panel'
import type { DesktopReviewedProductionSummary, WorkspaceProductionMode } from '../lib/workspace'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'
import type { WorkspaceAction } from './useWorkspaceStatus'

export function WorkspaceProductionPanel({
  productionPaused,
  evidenceView,
  action,
  busy,
  lastProduction,
  onProduce,
  onSetProductionMode,
}: {
  productionPaused: boolean
  evidenceView: WorkspaceEvidenceViewState
  action: WorkspaceAction
  busy: boolean
  lastProduction: DesktopReviewedProductionSummary | null
  onProduce: () => Promise<void>
  onSetProductionMode: (mode: WorkspaceProductionMode) => Promise<void>
}) {
  return (
    <Panel title="Reviewed production" right={productionPaused ? 'Paused' : 'Active'}>
      <p className="workspace-evidence-copy">
        Scan the canonical local parser/cache and add only source-present, reviewed calls to the private outbox. Opening this screen never performs this action.
      </p>
      <div className="workspace-actions">
        <button
          type="button"
          className="btn btn-p"
          onClick={() => void onProduce()}
          disabled={busy || evidenceView.blocked || productionPaused}
        >
          {action === 'produce' ? 'Producing…' : 'Produce reviewed measurements'}
        </button>
        <button
          type="button"
          className="btn btn-s"
          onClick={() => void onSetProductionMode(productionPaused ? 'active' : 'paused')}
          disabled={busy}
        >
          {productionPaused
            ? (action === 'resume' ? 'Resuming…' : 'Resume production')
            : (action === 'pause' ? 'Pausing…' : 'Pause production')}
        </button>
      </div>
      <p className="workspace-action-note">
        {productionPaused
          ? 'Production is paused before scanning. Overview, collectors, existing evidence, batches, and exports remain unchanged.'
          : 'Only explicit source-recorded provider identity and reviewed provenance are eligible. Unsupported or source-less history is withheld.'}
      </p>
      {lastProduction ? (
        <div className="workspace-source-line" data-testid="workspace-production-summary">
          Last pass: {lastProduction.producedCount} produced · {lastProduction.existingCount} existing · {lastProduction.withheldCount} withheld · {lastProduction.failedCount} failed sources
        </div>
      ) : null}
    </Panel>
  )
}
