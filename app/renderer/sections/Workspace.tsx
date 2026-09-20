import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import type { Section } from '../components/Sidebar'
import type { MenubarPayload } from '../lib/types'
import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceAvailability,
  DesktopWorkspaceRecoverySummary,
  WorkspaceProductionMode,
} from '../lib/workspace'
import { workspaceEvidenceViewState } from './WorkspaceEvidencePanel'
import { WorkspaceLocalEvidence } from './WorkspaceLocalEvidence'
import { WorkspaceOverview } from './WorkspaceOverview'
import type { SettingsPane } from './Settings'
import { useWorkspaceProjects } from './useWorkspaceProjects'
import { useWorkspaceController } from './useWorkspaceController'
import type { WorkspaceAction } from './useWorkspaceStatus'
import { workspaceUsageFromOverview, type WorkspaceUsage } from './workspaceUsage'

export { workspaceUsageFromOverview } from './workspaceUsage'
export type { WorkspaceUsage } from './workspaceUsage'

type ReadyWorkspaceAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>
export type WorkspaceView = 'overview' | 'evidence'

function unavailableWorkspaceMessage(
  reason: Extract<DesktopWorkspaceAvailability, { availability: 'unavailable' }>['reason'],
): string {
  if (reason === 'vault-unavailable') {
    return 'The operating-system vault is unavailable, so Metrora will not open a plaintext fallback.'
  }
  if (reason === 'packaged-runtime-unavailable') {
    return 'The packaged secure Workspace runtime is unavailable or invalid, so Metrora will not open a plaintext fallback.'
  }
  if (reason === 'local-state-unavailable') {
    return 'The existing encrypted Workspace state could not be read, so Metrora will not replace it or open a plaintext fallback.'
  }
  return 'The secure Workspace runtime could not be initialized, so Metrora will not open a plaintext fallback.'
}

export function WorkspaceContent({
  payload,
  scope,
  analyticsLoading = false,
  onNavigate,
  refreshToken = 0,
  initialView = 'overview',
}: {
  payload: MenubarPayload | null
  scope: string
  analyticsLoading?: boolean
  onNavigate?: (section: Section, pane?: SettingsPane) => void
  refreshToken?: number
  initialView?: WorkspaceView
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
          <EmptyNote>{unavailableWorkspaceMessage(availability.reason)}</EmptyNote>
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
      onNavigate={onNavigate}
      refreshToken={refreshToken}
      initialView={initialView}
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
  onNavigate,
  refreshToken,
  initialView,
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
  onNavigate?: (section: Section, pane?: SettingsPane) => void
  refreshToken: number
  initialView: WorkspaceView
}) {
  const evidenceView = workspaceEvidenceViewState(availability.snapshot.evidence, availability.inspection, inspectionError)
  const [view, setView] = useState<WorkspaceView>(initialView)
  const busy = action !== null
  const projectsEnabled = view === 'overview' && availability.snapshot.workspace !== null
  const projects = useWorkspaceProjects(projectsEnabled)
  const onRefresh = useCallback(async () => {
    const tasks: Array<Promise<void>> = [onReload()]
    if (projectsEnabled || projects.status !== 'idle') tasks.push(projects.reload())
    await Promise.all(tasks)
  }, [onReload, projects.reload, projects.status, projectsEnabled])
  const lastRefreshToken = useRef(refreshToken)

  useEffect(() => {
    if (lastRefreshToken.current === refreshToken) return
    lastRefreshToken.current = refreshToken
    void onRefresh()
  }, [onRefresh, refreshToken])

  return (
    <>
      {view === 'overview' ? (
        <WorkspaceOverview
          availability={availability}
          projects={projects}
          evidenceView={evidenceView}
          inspectionError={inspectionError}
          workspaceName={workspaceName}
          endpointName={endpointName}
          action={action}
          busy={busy}
          setWorkspaceName={setWorkspaceName}
          setEndpointName={setEndpointName}
          onCreate={onCreate}
          onOpenEvidence={() => setView('evidence')}
          onViewAllProjects={onNavigate ? () => onNavigate('settings', 'projects') : undefined}
        />
      ) : (
        <WorkspaceLocalEvidence
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
          onReload={onRefresh}
          onCreate={onCreate}
          onProduce={onProduce}
          onRecover={onRecover}
          onSetProductionMode={onSetProductionMode}
          onBatch={onBatch}
          onExport={onExport}
          onBack={() => setView('overview')}
        />
      )}
    </>
  )
}
