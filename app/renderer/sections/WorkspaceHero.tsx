import type { DesktopWorkspaceSnapshot } from '../lib/workspace'
import type { WorkspaceEvidenceViewState } from './WorkspaceEvidencePanel'

export function WorkspaceHero({
  workspace,
  evidenceView,
}: {
  workspace: DesktopWorkspaceSnapshot['workspace']
  evidenceView: WorkspaceEvidenceViewState
}) {
  return (
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
  )
}
