import { Panel } from '../components/Panel'

export function WorkspacePrivacyPanel() {
  return (
    <Panel title="Privacy" right="Local by default">
      <ul className="workspace-privacy-list">
        <li><b>No account required.</b> Your personal workspace works locally without a Metrora server.</li>
        <li><b>Your content stays out of exports.</b> Prompts, responses, source code, patches, secrets, tool arguments, and unrestricted paths are excluded.</li>
        <li><b>You choose what leaves the device.</b> Signed usage evidence is exported only when you explicitly request it.</li>
      </ul>
    </Panel>
  )
}
