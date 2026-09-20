import type { DesktopWorkspaceSnapshot } from '../lib/workspace'
import { workspaceArchitectureLabel, workspacePlatformLabel } from './workspaceOverviewPresentation'

export function WorkspaceDevicesSummary({
  workspace,
}: {
  workspace: NonNullable<DesktopWorkspaceSnapshot['workspace']>
}) {
  const endpoint = workspace.endpoint
  const current = endpoint.enrollmentState === 'active'

  return (
    <section className="workspace-surface-card workspace-devices-card" aria-labelledby="workspace-devices-title">
      <div className="workspace-surface-card-head">
        <div className="workspace-card-heading">
          <SurfaceIcon />
          <div>
            <h3 id="workspace-devices-title">Devices</h3>
            <p>Devices enrolled in this workspace.</p>
          </div>
        </div>
      </div>
      <div className="workspace-device-row">
        <span className="workspace-device-token" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="1.7" /><path d="M8 20h8M12 17v3" /></svg>
        </span>
        <span className="workspace-device-copy"><b>{endpoint.displayName}</b><small>{workspacePlatformLabel(endpoint.os)} · {workspaceArchitectureLabel(endpoint.architecture)}</small></span>
        <span className="workspace-current-pill">{current ? 'Current' : endpoint.enrollmentState}</span>
      </div>
      <div className="workspace-device-row workspace-device-preview">
        <span className="workspace-device-token workspace-device-token-muted" aria-hidden="true">+</span>
        <span className="workspace-device-copy"><b>More devices</b></span>
        <span className="workspace-preview-badge">Coming soon</span>
      </div>
    </section>
  )
}

function SurfaceIcon() {
  return (
    <span className="workspace-surface-icon workspace-surface-icon-blue" aria-hidden="true">
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="1.7" /><path d="M8 20h8M12 17v3" /></svg>
    </span>
  )
}
