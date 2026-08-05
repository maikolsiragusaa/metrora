import { Panel } from '../components/Panel'
import type { DesktopWorkspaceSnapshot } from '../lib/workspace'

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

export function WorkspaceIdentityPanel({
  workspace,
}: {
  workspace: NonNullable<DesktopWorkspaceSnapshot['workspace']>
}) {
  return (
    <Panel title="Workspace and computer" right={workspace.ownerRole === 'owner' ? 'Owner' : workspace.ownerRole}>
      <dl className="workspace-details">
        <div><dt>Workspace</dt><dd>{workspace.displayName}</dd></div>
        <div><dt>Computer</dt><dd>{workspace.endpoint.displayName}</dd></div>
        <div><dt>Platform</dt><dd>{platformLabel(workspace.endpoint.os)} · {workspace.endpoint.architecture}</dd></div>
      </dl>
      <details className="workspace-disclosure">
        <summary>Technical identity details</summary>
        <dl className="workspace-details workspace-disclosure-body">
          <div><dt>Workspace ID</dt><dd><code>{workspace.workspaceId}</code></dd></div>
          <div><dt>Endpoint identity</dt><dd><code>{shortFingerprint(workspace.endpoint.publicKeyFingerprintSha256)}</code></dd></div>
          <div><dt>Identity generation</dt><dd>{workspace.endpoint.identityGeneration}</dd></div>
          <div><dt>Software</dt><dd>Metrora {workspace.endpoint.metroraVersion} · collector {workspace.endpoint.collectorVersion}</dd></div>
        </dl>
      </details>
    </Panel>
  )
}
