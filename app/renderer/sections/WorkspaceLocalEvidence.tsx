import type { MenubarPayload } from '../lib/types'
import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceAvailability,
  DesktopWorkspaceRecoverySummary,
  WorkspaceProductionMode,
} from '../lib/workspace'
import { WorkspaceCreationPanel } from './WorkspaceCreationPanel'
import { WorkspaceEvidenceActionsPanel } from './WorkspaceEvidenceActionsPanel'
import { WorkspaceEvidencePanel, workspaceEvidenceViewState, type WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'
import { WorkspaceGuidancePanel } from './WorkspaceGuidancePanel'
import { WorkspaceIdentityPanel } from './WorkspaceIdentityPanel'
import { WorkspacePrivacyPanel } from './WorkspacePrivacyPanel'
import { WorkspaceProductionPanel } from './WorkspaceProductionPanel'
import { WorkspaceUsagePanel } from './WorkspaceUsagePanel'
import type { WorkspaceAction } from './useWorkspaceStatus'
import { workspaceGuidance } from './workspaceGuidance'
import type { WorkspaceUsage } from './workspaceUsage'

type ReadyAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>

export function WorkspaceLocalEvidence({
  availability,
  usage,
  scope,
  analyticsLoading,
  workspaceName,
  endpointName,
  setWorkspaceName,
  setEndpointName,
  action,
  inspectionError,
  lastProduction,
  lastRecovery,
  onReload,
  onCreate,
  onProduce,
  onRecover,
  onSetProductionMode,
  onBatch,
  onExport,
  onBack,
}: {
  availability: ReadyAvailability
  usage: WorkspaceUsage | null
  scope: string
  analyticsLoading: boolean
  workspaceName: string
  endpointName: string
  setWorkspaceName: (value: string) => void
  setEndpointName: (value: string) => void
  action: WorkspaceAction
  inspectionError: boolean
  lastProduction: DesktopReviewedProductionSummary | null
  lastRecovery: DesktopWorkspaceRecoverySummary | null
  onReload: () => Promise<void>
  onCreate: () => Promise<void>
  onProduce: () => Promise<void>
  onRecover: () => Promise<void>
  onSetProductionMode: (mode: WorkspaceProductionMode) => Promise<void>
  onBatch: () => Promise<void>
  onExport: () => Promise<void>
  onBack: () => void
}) {
  const { snapshot } = availability
  const workspace = snapshot.workspace
  const evidence = snapshot.evidence
  const lifecycle = workspace
    ? (snapshot.productionLifecycle ?? { mode: 'active' as const, revision: 0, persisted: false, updatedAt: null })
    : null
  const productionPaused = lifecycle?.mode === 'paused'
  const busy = action !== null
  const evidenceView = workspaceEvidenceViewState(evidence, availability.inspection, inspectionError)
  const guidance = workspaceGuidance({ snapshot, evidenceView })

  return (
    <div className="workspace-evidence-view">
      <section className="workspace-subview-heading" aria-labelledby="workspace-evidence-title">
        <div>
          <div className="workspace-kicker">Workspace capability</div>
          <h2 id="workspace-evidence-title">Local evidence</h2>
          <p>Inspect, prepare, sign and explicitly export verified usage evidence from this device.</p>
        </div>
        <div className="workspace-subview-actions">
          <button type="button" className="workspace-subview-back" onClick={onBack}>← Overview</button>
          <span className="workspace-subview-status">Technical details</span>
        </div>
      </section>

      <WorkspaceGuidancePanel guidance={guidance} />

      {!workspace ? (
        <WorkspaceCreationPanel
          identity={snapshot.identity}
          workspaceName={workspaceName}
          endpointName={endpointName}
          action={action}
          busy={busy}
          setWorkspaceName={setWorkspaceName}
          setEndpointName={setEndpointName}
          onCreate={onCreate}
        />
      ) : null}

      <WorkspaceUsagePanel usage={usage} scope={scope} analyticsLoading={analyticsLoading} />

      {workspace ? (
        <WorkspaceProductionPanel
          productionPaused={productionPaused}
          capabilities={snapshot.capabilities}
          action={action}
          busy={busy}
          lastProduction={lastProduction}
          onProduce={onProduce}
          onSetProductionMode={onSetProductionMode}
        />
      ) : null}

      {workspace ? (
        <div className="workspace-grid">
          <WorkspaceIdentityPanel workspace={workspace} />
          <WorkspaceEvidencePanel evidence={evidence} view={evidenceView} inspectionError={inspectionError} />
        </div>
      ) : null}

      <div className="workspace-grid">
        <WorkspacePrivacyPanel />
        <WorkspaceEvidenceActionsPanel
          availability={availability}
          evidenceView={evidenceView}
          action={action}
          busy={busy}
          lastRecovery={lastRecovery}
          onReload={onReload}
          onRecover={onRecover}
          onBatch={onBatch}
          onExport={onExport}
        />
      </div>
    </div>
  )
}
