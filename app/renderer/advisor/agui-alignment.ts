import type { AdvisorEvidence, AdvisorTurnPlanV1 } from './types'

/**
 * Design-only alignment with AG-UI-style lifecycle concepts. No AG-UI package
 * or transport is adopted by the desktop app in this convergence wave.
 */
export type AdvisorAgUiEventV1 =
  | { type: 'RUN_STARTED'; runId: string; plan: AdvisorTurnPlanV1 }
  | { type: 'TOOL_CALL_STARTED'; runId: string; toolName: string }
  | { type: 'TOOL_CALL_RESULT'; runId: string; toolName: string; evidence: AdvisorEvidence }
  | { type: 'RUN_FINISHED'; runId: string; status: 'completed' | 'cancelled' | 'failed' }

export const ADVISOR_AGUI_ALIGNMENT_V1 = {
  status: 'design-only',
  adopted: false,
  boundary: 'Metrora-owned TurnPlan, evidence, authorization, and presentation contracts remain authoritative.',
  mappedEvents: ['RUN_STARTED', 'TOOL_CALL_STARTED', 'TOOL_CALL_RESULT', 'RUN_FINISHED'] as const,
} as const
