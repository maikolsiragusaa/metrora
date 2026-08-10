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
    <section className="workspace-hero" aria-label="Personal workspace">
      <div>
        <div className="workspace-kicker">Personal workspace · This device</div>
        <h2>{workspace?.displayName ?? 'Set up your personal workspace'}</h2>
        <p>{workspace
          ? 'Your local Metrora workspace keeps usage, device identity, and exports under your control. No Metrora account or server is required.'
          : 'Set up a local workspace when you want signed exports and device-level verification. Your normal analytics already work without it.'}</p>
      </div>
      <div className="workspace-hero-state">
        <span className="workspace-local-badge">On this device</span>
        <span className={`workspace-state workspace-state-${evidenceView.stateClass}`}>{evidenceView.label}</span>
      </div>
    </section>
  )
}
