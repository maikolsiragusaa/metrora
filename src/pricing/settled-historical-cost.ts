import {
  CostAssignmentV1Schema,
  costUsdToMicrosV1,
  type CostAssignmentOriginV1,
  type CostAssignmentV1,
} from './cost-assignment.js'
import {
  calculateHistoricalCostV1,
  type HistoricalPriceUsageV1,
} from './historical-cost.js'
import type { HistoricalPriceRecordV1 } from './history.js'

export type HistoricalCostSettlementV1 = {
  costUSD?: number
  assignment: CostAssignmentV1
}

export function settleHistoricalCostV1(
  record: HistoricalPriceRecordV1,
  priceOrigin: CostAssignmentOriginV1,
  usage: HistoricalPriceUsageV1,
): HistoricalCostSettlementV1 {
  const calculation = calculateHistoricalCostV1(record, usage)
  if (calculation.kind === 'unavailable') {
    return {
      assignment: CostAssignmentV1Schema.parse({
        version: 1,
        kind: 'unavailable',
        reason: 'missing-required-rate',
      }),
    }
  }

  if (record.valuation.kind === 'explicit-zero') {
    return {
      costUSD: 0,
      assignment: CostAssignmentV1Schema.parse({
        version: 1,
        kind: 'explicit-zero',
        amountMicrosUsd: 0,
        reason: record.valuation.reason,
        priceRecordId: record.priceRecordId,
        priceOrigin,
      }),
    }
  }

  return {
    costUSD: calculation.costUSD,
    assignment: CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'token-price',
      amountMicrosUsd: costUsdToMicrosV1(calculation.costUSD),
      priceRecordId: record.priceRecordId,
      priceOrigin,
      rateSelection: calculation.rateSelection,
    }),
  }
}
