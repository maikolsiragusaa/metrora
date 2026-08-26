// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DurableModelAccountingRow, DurableModelPresentationRow, ModelAccounting, ModelPresentation } from '../lib/types'
import { DurableModelsTable } from './ModelsDurableTable'

function delivery(overrides: Partial<DurableModelAccountingRow> = {}): DurableModelAccountingRow {
  return {
    name: 'Mixed evidence model',
    cost: 1,
    savingsUSD: 0,
    calls: 2,
    inputTokens: 0,
    outputTokens: 200,
    reasoningTokens: 50,
    additiveReasoningTokens: 30,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokenDetail: true,
    reasoningSemantics: 'mixed',
    provider: 'mixed-route',
    sourceProviders: ['codex', 'zed'],
    ...overrides,
  }
}

function presentationRow(row: DurableModelAccountingRow, overrides: Partial<DurableModelPresentationRow> = {}): DurableModelPresentationRow {
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
    ...overrides,
  }
}

function accounting(rows: DurableModelAccountingRow[], overrides: Partial<ModelAccounting> = {}): ModelAccounting {
  return {
    rows,
    gap: { cost: 0, savingsUSD: 0, calls: 0 },
    coverage: { cost: 1, calls: 1 },
    tokenCoverage: { cost: 1, calls: 1 },
    ...overrides,
  }
}

function renderTable(
  rows: DurableModelAccountingRow[],
  presentationRows: DurableModelPresentationRow[] = [presentationRow(rows[0]!)],
  accountingOverrides: Partial<ModelAccounting> = {},
  unpricedModels: Array<{ model: string; calls: number; tokens: number }> = [],
) {
  const modelAccounting = accounting(rows, accountingOverrides)
  const presentation: ModelPresentation = { rows: presentationRows, accountingRowCount: rows.length }
  return render(
    <DurableModelsTable
      accounting={modelAccounting}
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
      unpricedModels={unpricedModels}
    />,
  )
}

async function openDetails() {
  const details = screen.getByTestId('models-details')
  fireEvent.click(within(details).getByText('Details'))
  await waitFor(() => expect(details).toHaveAttribute('open'))
  return { details, evidence: within(details).getByRole('table', { name: 'Model usage details' }) }
}

describe('durable Models table progressive disclosure', () => {
  it('keeps advanced token facts closed until Details opens', async () => {
    const row = delivery()
    renderTable([row])

    const primary = screen.getByRole('table', { name: 'Model usage' })
    expect(within(primary).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Model', 'Calls', 'Cost', 'Saved'])
    const details = screen.getByTestId('models-details')
    expect(details.firstElementChild?.tagName).toBe('SUMMARY')
    expect(screen.queryByText('50')).not.toBeInTheDocument()

    const opened = await openDetails()
    expect(within(opened.evidence).getByText('50')).toBeInTheDocument()
    expect(within(opened.evidence).getByText('230')).toBeInTheDocument()
    expect(within(opened.evidence).getByRole('columnheader', { name: 'Cache ×' })).toBeInTheDocument()
    expect(within(opened.evidence).getByRole('columnheader', { name: 'Cost / 1M' })).toBeInTheDocument()
    expect(within(opened.evidence).getByRole('columnheader', { name: 'Pricing' })).toBeInTheDocument()
  })

  it('keeps known zero token facts distinct from unavailable legacy facts', async () => {
    const knownZero = delivery({
      name: 'Known zero model',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      additiveReasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningSemantics: 'separate',
    })
    const legacy = delivery({
      name: 'Legacy token model',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: undefined,
      additiveReasoningTokens: undefined,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokenDetail: false,
      reasoningSemantics: 'unavailable',
    })
    const knownPresentation = presentationRow(knownZero, { presentationIdentity: 'known-zero', name: 'Known zero model', rawModels: ['Known zero model'], reasoningSemantics: 'separate', deliveryRows: [knownZero] })
    const legacyPresentation = presentationRow(legacy, { presentationIdentity: 'legacy-token', name: 'Legacy token model', rawModels: ['Legacy token model'], reasoningSemantics: 'unavailable', deliveryRows: [legacy], deliveryStatus: 'unavailable' })
    renderTable([knownZero, legacy], [knownPresentation, legacyPresentation])

    const { evidence } = await openDetails()
    const zeroRow = within(evidence).getByRole('row', { name: /Known zero model/ })
    const legacyRow = within(evidence).getByRole('row', { name: /Legacy token model/ })
    const zeroCells = within(zeroRow).getAllByRole('cell')
    const legacyCells = within(legacyRow).getAllByRole('cell')
    expect(zeroCells[2]).toHaveTextContent('0')
    expect(zeroCells[3]).toHaveTextContent('0')
    expect(zeroCells[4]).toHaveTextContent('0')
    expect(zeroCells[8]).toHaveTextContent('0')
    expect(zeroCells[7]).toHaveTextContent('—')
    expect(zeroCells[7].querySelector('.models-unavailable')).toHaveAttribute('aria-label', expect.stringContaining('Cache reuse is unavailable'))
    expect(legacyCells[2].querySelector('.models-unavailable')).toHaveAttribute('aria-label', expect.stringContaining('Reasoning token evidence is unavailable'))
    expect(legacyCells[3].querySelector('.models-unavailable')).toHaveAttribute('aria-label', expect.stringContaining('Input token evidence is unavailable'))
    expect(legacyCells[8].querySelector('.models-unavailable')).toHaveAttribute('aria-label', expect.stringContaining('Total token evidence is unavailable'))
  })

  it('qualifies partial pricing without changing the reported cost', async () => {
    const settled = delivery({ name: 'Partial model', cost: 2, reasoningSemantics: 'separate', reasoningTokens: 0, additiveReasoningTokens: 0 })
    const estimated = delivery({ name: 'Partial model', cost: 3, costIsEstimated: true, estimatedCostUSD: 1, reasoningSemantics: 'separate', reasoningTokens: 0, additiveReasoningTokens: 0 })
    const row = presentationRow(settled, {
      presentationIdentity: 'partial-model',
      name: 'Partial model',
      cost: 5,
      calls: 4,
      rawModels: ['Partial model'],
      deliveryRows: [settled, estimated],
      deliveryStatus: 'exact',
      pricingState: 'mixed',
      reasoningSemantics: 'separate',
    })
    renderTable([settled, estimated], [row])

    const primary = screen.getByRole('table', { name: 'Model usage' })
    const primaryRow = within(primary).getByRole('row', { name: /Partial model/ })
    expect(within(primaryRow).getAllByRole('cell')[2]).toHaveTextContent('$5.00')
    expect(within(primaryRow).getAllByRole('cell')[2]).toHaveTextContent('partial')

    const { evidence } = await openDetails()
    const evidenceRow = within(evidence).getByRole('row', { name: /Partial model/ })
    expect(within(evidenceRow).getAllByRole('cell')[15]).toHaveTextContent('Partial pricing')
  })

  it('does not attribute aggregate unpriced evidence to every delivery', async () => {
    const first = delivery({ name: 'Ambiguous model', calls: 1, cost: 1, provider: 'route-a', sourceProviders: ['codex'] })
    const second = delivery({ name: 'Ambiguous model', calls: 1, cost: 2, provider: 'route-b', sourceProviders: ['zed'] })
    const row = presentationRow(first, {
      presentationIdentity: 'ambiguous-model',
      name: 'Ambiguous model',
      cost: 3,
      calls: 2,
      providers: ['route-a', 'route-b'],
      sourceProviders: ['codex', 'zed'],
      rawModels: ['Ambiguous model'],
      deliveryRows: [first, second],
      deliveryStatus: 'exact',
      pricingState: 'settled',
    })
    renderTable(
      [first, second],
      [row],
      {},
      [{ model: 'Ambiguous model', calls: 1, tokens: 200 }],
    )

    const primary = screen.getByRole('table', { name: 'Model usage' })
    expect(within(primary).getByRole('row', { name: /Ambiguous model/ })).toHaveTextContent('partial')

    const { evidence } = await openDetails()
    const button = within(evidence).getByRole('button', { name: '2 deliveries' })
    fireEvent.click(button)
    const region = document.getElementById(button.getAttribute('aria-controls')!)!
    const deliveryTable = within(region).getByRole('table', { name: 'Ambiguous model delivery evidence' })
    const deliveryRows = within(deliveryTable).getAllByRole('row').slice(1)
    expect(deliveryRows).toHaveLength(2)
    expect(deliveryRows[0]).toHaveTextContent('Unresolved')
    expect(deliveryRows[1]).toHaveTextContent('Unresolved')
    expect(deliveryRows[0]).not.toHaveTextContent('Unpriced')
    expect(deliveryRows[1]).not.toHaveTextContent('Unpriced')
  })

  it('keeps delivery expansion linked to its region', async () => {
    const first = delivery({ name: 'Routed model', provider: 'route-a', sourceProviders: ['codex'] })
    const second = delivery({ name: 'Routed model', provider: 'route-b', sourceProviders: ['zed'] })
    const row = presentationRow(first, {
      presentationIdentity: 'routed-model',
      name: 'Routed model',
      providers: ['route-a', 'route-b'],
      sourceProviders: ['codex', 'zed'],
      deliveryRows: [first, second],
      deliveryStatus: 'exact',
    })
    renderTable([first, second], [row])

    const { evidence } = await openDetails()
    const button = within(evidence).getByRole('button', { name: '2 deliveries' })
    const regionId = button.getAttribute('aria-controls')
    expect(regionId).toBeTruthy()
    fireEvent.click(button)
    const region = document.getElementById(regionId!)
    expect(region).toHaveAttribute('role', 'region')
    expect(region).toHaveAttribute('aria-label', 'Routed model delivery breakdown')
    expect(within(region as HTMLElement).getByRole('table', { name: 'Routed model delivery evidence' })).toBeInTheDocument()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(regionId!)).not.toBeInTheDocument()
  })
})
