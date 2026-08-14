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

function pricingProvenance(record: HistoricalPriceRecordV1) {
  const extended = record.modelIdentity !== undefined
    || record.modelOwner !== undefined
    || record.inferenceProvider !== undefined
    || record.gateway !== undefined
    || record.region !== undefined
    || record.pricingPolicies !== undefined
    || record.pricingMode !== undefined
  if (!extended) return undefined

  return {
    pricingAuthority: record.pricingAuthority,
    pricingModel: record.pricingModel,
    ...(record.modelIdentity === undefined ? {} : { modelIdentity: record.modelIdentity }),
    ...(record.modelOwner === undefined ? {} : { modelOwner: record.modelOwner }),
    ...(record.inferenceProvider === undefined ? {} : { inferenceProvider: record.inferenceProvider }),
    ...(record.gateway === undefined ? {} : { gateway: record.gateway }),
    ...(record.route === undefined ? {} : { route: record.route }),
    ...(record.billingTier === undefined ? {} : { billingTier: record.billingTier }),
    ...(record.region === undefined ? {} : { region: record.region }),
    validFrom: record.validFrom,
    ...(record.validUntil === undefined ? {} : { validUntil: record.validUntil }),
    sourceKind: record.source.kind,
  }
}

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
    const provenance = pricingProvenance(record)
    return {
      costUSD: 0,
      assignment: CostAssignmentV1Schema.parse({
        version: 1,
        kind: 'explicit-zero',
        amountMicrosUsd: 0,
        reason: record.valuation.reason,
        priceRecordId: record.priceRecordId,
        priceOrigin,
        ...(provenance === undefined ? {} : { pricingProvenance: provenance }),
      }),
    }
  }

  const provenance = pricingProvenance(record)
  return {
    costUSD: calculation.costUSD,
    assignment: CostAssignmentV1Schema.parse({
      version: 1,
      kind: 'token-price',
      amountMicrosUsd: costUsdToMicrosV1(calculation.costUSD),
      priceRecordId: record.priceRecordId,
      priceOrigin,
      rateSelection: calculation.rateSelection,
      ...(provenance === undefined ? {} : { pricingProvenance: provenance }),
    }),
  }
}
