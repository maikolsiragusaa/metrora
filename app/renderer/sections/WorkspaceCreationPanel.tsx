import { Panel } from '../components/Panel'
import type { DesktopWorkspaceSnapshot } from '../lib/workspace'
import type { WorkspaceAction } from './useWorkspaceStatus'

function shortFingerprint(value: string): string {
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

export function WorkspaceCreationPanel({
  identity,
  workspaceName,
  endpointName,
  action,
  busy,
  setWorkspaceName,
  setEndpointName,
  onCreate,
}: {
  identity: DesktopWorkspaceSnapshot['identity']
  workspaceName: string
  endpointName: string
  action: WorkspaceAction
  busy: boolean
  setWorkspaceName: (value: string) => void
  setEndpointName: (value: string) => void
  onCreate: () => Promise<void>
}) {
  return (
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
          <code>{shortFingerprint(identity.publicKeyFingerprintSha256)}</code>
          <span>Generation {identity.generation}. The runtime reuses this identity instead of creating a competing key.</span>
        </div>
        <button type="button" className="btn btn-p workspace-primary-action" onClick={() => void onCreate()} disabled={busy}>
          {action === 'create' ? 'Creating…' : 'Create local Workspace'}
        </button>
      </div>
    </Panel>
  )
}
