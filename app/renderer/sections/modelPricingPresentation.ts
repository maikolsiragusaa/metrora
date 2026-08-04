import type { ModelPricingState, ModelPricingSummary, ModelReportRow } from '../lib/types'

export type ModelPricingCostMode = 'total' | 'partial' | 'unavailable'

export type ModelPricingPresentation = {
  state: ModelPricingState
  label: string
  title: string
  costMode: ModelPricingCostMode
  showAlias: boolean
  muteCost: boolean
}

function stateFromCounts(summary: Omit<ModelPricingSummary, 'state'>): ModelPricingState {
  if (summary.totalCalls === 0 || summary.unknownCalls === summary.totalCalls) return 'unknown'
  if (summary.explicitZeroCalls === summary.totalCalls) return 'explicit-zero'
  if (summary.unavailableCalls === summary.totalCalls) return 'unavailable'
  if (summary.coveredCalls > 0 && summary.unavailableCalls + summary.unknownCalls > 0) return 'partial'
  if (summary.unavailableCalls > 0 || summary.unknownCalls > 0) return 'unknown'
  return 'priced'
}

export function combineModelPricing(rows: Array<Pick<ModelReportRow, 'calls' | 'pricing'>>): ModelPricingSummary {
  const combined: Omit<ModelPricingSummary, 'state'> = {
    totalCalls: 0,
    coveredCalls: 0,
    pricedCalls: 0,
    explicitZeroCalls: 0,
    unavailableCalls: 0,
    unknownCalls: 0,
    missingPriceRecordCalls: 0,
  }

  for (const row of rows) {
    const pricing = row.pricing
    if (!pricing) {
      combined.totalCalls += row.calls
      combined.unknownCalls += row.calls
      continue
    }
    combined.totalCalls += pricing.totalCalls
    combined.coveredCalls += pricing.coveredCalls
    combined.pricedCalls += pricing.pricedCalls
    combined.explicitZeroCalls += pricing.explicitZeroCalls
    combined.unavailableCalls += pricing.unavailableCalls
    combined.unknownCalls += pricing.unknownCalls
    combined.missingPriceRecordCalls += pricing.missingPriceRecordCalls
  }

  return { ...combined, state: stateFromCounts(combined) }
}

export function modelPricingPresentation(
  pricing: ModelPricingSummary | undefined,
  fallbackCalls: number,
): ModelPricingPresentation {
  const summary = pricing ?? {
    state: 'unknown' as const,
    totalCalls: fallbackCalls,
    coveredCalls: 0,
    pricedCalls: 0,
    explicitZeroCalls: 0,
    unavailableCalls: 0,
    unknownCalls: fallbackCalls,
    missingPriceRecordCalls: 0,
  }

  const showAlias = summary.missingPriceRecordCalls > 0
  switch (summary.state) {
    case 'priced':
      return {
        state: summary.state,
        label: 'Pricing covered',
        title: `Pricing evidence covers all ${summary.totalCalls.toLocaleString('en-US')} calls.`,
        costMode: 'total',
        showAlias,
        muteCost: false,
      }
    case 'explicit-zero':
      return {
        state: summary.state,
        label: 'Explicitly free',
        title: `All ${summary.totalCalls.toLocaleString('en-US')} calls carry reviewed zero-cost evidence.`,
        costMode: 'total',
        showAlias,
        muteCost: false,
      }
    case 'partial':
      return {
        state: summary.state,
        label: `Partial pricing · ${summary.coveredCalls.toLocaleString('en-US')}/${summary.totalCalls.toLocaleString('en-US')} calls`,
        title: 'The displayed amount is only the priced portion; some calls have unavailable or missing pricing evidence.',
        costMode: 'partial',
        showAlias,
        muteCost: true,
      }
    case 'unavailable':
      return {
        state: summary.state,
        label: 'Price unavailable',
        title: 'Usage is known, but no authoritative cost can be assigned to these calls.',
        costMode: 'unavailable',
        showAlias,
        muteCost: true,
      }
    case 'unknown':
      return {
        state: summary.state,
        label: 'Pricing evidence unavailable',
        title: 'This payload predates or omits call-level pricing evidence; displayed usage remains authoritative.',
        costMode: 'total',
        showAlias,
        muteCost: true,
      }
  }
}
