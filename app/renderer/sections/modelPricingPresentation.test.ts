import { describe, expect, it } from 'vitest'

import type { ModelPricingSummary, ModelReportRow } from '../lib/types'
import { combineModelPricing, modelPricingPresentation } from './modelPricingPresentation'

function summary(state: ModelPricingSummary['state'], overrides: Partial<ModelPricingSummary> = {}): ModelPricingSummary {
  return {
    state,
    totalCalls: 2,
    coveredCalls: 2,
    pricedCalls: 2,
    explicitZeroCalls: 0,
    unavailableCalls: 0,
    unknownCalls: 0,
    missingPriceRecordCalls: 0,
    ...overrides,
  }
}

describe('model pricing presentation', () => {
  it('keeps explicit zero distinct from unavailable pricing', () => {
    expect(modelPricingPresentation(summary('explicit-zero', {
      pricedCalls: 0,
      explicitZeroCalls: 2,
    }), 2)).toMatchObject({
      label: 'Explicitly free',
      costMode: 'total',
      muteCost: false,
    })

    expect(modelPricingPresentation(summary('unavailable', {
      coveredCalls: 0,
      pricedCalls: 0,
      unavailableCalls: 2,
      missingPriceRecordCalls: 2,
    }), 2)).toMatchObject({
      label: 'Price unavailable',
      costMode: 'unavailable',
      showAlias: true,
    })
  })

  it('labels partial coverage without converting the priced portion into a total', () => {
    expect(modelPricingPresentation(summary('partial', {
      coveredCalls: 1,
      pricedCalls: 1,
      unavailableCalls: 1,
    }), 2)).toMatchObject({
      label: 'Partial pricing · 1/2 calls',
      costMode: 'partial',
      muteCost: true,
    })
  })

  it('treats rows from older payloads as unknown rather than free or unpriced', () => {
    expect(modelPricingPresentation(undefined, 3)).toMatchObject({
      state: 'unknown',
      label: 'Pricing evidence unavailable',
      costMode: 'total',
      showAlias: false,
    })
  })

  it('combines by-task rows without losing missing evidence', () => {
    const rows = [
      { calls: 1, pricing: summary('priced', { totalCalls: 1, coveredCalls: 1, pricedCalls: 1 }) },
      {
        calls: 1,
        pricing: summary('unavailable', {
          totalCalls: 1,
          coveredCalls: 0,
          pricedCalls: 0,
          unavailableCalls: 1,
          missingPriceRecordCalls: 1,
        }),
      },
    ] as Array<Pick<ModelReportRow, 'calls' | 'pricing'>>

    expect(combineModelPricing(rows)).toMatchObject({
      state: 'partial',
      totalCalls: 2,
      coveredCalls: 1,
      unavailableCalls: 1,
      missingPriceRecordCalls: 1,
    })
  })
})
