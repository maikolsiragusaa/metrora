import { Panel } from '../components/Panel'

export function WorkspacePrivacyPanel() {
  return (
    <Panel title="Privacy boundary" right="Explicit by construction">
      <ul className="workspace-privacy-list">
        <li><b>No network required.</b> Workspace v1 works without an account, uploader, or hosted service.</li>
        <li><b>No content export.</b> Prompts, responses, source code, patches, secrets, tool arguments, and unrestricted paths are excluded.</li>
        <li><b>User-owned evidence.</b> Export contains public workspace state and the independently verifiable signed chain.</li>
      </ul>
    </Panel>
  )
}
