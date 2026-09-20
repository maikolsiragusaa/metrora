export function WorkspaceOrganizationPreview() {
  return (
    <section className="workspace-organization-preview" aria-labelledby="workspace-organization-title">
      <div className="workspace-organization-heading">
        <span className="workspace-surface-icon workspace-surface-icon-violet" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3.5 19c.7-3.2 2.5-4.7 5.5-4.7s4.8 1.5 5.5 4.7M14.5 15.5c2.8-.7 5 .4 6 3.5" /></svg>
        </span>
        <div>
          <div className="workspace-organization-title-row"><h3 id="workspace-organization-title">Organization workspaces</h3><span className="workspace-preview-badge">Coming soon</span></div>
          <p>Future organization workspaces will support members, multiple workspaces, and shared projects.</p>
        </div>
      </div>
      <div className="workspace-organization-features" aria-label="Organization preview features">
        <span>Members &amp; roles</span>
        <span>Multiple workspaces</span>
        <span>Shared projects</span>
      </div>
    </section>
  )
}
