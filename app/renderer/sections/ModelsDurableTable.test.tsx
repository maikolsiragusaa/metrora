// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DurableModelAccountingRow, DurableModelPresentationRow, ModelAccounting, ModelPresentation } from '../lib/types'
import { DurableModelsTable } from './ModelsDurableTable'

function delivery(): DurableModelAccountingRow {
  return {
    name: 'Mixed evidence model',
    cost: 1,
    savingsUSD: 0,
    calls: 2,
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokenDetail: true,
    reasoningSemantics: 'mixed',
    provider: 'mixed-route',
    sourceProviders: ['codex', 'zed'],
  }
}

function presentationRow(row: DurableModelAccountingRow): DurableModelPresentationRow {
  return {
    ...row,
    presentationIdentity: 'mixed-evidence-model',
    providers: ['mixed-route'],
    sourceProviders: ['codex', 'zed'],
    rawModels: [row.name],
    canonicalIdentities: ['mixed-evidence-model'],
    economicVariants: ['default'],
    reasoningSemantics: 'mixed',
    timingCoverage: 'unavailable',
    deliveryRows: [row],
    deliveryStatus: 'exact',
  }
}

describe('durable Models table reasoning presentation', () => {
  it('shows the observed mixed subtotal and includes it in Total', () => {
    const row = delivery()
    const accounting: ModelAccounting = {
      rows: [row],
      gap: { cost: 0, savingsUSD: 0, calls: 0 },
      coverage: { cost: 1, calls: 1 },
      tokenCoverage: { cost: 1, calls: 1 },
    }
    const presentation: ModelPresentation = {
      rows: [presentationRow(row)],
      accountingRowCount: 1,
    }

    render(
      <DurableModelsTable
        accounting={accounting}
        presentation={presentation}
        legacyPresentationRow={(legacy, index) => ({
          ...legacy,
          presentationIdentity: `legacy-${index}`,
          providers: [],
          sourceProviders: [],
          rawModels: [legacy.name],
          canonicalIdentities: [],
          economicVariants: ['default'],
          reasoningSemantics: 'unavailable',
          timingCoverage: 'unavailable',
          deliveryRows: [legacy],
          deliveryStatus: 'unavailable',
        })}
      />,
    )

    expect(screen.getByText('≥50')).toBeInTheDocument()
    expect(screen.getByText('350')).toBeInTheDocument()
    expect(screen.getByTitle(/At least the shown reasoning tokens/)).toBeInTheDocument()
  })
})
