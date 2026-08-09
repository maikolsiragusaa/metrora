import { useMemo } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import type { MenubarPayload } from '../lib/types'
import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceAvailability,
  DesktopWorkspaceRecoverySummary,
  WorkspaceProductionMode,
} from '../lib/workspace'
import { WorkspaceCreationPanel } from './WorkspaceCreationPanel'
import { WorkspaceEvidenceActionsPanel } from './WorkspaceEvidenceActionsPanel'
import {
  WorkspaceEvidencePanel,
  workspaceEvidenceViewState,
} from './WorkspaceEvidencePanel'
import { WorkspaceGuidancePanel } from './WorkspaceGuidancePanel'
import { WorkspaceHero } from './WorkspaceHero'
import { WorkspaceIdentityPanel } from './WorkspaceIdentityPanel'
import { WorkspacePrivacyPanel } from './WorkspacePrivacyPanel'
import { WorkspaceProductionPanel } from './WorkspaceProductionPanel'
import { WorkspaceUsagePanel } from './WorkspaceUsagePanel'
import { useWorkspaceController } from './useWorkspaceController'
import type { WorkspaceAction } from './useWorkspaceStatus'
import { workspaceGuidance } from './workspaceGuidance'
import { workspaceUsageFromOverview, type WorkspaceUsage } from './workspaceUsage'

export { workspaceUsageFromOverview } from './workspaceUsage'
export type { WorkspaceUsage } from './workspaceUsage'

type ReadyWorkspaceAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>

export function WorkspaceContent({
  payload,
  scope,
  analyticsLoading = false,
}: {
  payload: MenubarPayload | null
  scope: string
  analyticsLoading?: boolean
}) {
  const {
    availability,
    statusError,
    inspectionError,
    action,
    workspaceName,
    endpointName,
    lastProduction,
    lastRecovery,
    setWorkspaceName,
    setEndpointName,
    retryStatus,
    reload,
    createWorkspace,
    produceMeasurements,
    recoverLocalState,
    setProductionMode,
    createBatch,
    exportEvidence,
  } = useWorkspaceController()
  const usage = useMemo(() => workspaceUsageFromOverview(payload), [payload])

  if (statusError) {
    return (
      <Panel title="Workspace unavailable">
        <div className="workspace-empty">
          <EmptyNote>The secure Workspace runtime did not return a public status. Ordinary local analytics remain available.</EmptyNote>
          <button type="button" className="btn btn-s" onClick={() => void retryStatus()} disabled={action !== null}>Retry status</button>
        </div>
      </Panel>
    )
  }

  if (!availability) {
    return (
      <Panel title="Workspace">
        <div className="workspace-loading" role="status">Opening the secure local Workspace runtime…</div>
      </Panel>
    )
  }

  if (availability.availability === 'unsupported-platform') {
    return (
      <Panel title="Workspace unavailable">
        <EmptyNote>Secure Workspace identity storage is not supported on {availability.platform}. Ordinary analytics remain local and unchanged.</EmptyNote>
      </Panel>
    )
  }

  if (availability.availability === 'unavailable') {
    return (
      <Panel title="Workspace unavailable">
        <div className="workspace-empty">
          <EmptyNote>The operating-system vault is unavailable, so Metrora will not open a plaintext fallback.</EmptyNote>
          <button type="button" className="btn btn-s" onClick={() => void retryStatus()} disabled={action !== null}>Retry status</button>
        </div>
      </Panel>
    )
  }

  return (
    <ReadyWorkspaceView
      availability={availability}
      usage={usage}
      scope={scope}
      analyticsLoading={analyticsLoading}
      workspaceName={workspaceName}
      endpointName={endpointName}
      setWorkspaceName={setWorkspaceName}
      setEndpointName={setEndpointName}
      action={action}
      inspectionError={inspectionError}
      lastProduction={lastProduction}
      lastRecovery={lastRecovery}
      onReload={reload}
      onCreate={createWorkspace}
      onProduce={produceMeasurements}
      onRecover={recoverLocalState}
      onSetProductionMode={setProductionMode}
      onBatch={createBatch}
      onExport={exportEvidence}
    />
  )
}

function ReadyWorkspaceView({
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
}: {
  availability: ReadyWorkspaceAvailability
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
    <>
      <WorkspaceHero workspace={workspace} evidenceView={evidenceView} />
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
          evidenceView={evidenceView}
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
          workspace={workspace}
          evidence={evidence}
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
    </>
  )
}
