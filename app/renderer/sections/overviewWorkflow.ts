import type { MenubarPayload } from '../lib/types'

const WORKFLOW_CORRECTION_RATE = 0.15
const WORKFLOW_CORRECTION_COUNT = 3
const WORKFLOW_CHURN_SESSIONS = 3
const WORKFLOW_TTFE_SLOW_MS = 5 * 60 * 1000

type WorkflowRollup = NonNullable<MenubarPayload['current']['workflow']>
type ReworkedFile = { path: string; sessions: number; edits: number }

export function formatWorkflowDuration(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 1000)}s`
}

export function workflowCoachingNote(workflow: WorkflowRollup, topReworked?: ReworkedFile): string | null {
  const { correctionRate, corrections, medianTimeToFirstEditMs } = workflow
  if (correctionRate !== null && correctionRate >= WORKFLOW_CORRECTION_RATE && corrections >= WORKFLOW_CORRECTION_COUNT) {
    return `You corrected the assistant on ${Math.round(correctionRate * 100)}% of prompts (${corrections} times). State the requirements in the first message to cut the back and forth.`
  }
  if (topReworked && topReworked.sessions >= WORKFLOW_CHURN_SESSIONS) {
    return `${topReworked.path} was reworked across ${topReworked.sessions} sessions (${topReworked.edits} edits). A focused pass on it may cost less than the repeated churn.`
  }
  if (medianTimeToFirstEditMs !== null && medianTimeToFirstEditMs >= WORKFLOW_TTFE_SLOW_MS) {
    return `Median time to first edit is ${formatWorkflowDuration(medianTimeToFirstEditMs)}. Point the assistant at the target file to cut the exploration before it starts editing.`
  }
  return null
}
