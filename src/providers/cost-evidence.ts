import {
  CostAssignmentV1Schema,
  costUsdToMicrosV1,
  type CostAssignmentV1,
} from '../pricing/cost-assignment.js'

/**
 * Bind a non-estimated source-reported amount to the collector that recorded
 * it. The caller is responsible for proving that the source field is an exact
 * amount before calling this helper.
 */
export function sourceMeteredCostAssignment(
  amountUSD: number,
  source: 'provider' | 'client' | 'billing-export',
): CostAssignmentV1 {
  return CostAssignmentV1Schema.parse({
    version: 1,
    kind: 'metered',
    amountMicrosUsd: costUsdToMicrosV1(amountUSD),
    source,
  })
}
