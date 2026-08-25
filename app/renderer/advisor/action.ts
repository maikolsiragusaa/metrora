import type { AdvisorActionKindV1, AdvisorActionProposalV1, AdvisorScope } from './types'

/**
 * Action proposals are data only. Advisor V1 has no executor for this
 * contract; execution belongs to a separately authorized product surface.
 */
export type { AdvisorActionKindV1, AdvisorActionProposalV1 } from './types'

export function createAdvisorActionProposalV1(input: {
  kind: AdvisorActionKindV1
  summary: string
  target: string
  scope: AdvisorScope
}): AdvisorActionProposalV1 {
  return {
    contractVersion: 'advisor-action-proposal-v1',
    schemaVersion: 1,
    kind: input.kind,
    status: 'proposal-only',
    summary: input.summary.trim().slice(0, 500),
    target: input.target.trim().slice(0, 200),
    scope: { ...input.scope, range: input.scope.range ? { ...input.scope.range } : null },
    allowedReadTools: ['get_overview_snapshot', 'get_spend_snapshot', 'get_model_efficiency', 'get_quota_snapshot', 'get_project_drivers', 'get_session_highlights', 'get_coverage_report'],
    permissions: ['read-canonical-evidence'],
    budget: { maxCalls: 0, maxCostUSD: null },
    timeoutMs: 0,
    cancellation: 'required',
  }
}
