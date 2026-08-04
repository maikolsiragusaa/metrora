import type { WorkspaceGuidance, WorkspaceGuidanceTone } from './workspaceGuidance'

export function WorkspaceGuidancePanel({ guidance }: { guidance: WorkspaceGuidance }) {
  return (
    <section className="workspace-guidance" aria-label="Workspace status and next safe action">
      <GuidanceItem title="Verifiable activity" value={guidance.collection.label} detail={guidance.collection.detail} tone={guidance.collection.tone} testId="workspace-guidance-collection" />
      <GuidanceItem title="Local verification" value={guidance.verification.label} detail={guidance.verification.detail} tone={guidance.verification.tone} testId="workspace-guidance-verification" />
      <GuidanceItem title="Blocking issue" value={guidance.blocker.label} detail={guidance.blocker.detail} tone={guidance.blocker.tone} testId="workspace-guidance-blocker" />
      <GuidanceItem title="Next safe action" value={guidance.nextAction.label} detail={guidance.nextAction.detail} tone={guidance.nextAction.tone} testId="workspace-guidance-next-action" />
    </section>
  )
}

function GuidanceItem({
  title,
  value,
  detail,
  tone,
  testId,
}: {
  title: string
  value: string
  detail: string
  tone: WorkspaceGuidanceTone
  testId: string
}) {
  return (
    <div className={`workspace-guidance-item workspace-guidance-${tone}`}>
      <span>{title}</span>
      <b data-testid={testId}>{value}</b>
      <p>{detail}</p>
    </div>
  )
}
