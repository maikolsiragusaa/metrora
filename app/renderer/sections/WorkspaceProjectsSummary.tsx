import { EmptyNote } from '../components/EmptyState'
import type { WorkspaceProjectsState } from './useWorkspaceProjects'

export function WorkspaceProjectsSummary({
  projects,
  onViewAll,
}: {
  projects: WorkspaceProjectsState
  onViewAll?: () => void
}) {
  return (
    <section className="workspace-surface-card workspace-projects-card" aria-labelledby="workspace-projects-title">
      <div className="workspace-surface-card-head">
        <div className="workspace-card-heading">
          <SurfaceIcon kind="projects" />
          <div>
            <h3 id="workspace-projects-title">Projects</h3>
            <p>Metrora Projects available in your personal context.</p>
          </div>
        </div>
        {onViewAll ? (
          <button type="button" className="workspace-card-cta" onClick={onViewAll}>
            View all projects <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
      {projects.status === 'loading' || projects.status === 'idle' ? (
        <div className="workspace-card-state" role="status">Loading Projects…</div>
      ) : projects.status === 'error' ? (
        <EmptyNote>Project catalog is unavailable right now. Workspace evidence remains available.</EmptyNote>
      ) : projects.data?.registry.status === 'corrupt' ? (
        <EmptyNote>The local Project registry is unreadable. Existing Workspace evidence remains available.</EmptyNote>
      ) : projects.projects.length === 0 ? (
        <EmptyNote>No Metrora Projects yet. Create and organize them in Settings · Projects.</EmptyNote>
      ) : (
        <div className="workspace-project-list">
          {projects.projects.slice(0, 5).map(project => (
            <div className="workspace-project-row" key={project.id}>
              <span className={`workspace-project-token color-${project.color}`} aria-hidden="true">{project.icon.slice(0, 1).toUpperCase()}</span>
              <span className="workspace-project-name">{project.name}</span>
              <span className="workspace-project-count">{project.sourceProjectCount} Source Project{project.sourceProjectCount === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      )}
      {projects.status === 'ready' && projects.projects.length > 5 ? (
        <div className="workspace-card-foot">Showing 5 of {projects.projects.length} Projects.</div>
      ) : null}
    </section>
  )
}

function SurfaceIcon({ kind }: { kind: 'projects' }) {
  return (
    <span className="workspace-surface-icon workspace-surface-icon-violet" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M3.5 7.5h6l1.8 2h9.2v8.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
        <path d="M3.5 7.5v-1a2 2 0 0 1 2-2h3l1.7 2h2.8" />
      </svg>
    </span>
  )
}

