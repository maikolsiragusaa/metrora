import { useCallback, useEffect, useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { formatCompact, formatUsd } from '../lib/format'
import { metrora } from '../lib/ipc'
import { showToast } from '../lib/toast'
import type { MenubarPayload } from '../lib/types'
import type {
  DesktopWorkspaceAvailability,
  DesktopWorkspaceSnapshot,
  WorkspaceBridge,
  WorkspaceEvidenceState,
} from '../lib/workspace'

type ReadyWorkspaceAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>
type WorkspaceAction = 'reload' | 'create' | 'batch' | 'export' | null

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

function withSnapshot(current: DesktopWorkspaceAvailability | null, snapshot: DesktopWorkspaceSnapshot): DesktopWorkspaceAvailability | null {
  if (!current || current.availability !== 'ready') return current
  return { ...current, snapshot }
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
  if (action === 'batch') return 'The next signed batch could not be created.'
  return 'The Workspace evidence package could not be exported.'
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
  const [availability, setAvailability] = useState<DesktopWorkspaceAvailability | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [action, setAction] = useState<WorkspaceAction>('reload')
  const [workspaceName, setWorkspaceName] = useState('My workspace')
  const [endpointName, setEndpointName] = useState('This computer')
  const usage = useMemo(() => workspaceUsageFromOverview(payload), [payload])

  const reload = useCallback(async () => {
    setAction('reload')
    setStatusError(false)
    try {
      if (typeof bridge.getWorkspaceStatus !== 'function') throw new Error('workspace bridge unavailable')
      setAvailability(await bridge.getWorkspaceStatus())
    } catch {
      setStatusError(true)
    } finally {
      setAction(null)
    }
  }, [bridge])

  useEffect(() => {
    void reload()
  }, [reload])

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
      showToast(result.outcome === 'created' ? 'Local workspace created.' : 'Existing local workspace loaded.')
    } catch {
      showToast(actionErrorMessage('create'), 'error')
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
          <button type="button" className="btn btn-s" onClick={() => void reload()} disabled={action !== null}>Retry status</button>
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
          <button type="button" className="btn btn-s" onClick={() => void reload()} disabled={action !== null}>Retry status</button>
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
      onReload={reload}
      onCreate={createWorkspace}
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
  onReload,
  onCreate,
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
  onReload: () => Promise<void>
  onCreate: () => Promise<void>
  onBatch: () => Promise<void>
  onExport: () => Promise<void>
}) {
  const { snapshot } = availability
  const workspace = snapshot.workspace
  const evidence = snapshot.evidence
  const busy = action !== null
  const evidenceBlocked = evidence.state === 'blocked' || evidence.state === 'quarantined'
  const exportBlocked = evidenceBlocked || evidence.unbatchedEventCount > 0

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
          <span className={`workspace-state workspace-state-${evidence.state}`}>{EVIDENCE_LABELS[evidence.state]}</span>
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

          <Panel title="Reviewed evidence" right={EVIDENCE_LABELS[evidence.state]}>
            <p className="workspace-evidence-copy">{EVIDENCE_DESCRIPTIONS[evidence.state]}</p>
            <div className="workspace-counts">
              <EvidenceCount label="Pending events" value={evidence.pendingEventCount} />
              <EvidenceCount label="Unbatched events" value={evidence.unbatchedEventCount} />
              <EvidenceCount label="Acknowledged events" value={evidence.acknowledgedEventCount} />
              <EvidenceCount label="Pending batches" value={evidence.pendingBatchCount} />
              <EvidenceCount label="Acknowledged batches" value={evidence.acknowledgedBatchCount} />
              <EvidenceCount label="Quarantined" value={evidence.quarantinedEventCount} />
              <EvidenceCount label="Invalid" value={evidence.invalidEventCount} />
            </div>
            {evidence.blockers.length > 0 ? (
              <ul className="workspace-blockers">
                {evidence.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : null}
          </Panel>
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

        <Panel title="Actions" right={availability.vault.backend === 'windows-dpapi' ? 'Windows DPAPI' : 'macOS Keychain'}>
          <div className="workspace-actions">
            <button type="button" className="btn btn-s" onClick={() => void onReload()} disabled={busy}>
              {action === 'reload' ? 'Refreshing…' : 'Refresh status'}
            </button>
            <button type="button" className="btn btn-s" onClick={() => void onBatch()} disabled={busy || !workspace || evidenceBlocked}>
              {action === 'batch' ? 'Signing…' : 'Create signed batch'}
            </button>
            <button type="button" className="btn btn-p" onClick={() => void onExport()} disabled={busy || !workspace || exportBlocked}>
              {action === 'export' ? 'Exporting…' : 'Export verifiable evidence'}
            </button>
          </div>
          <p className="workspace-action-note">
            {evidence.unbatchedEventCount > 0
              ? 'Create a signed batch before export. Batching and export are always explicit.'
              : 'Batching and export are always explicit. Opening this screen never scans, signs, uploads, or publishes data automatically.'}
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

function EvidenceCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <b>{formatCompact(value)}</b>
    </div>
  )
}
