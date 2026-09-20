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
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19c.8-3.4 3-5 6.5-5s5.7 1.6 6.5 5" /></svg>Members &amp; roles</span>
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.8 2h9.2v8.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 7.5v-1a2 2 0 0 1 2-2h3l1.7 2h2.8" /></svg>Multiple workspaces</span>
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3.5 8 12 13l8.5-5z" /><path d="m4.5 11.5 7.5 4.4 7.5-4.4M4.5 15.5 12 20l7.5-4.5" /></svg>Shared projects</span>
      </div>
    </section>
  )
}
