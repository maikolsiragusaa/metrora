import { useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { formatCompact, formatUsd } from '../lib/format'
import { metrora } from '../lib/ipc'
import { showToast } from '../lib/toast'
import type { MenubarPayload } from '../lib/types'
import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceAvailability,
  DesktopWorkspaceRecoverySummary,
  DesktopWorkspaceSnapshot,
  WorkspaceBridge,
  WorkspaceProductionMode,
} from '../lib/workspace'
import {
  WorkspaceEvidencePanel,
  workspaceEvidenceViewState,
} from './WorkspaceEvidencePanel'
import { useWorkspaceStatus, type WorkspaceAction } from './useWorkspaceStatus'

type ReadyWorkspaceAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>

export type WorkspaceUsage = {
  label: string
  cost: number
  calls: number
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  pricingCoverage: number | null
}

/**
 * Workspace analytics are a projection of the exact current Overview fields.
 * This helper deliberately performs no aggregation, repricing, relabeling, or
 * event/batch reconstruction: the ordinary desktop payload remains authoritative.
 */
export function workspaceUsageFromOverview(payload: MenubarPayload | null): WorkspaceUsage | null {
  if (!payload) return null
  const { current } = payload
  return {
    label: current.label,
    cost: current.cost,
    calls: current.calls,
    sessions: current.sessions,
    inputTokens: current.inputTokens,
    outputTokens: current.outputTokens,
    cacheReadTokens: current.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens,
    pricingCoverage: current.pricingCoverage ?? null,
  }
}

function withSnapshot(current: DesktopWorkspaceAvailability | null, snapshot: DesktopWorkspaceSnapshot): DesktopWorkspaceAvailability | null {
  if (!current || current.availability !== 'ready') return current
  return { ...current, inspection: 'complete', snapshot }
}

function shortFingerprint(value: string): string {
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function platformLabel(value: string): string {
  if (value === 'macos') return 'macOS'
  if (value === 'windows') return 'Windows'
  if (value === 'linux') return 'Linux'
  if (value === 'android') return 'Android'
  return 'Other'
}

function actionErrorMessage(action: Exclude<WorkspaceAction, null>): string {
  if (action === 'reload') return 'Workspace status could not be refreshed.'
  if (action === 'create') return 'The local workspace could not be created.'
  if (action === 'produce') return 'Reviewed measurements could not be produced.'
  if (action === 'recover') return 'Local Workspace state could not be checked safely.'
  if (action === 'pause') return 'Reviewed production could not be paused.'
  if (action === 'resume') return 'Reviewed production could not be resumed.'
  if (action === 'batch') return 'The next signed batch could not be created.'
  return 'The Workspace evidence package could not be exported.'
}

function productionToast(summary: DesktopReviewedProductionSummary): string {
  if (summary.outcome === 'paused') return 'Reviewed production is paused.'
  return `${summary.producedCount} produced · ${summary.existingCount} already present · ${summary.withheldCount} withheld · ${summary.failedCount} failed sources.`
}

function recoveryLabel(summary: DesktopWorkspaceRecoverySummary): string {
  if (summary.outcome === 'workspace-required') return 'Recovery: Workspace required · retry skipped'
  if (summary.outcome === 'paused') return 'Recovery: Paused · retry skipped'
  if (summary.outcome === 'blocked') return `Recovery: Blocked · ${summary.blocker ?? 'blocked-evidence'}`
  if (summary.outcome === 'healthy') return 'Recovery: Healthy · no reconciliation needed'
  return 'Recovery: Reconciled · existing evidence preserved'
}

function showRecoveryToast(summary: DesktopWorkspaceRecoverySummary): void {
  if (summary.outcome === 'reconciled') {
    showToast('Local Workspace state was reconciled through existing private receipts.', undefined)
    return
  }
  if (summary.outcome === 'blocked') {
    showToast('Local evidence remains blocked. Nothing was deleted or reset.', 'error')
    return
  }
  if (summary.outcome === 'paused') {
    showToast('Reviewed production is paused. Recovery stopped before scanning.')
    return
  }
  if (summary.outcome === 'workspace-required') {
    showToast('Create the local Workspace before recovery can run.', 'error')
    return
  }
  showToast('Local Workspace state is healthy. No reconciliation was needed.')
}

export function WorkspaceContent({
  payload,
  scope,
  analyticsLoading = false,
}: {
  payload: MenubarPayload | null
  scope: string
  analyticsLoading?: boolean
}) {
  const bridge = metrora as Partial<WorkspaceBridge>
  const {
    availability,
    setAvailability,
    statusError,
    inspectionError,
    action,
    setAction,
    loadBootstrap,
    reload,
  } = useWorkspaceStatus(bridge)
  const [workspaceName, setWorkspaceName] = useState('My workspace')
  const [endpointName, setEndpointName] = useState('This computer')
  const [lastProduction, setLastProduction] = useState<DesktopReviewedProductionSummary | null>(null)
  const [lastRecovery, setLastRecovery] = useState<DesktopWorkspaceRecoverySummary | null>(null)
  const usage = useMemo(() => workspaceUsageFromOverview(payload), [payload])

  const createWorkspace = async () => {
    const displayName = workspaceName.trim()
    const endpointDisplayName = endpointName.trim()
    if (!displayName || !endpointDisplayName) {
      showToast('Workspace and endpoint names are required.', 'error')
      return
    }

    setAction('create')
    try {
      if (typeof bridge.createWorkspace !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.createWorkspace({ displayName, endpointDisplayName })
      setAvailability(current => withSnapshot(current, result.snapshot))
      setLastProduction(null)
      setLastRecovery(null)
      showToast(result.outcome === 'created' ? 'Local workspace created.' : 'Existing local workspace loaded.')
    } catch {
      showToast(actionErrorMessage('create'), 'error')
    } finally {
      setAction(null)
    }
  }

  const produceMeasurements = async () => {
    setAction('produce')
    try {
      if (typeof bridge.produceWorkspaceMeasurements !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.produceWorkspaceMeasurements()
      setAvailability(current => withSnapshot(current, result.snapshot))
      setLastProduction(result.summary)
      setLastRecovery(null)
      showToast(productionToast(result.summary))
    } catch {
      showToast(actionErrorMessage('produce'), 'error')
    } finally {
      setAction(null)
    }
  }

  const recoverLocalState = async () => {
    setAction('recover')
    try {
      if (typeof bridge.recoverWorkspaceState !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.recoverWorkspaceState()
      setAvailability(current => withSnapshot(current, result.snapshot))
      setLastRecovery(result.summary)
      if (result.summary.production) setLastProduction(result.summary.production)
      showRecoveryToast(result.summary)
    } catch {
      showToast(actionErrorMessage('recover'), 'error')
    } finally {
      setAction(null)
    }
  }

  const setProductionMode = async (mode: WorkspaceProductionMode) => {
    const nextAction: WorkspaceAction = mode === 'paused' ? 'pause' : 'resume'
    setAction(nextAction)
    try {
      const method = mode === 'paused' ? bridge.pauseWorkspaceProduction : bridge.resumeWorkspaceProduction
      if (typeof method !== 'function') throw new Error('workspace bridge unavailable')
      const result = await method.call(bridge)
      setAvailability(current => withSnapshot(current, result.snapshot))
      setLastRecovery(null)
      showToast(mode === 'paused' ? 'Reviewed production paused.' : 'Reviewed production resumed.')
    } catch {
      showToast(actionErrorMessage(nextAction), 'error')
    } finally {
      setAction(null)
    }
  }

  const createBatch = async () => {
    setAction('batch')
    try {
      if (typeof bridge.createWorkspaceBatch !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.createWorkspaceBatch()
      setAvailability(current => withSnapshot(current, result.snapshot))
      showToast(result.outcome === 'created'
        ? `Signed ${result.batch?.eventCount ?? 0} reviewed measurements.`
        : 'No reviewed measurements are waiting to be signed.')
    } catch {
      showToast(actionErrorMessage('batch'), 'error')
    } finally {
      setAction(null)
    }
  }

  const exportEvidence = async () => {
    setAction('export')
    try {
      if (typeof bridge.exportWorkspaceEvidence !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.exportWorkspaceEvidence()
      if (result.outcome === 'cancelled') return
      setAvailability(current => withSnapshot(current, result.snapshot))
      showToast(`Exported ${result.fileName}.`)
    } catch {
      showToast(actionErrorMessage('export'), 'error')
    } finally {
      setAction(null)
    }
  }

  if (statusError) {
    return (
      <Panel title="Workspace unavailable">
        <div className="workspace-empty">
          <EmptyNote>The secure Workspace runtime did not return a public status. Ordinary local analytics remain available.</EmptyNote>
          <button type="button" className="btn btn-s" onClick={() => void loadBootstrap()} disabled={action !== null}>Retry status</button>
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
          <button type="button" className="btn btn-s" onClick={() => void loadBootstrap()} disabled={action !== null}>Retry status</button>
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
  const exportBlocked = evidenceView.blocked || evidence.unbatchedEventCount > 0

  return (
    <>
      <section className="workspace-hero" aria-label="Workspace identity">
        <div>
          <div className="workspace-kicker">Local personal workspace</div>
          <h2>{workspace?.displayName ?? 'Create your Workspace'}</h2>
          <p>{workspace
            ? 'A user-owned evidence boundary on this computer. No account or server is required.'
            : 'Turn reviewed local usage into signed, independently verifiable evidence without uploading private content.'}</p>
        </div>
        <div className="workspace-hero-state">
          <span className="workspace-local-badge">Local only</span>
          <span className={`workspace-state workspace-state-${evidenceView.stateClass}`}>{evidenceView.label}</span>
        </div>
      </section>

      {!workspace ? (
        <Panel title="Create the local Workspace" right="No account required">
          <div className="workspace-create-grid">
            <label className="workspace-field">
              <span>Workspace name</span>
              <input value={workspaceName} maxLength={80} onChange={event => setWorkspaceName(event.target.value)} />
            </label>
            <label className="workspace-field">
              <span>Endpoint name</span>
              <input value={endpointName} maxLength={80} onChange={event => setEndpointName(event.target.value)} />
            </label>
            <div className="workspace-create-copy">
              <b>Existing protected identity</b>
              <code>{shortFingerprint(snapshot.identity.publicKeyFingerprintSha256)}</code>
              <span>Generation {snapshot.identity.generation}. The runtime reuses this identity instead of creating a competing key.</span>
            </div>
            <button type="button" className="btn btn-p workspace-primary-action" onClick={() => void onCreate()} disabled={busy}>
              {action === 'create' ? 'Creating…' : 'Create local Workspace'}
            </button>
          </div>
        </Panel>
      ) : null}

      <Panel title="Canonical usage" right={scope}>
        {usage ? (
          <>
            <div className="workspace-usage-note">
              These values are read directly from the current Overview payload. Workspace evidence and signed batches never recalculate them.
            </div>
            <div className="workspace-stats" aria-label="Canonical Overview usage">
              <UsageStat label="Cost" value={formatUsd(usage.cost)} testId="workspace-cost" />
              <UsageStat label="Calls" value={formatCompact(usage.calls)} testId="workspace-calls" />
              <UsageStat label="Sessions" value={formatCompact(usage.sessions)} testId="workspace-sessions" />
              <UsageStat label="Input tokens" value={formatCompact(usage.inputTokens)} testId="workspace-input-tokens" />
              <UsageStat label="Output tokens" value={formatCompact(usage.outputTokens)} testId="workspace-output-tokens" />
              <UsageStat label="Cache read" value={formatCompact(usage.cacheReadTokens)} testId="workspace-cache-read" />
              <UsageStat label="Cache write" value={formatCompact(usage.cacheWriteTokens)} testId="workspace-cache-write" />
              <UsageStat
                label="Pricing coverage"
                value={usage.pricingCoverage == null ? 'Not available' : `${Math.round(usage.pricingCoverage * 1000) / 10}%`}
                testId="workspace-pricing-coverage"
              />
            </div>
            <div className="workspace-source-line">Overview period: {usage.label}{analyticsLoading ? ' · refreshing' : ''}</div>
          </>
        ) : (
          <EmptyNote>Canonical Overview analytics are still loading. Workspace identity and evidence actions remain separate.</EmptyNote>
        )}
      </Panel>

      {workspace ? (
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
      ) : null}

      {workspace ? (
        <div className="workspace-grid">
          <Panel title="Workspace and endpoint" right={workspace.ownerRole === 'owner' ? 'Owner' : workspace.ownerRole}>
            <dl className="workspace-details">
              <div><dt>Workspace</dt><dd>{workspace.displayName}</dd></div>
              <div><dt>Workspace ID</dt><dd><code>{workspace.workspaceId}</code></dd></div>
              <div><dt>Endpoint</dt><dd>{workspace.endpoint.displayName}</dd></div>
              <div><dt>Platform</dt><dd>{platformLabel(workspace.endpoint.os)} · {workspace.endpoint.architecture}</dd></div>
              <div><dt>Identity</dt><dd><code>{shortFingerprint(workspace.endpoint.publicKeyFingerprintSha256)}</code></dd></div>
              <div><dt>Software</dt><dd>Metrora {workspace.endpoint.metroraVersion} · collector {workspace.endpoint.collectorVersion}</dd></div>
            </dl>
          </Panel>
          <WorkspaceEvidencePanel evidence={evidence} view={evidenceView} inspectionError={inspectionError} />
        </div>
      ) : null}

      <div className="workspace-grid">
        <Panel title="Privacy boundary" right="Explicit by construction">
          <ul className="workspace-privacy-list">
            <li><b>No network required.</b> Workspace v1 works without an account, uploader, or hosted service.</li>
            <li><b>No content export.</b> Prompts, responses, source code, patches, secrets, tool arguments, and unrestricted paths are excluded.</li>
            <li><b>User-owned evidence.</b> Export contains public workspace state and the independently verifiable signed chain.</li>
          </ul>
        </Panel>

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
              {recoveryLabel(lastRecovery)}
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
      </div>
    </>
  )
}

function UsageStat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="workspace-stat">
      <span>{label}</span>
      <b data-testid={testId}>{value}</b>
    </div>
  )
}
