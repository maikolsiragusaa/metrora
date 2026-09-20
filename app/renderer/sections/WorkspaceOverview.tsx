import type { DesktopWorkspaceAvailability, DesktopWorkspaceSnapshot } from '../lib/workspace'
import { WorkspaceCreationPanel } from './WorkspaceCreationPanel'
import { WorkspaceDevicesSummary } from './WorkspaceDevicesSummary'
import { WorkspaceHero } from './WorkspaceHero'
import { WorkspaceOrganizationPreview } from './WorkspaceOrganizationPreview'
import {
  workspaceArchitectureLabel,
  workspaceEvidenceSummary,
  workspacePlatformLabel,
  type WorkspaceEvidenceSummary,
} from './workspaceOverviewPresentation'
import { WorkspaceProjectsSummary } from './WorkspaceProjectsSummary'
import type { WorkspaceProjectsState } from './useWorkspaceProjects'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'

type ReadyAvailability = Extract<DesktopWorkspaceAvailability, { availability: 'ready' }>

export function WorkspaceOverview({
  availability,
  projects,
  evidenceView,
  inspectionError,
  workspaceName,
  endpointName,
  action,
  busy,
  setWorkspaceName,
  setEndpointName,
  onCreate,
  onOpenEvidence,
  onViewAllProjects,
}: {
  availability: ReadyAvailability
  projects: WorkspaceProjectsState
  evidenceView: WorkspaceEvidenceViewState
  inspectionError: boolean
  workspaceName: string
  endpointName: string
  action: 'reload' | 'create' | 'produce' | 'recover' | 'pause' | 'resume' | 'batch' | 'export' | null
  busy: boolean
  setWorkspaceName: (value: string) => void
  setEndpointName: (value: string) => void
  onCreate: () => Promise<void>
  onOpenEvidence: () => void
  onViewAllProjects?: () => void
}) {
  const { snapshot } = availability
  const workspace = snapshot.workspace
  const evidenceSummary = workspaceEvidenceSummary(snapshot, evidenceView, inspectionError)

  return (
    <div className="workspace-overview">
      <WorkspaceHero snapshot={snapshot} />
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
      ) : (
        <>
          <WorkspaceSummaryCards snapshot={snapshot} projects={projects} evidenceSummary={evidenceSummary} onOpenEvidence={onOpenEvidence} onViewAllProjects={onViewAllProjects} />
          {evidenceSummary.tone === 'blocked' ? (
            <section className="workspace-attention workspace-attention-blocked" role="status">
              <div><b>Local evidence needs attention</b><span>{evidenceSummary.detail}</span></div>
              <button type="button" className="workspace-card-cta" onClick={onOpenEvidence}>Open local evidence <span aria-hidden="true">→</span></button>
            </section>
          ) : null}
          {evidenceSummary.tone === 'warning' ? (
            <section className="workspace-attention workspace-attention-warning" role="status">
              <div><b>Local evidence is read-only</b><span>{evidenceSummary.detail}</span></div>
              <button type="button" className="workspace-card-cta" onClick={onOpenEvidence}>Open local evidence <span aria-hidden="true">→</span></button>
            </section>
          ) : null}
          <div className="workspace-overview-grid">
            <WorkspaceProjectsSummary projects={projects} onViewAll={onViewAllProjects} />
            <WorkspaceDetailsSummary workspace={workspace} />
            <WorkspaceDevicesSummary workspace={workspace} />
            <WorkspacePrivacySummary snapshot={snapshot} onOpenEvidence={onOpenEvidence} />
          </div>
          <WorkspaceOrganizationPreview />
        </>
      )}
    </div>
  )
}

function WorkspaceSummaryCards({
  snapshot,
  projects,
  evidenceSummary,
  onOpenEvidence,
  onViewAllProjects,
}: {
  snapshot: DesktopWorkspaceSnapshot
  projects: WorkspaceProjectsState
  evidenceSummary: WorkspaceEvidenceSummary
  onOpenEvidence: () => void
  onViewAllProjects?: () => void
}) {
  const endpoint = snapshot.workspace?.endpoint
  const enrolled = endpoint?.enrollmentState === 'active'
  const projectCount = projects.status === 'ready' ? String(projects.projects.length) : '—'
  const projectDetail = projects.status === 'error'
    ? 'Catalog unavailable'
    : projects.status === 'ready'
      ? 'Projects in your personal context'
      : 'Loading Project catalog'
  const deviceDetail = enrolled && endpoint
    ? `1 device · ${endpoint.displayName}`
    : 'No enrolled device'

  return (
    <section className="workspace-summary-cards" aria-label="Workspace summary">
      <SummaryCard kind="projects" label="Projects" value={projectCount} detail={projectDetail} onClick={onViewAllProjects} />
      <SummaryCard kind="devices" label="Devices" value={enrolled ? '1' : '0'} detail={deviceDetail} />
      <SummaryCard
        kind="evidence"
        label="Local evidence"
        value={evidenceSummary.label}
        detail={evidenceSummary.shortDetail}
        tone={evidenceSummary.tone}
        onClick={onOpenEvidence}
      />
    </section>
  )
}

function SummaryCard({
  kind,
  label,
  value,
  detail,
  tone = 'neutral',
  onClick,
}: {
  kind: 'projects' | 'devices' | 'evidence'
  label: string
  value: string
  detail: string
  tone?: WorkspaceEvidenceSummary['tone']
  onClick?: () => void
}) {
  const content = (
    <>
      <span className={`workspace-summary-icon workspace-summary-icon-${kind}`} aria-hidden="true"><SummaryIcon kind={kind} /></span>
      <span className="workspace-summary-copy"><b>{label}</b><strong data-testid={`workspace-summary-${kind}-value`} className={`workspace-summary-value workspace-summary-value-${tone}`}>{value}</strong><small>{detail}</small></span>
      {onClick ? <span className="workspace-summary-arrow" aria-hidden="true">→</span> : null}
    </>
  )

  return onClick ? (
    <button type="button" className="workspace-summary-card workspace-summary-card-action" onClick={onClick}>{content}</button>
  ) : (
    <div className="workspace-summary-card">{content}</div>
  )
}

function SummaryIcon({ kind }: { kind: 'projects' | 'devices' | 'evidence' }) {
  if (kind === 'projects') return <svg viewBox="0 0 24 24"><path d="M3.5 7.5h6l1.8 2h9.2v8.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 7.5v-1a2 2 0 0 1 2-2h3l1.7 2h2.8" /></svg>
  if (kind === 'devices') return <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="1.7" /><path d="M8 20h8M12 17v3" /></svg>
  return <svg viewBox="0 0 24 24"><path d="M12 3l8 3v5.5c0 4.4-2.4 7.6-8 9.5-5.6-1.9-8-5.1-8-9.5V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>
}

function WorkspaceDetailsSummary({ workspace }: { workspace: NonNullable<DesktopWorkspaceSnapshot['workspace']> }) {
  return (
    <section className="workspace-surface-card" aria-labelledby="workspace-details-title">
      <div className="workspace-surface-card-head">
        <div className="workspace-card-heading">
          <span className="workspace-surface-icon workspace-surface-icon-violet" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1H10v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.6.9Z" /></svg></span>
          <div><h3 id="workspace-details-title">This workspace</h3><p>Key details about your workspace.</p></div>
        </div>
      </div>
      <dl className="workspace-details workspace-details-overview">
        <div><dt>Context</dt><dd>Personal</dd></div>
        <div><dt>Owner</dt><dd>{workspace.ownerRole === 'owner' ? 'You' : workspace.ownerRole}</dd></div>
        <div><dt>Status</dt><dd><span className="workspace-inline-status"><i aria-hidden="true" />{workspace.status === 'active' ? 'Local' : workspace.status}</span></dd></div>
        <div><dt>Device</dt><dd>{workspace.endpoint.displayName} · {workspacePlatformLabel(workspace.endpoint.os)} · {workspaceArchitectureLabel(workspace.endpoint.architecture)}</dd></div>
      </dl>
    </section>
  )
}

function WorkspacePrivacySummary({ snapshot, onOpenEvidence }: { snapshot: DesktopWorkspaceSnapshot; onOpenEvidence: () => void }) {
  const contentExcluded = snapshot.privacy.promptsIncluded === false
    && snapshot.privacy.responsesIncluded === false
    && snapshot.privacy.sourceCodeIncluded === false
    && snapshot.privacy.secretsIncluded === false

  return (
    <section className="workspace-surface-card workspace-privacy-summary" aria-labelledby="workspace-privacy-title">
      <div className="workspace-surface-card-head">
        <div className="workspace-card-heading">
          <span className="workspace-surface-icon workspace-surface-icon-violet" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l8 3v5.5c0 4.4-2.4 7.6-8 9.5-5.6-1.9-8-5.1-8-9.5V6z" /><path d="M8.5 12h7" /></svg></span>
          <div><h3 id="workspace-privacy-title">Local evidence &amp; privacy</h3><p>Verified usage evidence stays local on this device unless you explicitly export it.</p></div>
        </div>
        <button type="button" className="workspace-card-cta" onClick={onOpenEvidence}>Open local evidence <span aria-hidden="true">→</span></button>
      </div>
      {contentExcluded ? <p className="workspace-privacy-summary-copy">Prompts, responses, source code, and secrets are excluded from evidence exports.</p> : null}
    </section>
  )
}
