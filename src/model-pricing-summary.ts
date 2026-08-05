import type { CostAssignmentV1 } from './pricing/cost-assignment.js'

export type ModelPricingState = 'priced' | 'explicit-zero' | 'partial' | 'unavailable' | 'unknown'

export type ModelPricingCounts = {
  totalCalls: number
  pricedCalls: number
  explicitZeroCalls: number
  unavailableCalls: number
  unknownCalls: number
  missingPriceRecordCalls: number
}

export type ModelPricingSummary = ModelPricingCounts & {
  state: ModelPricingState
  coveredCalls: number
}

export function createModelPricingCounts(): ModelPricingCounts {
  return {
    totalCalls: 0,
    pricedCalls: 0,
    explicitZeroCalls: 0,
    unavailableCalls: 0,
    unknownCalls: 0,
    missingPriceRecordCalls: 0,
  }
}

export function observeModelPricing(
  counts: ModelPricingCounts,
  assignment: CostAssignmentV1 | undefined,
): void {
  counts.totalCalls += 1
  if (!assignment) {
    counts.unknownCalls += 1
    return
  }

  if (assignment.kind === 'explicit-zero') {
    counts.explicitZeroCalls += 1
    return
  }

  if (assignment.kind === 'unavailable') {
    counts.unavailableCalls += 1
    if (assignment.reason === 'no-price-record') counts.missingPriceRecordCalls += 1
    return
  }

  counts.pricedCalls += 1
}

export function summarizeModelPricing(counts: ModelPricingCounts): ModelPricingSummary {
  const coveredCalls = counts.pricedCalls + counts.explicitZeroCalls
  let state: ModelPricingState

  if (counts.totalCalls === 0 || counts.unknownCalls === counts.totalCalls) state = 'unknown'
  else if (counts.explicitZeroCalls === counts.totalCalls) state = 'explicit-zero'
  else if (counts.unavailableCalls === counts.totalCalls) state = 'unavailable'
  else if (coveredCalls > 0 && counts.unavailableCalls + counts.unknownCalls > 0) state = 'partial'
  else if (counts.unavailableCalls > 0 || counts.unknownCalls > 0) state = 'unknown'
  else state = 'priced'

  return { ...counts, state, coveredCalls }
}
