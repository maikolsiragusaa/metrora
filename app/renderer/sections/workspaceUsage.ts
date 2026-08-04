import type { MenubarPayload } from '../lib/types'

export type WorkspaceUsage = {
  label: string
  cost: number
  calls: number
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  pricingCoverage: number | null
}

/**
 * Workspace analytics are a projection of the exact current Overview fields.
 * This helper deliberately performs no aggregation, repricing, relabeling, or
 * event/batch reconstruction: the ordinary desktop payload remains authoritative.
 */
export function workspaceUsageFromOverview(payload: MenubarPayload | null): WorkspaceUsage | null {
  if (!payload) return null
  const { current } = payload
  return {
    label: current.label,
    cost: current.cost,
    calls: current.calls,
    sessions: current.sessions,
    inputTokens: current.inputTokens,
    outputTokens: current.outputTokens,
    cacheReadTokens: current.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens,
    pricingCoverage: current.pricingCoverage ?? null,
  }
}
