import type { CSSProperties } from 'react'

import workspaceHero from '../assets/workspace/workspace-hero.png'
import type { DesktopWorkspaceSnapshot } from '../lib/workspace'

export function WorkspaceHero({
  snapshot,
}: {
  snapshot: DesktopWorkspaceSnapshot
}) {
  return (
    <section
      className="workspace-hero"
      aria-label="Personal workspace"
      style={{ '--workspace-hero-image': `url(${workspaceHero})` } as CSSProperties}
    >
      <div className="workspace-hero-copy">
        <div className="workspace-kicker">Personal workspace · Local</div>
        <h2>{snapshot.workspace?.displayName ?? 'Set up your personal workspace'}</h2>
        <p>{snapshot.workspace
          ? 'Your local Metrora workspace keeps projects, device identity, and verified usage evidence under your control. No Metrora account or server is required.'
          : 'A personal Workspace keeps Projects, device identity and verified usage evidence local to this computer. No Metrora account or server is required.'}</p>
      </div>
      <div className="workspace-hero-state">
        {snapshot.localOnly === true ? (
          <span className="workspace-local-badge">
            <svg className="workspace-badge-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1.8" /><path d="M8 20h8M12 17v3" /></svg>
            Local
          </span>
        ) : null}
        {snapshot.privacy.networkRequired === false ? (
          <span className="workspace-private-badge">
            <svg className="workspace-badge-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            Private by default
          </span>
        ) : null}
      </div>
      <div className="workspace-hero-art" aria-hidden="true" />
    </section>
  )
}
