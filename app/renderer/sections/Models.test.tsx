// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditRow, DateRange, DurableModelAccountingRow, ModelPricingSummary, ModelReportRow } from '../lib/types'
import { Models } from './Models'

const { getModels, getAudit } = vi.hoisted(() => ({
  getModels: vi.fn<(period: string, provider: string, byTask: boolean, range?: DateRange) => Promise<ModelReportRow[]>>(),
  getAudit: vi.fn<(period: string, provider: string, range?: DateRange) => Promise<AuditRow[]>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, metrora: { ...actual.metrora, getModels, getAudit } }
})

function pricing(totalCalls: number): ModelPricingSummary {
  return {
    state: 'priced',
    totalCalls,
    coveredCalls: totalCalls,
    pricedCalls: totalCalls,
    explicitZeroCalls: 0,
    unavailableCalls: 0,
    unknownCalls: 0,
    missingPriceRecordCalls: 0,
  }
}

const taskRows: ModelReportRow[] = [
  {
    provider: 'anthropic',
    providerDisplayName: 'Anthropic',
    model: 'claude-opus-4-8',
    modelDisplayName: 'Claude Opus 4.8',
    category: 'coding',
    inputTokens: 100_000_000,
    outputTokens: 6_100_000,
    cacheWriteTokens: 16_000_000,
    cacheReadTokens: 88_000_000,
    totalTokens: 210_100_000,
    calls: 3400,
    costUSD: 244.12,
    savingsUSD: 0,
    savingsBaselineModel: '',
    pricing: pricing(3400),
    credits: null,
  },
  {
    provider: 'anthropic',
    providerDisplayName: 'Anthropic',
    model: 'claude-opus-4-8',
    modelDisplayName: 'Claude Opus 4.8',
    category: 'delegation',
    inputTokens: 8_000_000,
    outputTokens: 500_000,
    cacheWriteTokens: 0,
    cacheReadTokens: 6_000_000,
    totalTokens: 14_500_000,
    calls: 120,
    costUSD: 20.88,
    savingsUSD: 0,
    savingsBaselineModel: '',
    pricing: pricing(120),
    credits: null,
  },
]

const mixedTaskRow: ModelReportRow = {
  ...taskRows[0]!,
  inputTokens: 0,
  outputTokens: 200,
  reasoningTokens: 50,
  additiveReasoningTokens: 30,
  reasoningSemantics: 'mixed',
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 230,
  costUSD: 2.3,
}

const auditRows: AuditRow[] = [{
  provider: 'anthropic',
  providerDisplayName: 'Anthropic',
  model: 'claude-opus-4-8',
  modelDisplayName: 'Claude Opus 4.8',
  calls: 1200,
  raw: { inputTokens: 50_000_000, outputTokens: 3_100_000, reasoningTokens: 900_000, cacheCreationInputTokens: 8_000_000, cacheReadInputTokens: 40_000_000, cachedInputTokens: 0, webSearchRequests: 0 },
  displayed: { inputTokens: 50_000_000, outputTokens: 4_000_000, cacheWriteTokens: 8_000_000, cacheReadTokens: 40_000_000 },
  rates: { inputCostPerToken: 0.000003, outputCostPerToken: 0.000015, cacheWriteCostPerToken: 0.00000375, cacheReadCostPerToken: 0.0000003, webSearchCostPerRequest: 0.01, fastMultiplier: 1 },
  cost: { input: 150, output: 60, cacheWrite: 30, cacheRead: 12, webSearch: 0, recomputedTotalUSD: 252 },
  attributedCostUSD: 252,
}]

function durableRow(name: string, cost: number, calls: number, savingsUSD: number | undefined, overrides: Partial<DurableModelAccountingRow> = {}): DurableModelAccountingRow {
  return {
    name,
    cost,
    savingsUSD: savingsUSD as number,
    calls,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokenDetail: true,
    ...overrides,
  }
}

function loadedOverview(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      current: {
        cost: 30,
        calls: 30,
        topModels: [],
        modelAccounting: {
          rows: [
            {
              name: 'GPT-5.4',
              cost: 20,
              savingsUSD: 0,
              calls: 20,
              inputTokens: 500_000,
              outputTokens: 100_000,
              cacheReadTokens: 4_500_000,
              cacheWriteTokens: 0,
              tokenDetail: true,
              activeDurationMs: 2500,
              activeGeneratedTokens: 10_000,
            },
            {
              name: 'Claude Opus 4.8',
              cost: 10,
              savingsUSD: 0,
              calls: 10,
              inputTokens: 100_000,
              outputTokens: 50_000,
              cacheReadTokens: 150_000,
              cacheWriteTokens: 0,
              tokenDetail: true,
              activeDurationMs: 3000,
              activeGeneratedTokens: 10_000,
            },
          ],
          gap: { cost: 0, savingsUSD: 0, calls: 0 },
          coverage: { cost: 1, calls: 1 },
          tokenCoverage: { cost: 1, calls: 1 },
        },
        ...overrides,
      },
    },
    error: null,
    loading: false,
    switching: false,
    lastSuccessAt: Date.now(),
    refresh: vi.fn(),
    refreshFresh: vi.fn(),
  } as any
}

async function openDetails() {
  const details = screen.getByTestId('models-details')
  fireEvent.click(within(details).getByText('Details'))
  await waitFor(() => expect(details).toHaveAttribute('open'))
  return { details, evidence: within(details).getByRole('table', { name: 'Model usage details' }) }
}

describe('Models', () => {
  beforeEach(() => {
    getModels.mockReset()
    getAudit.mockReset()
  })

  it('renders only Model, Calls, Cost, and Saved by default', () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)

    const primary = screen.getByRole('table', { name: 'Model usage' })
    expect(within(primary).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Model', 'Calls', 'Cost', 'Saved'])
    expect(screen.getByText('GPT-5.4')).toBeInTheDocument()
    expect(screen.getByText('Claude Opus 4.8')).toBeInTheDocument()
    expect(screen.getByTestId('models-details')).not.toHaveAttribute('open')
    expect(screen.queryByRole('columnheader', { name: 'Reasoning' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Cache ×' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Total tokens' })).not.toBeInTheDocument()
    expect(screen.queryByText(/durable accounting values/i)).not.toBeInTheDocument()
    expect(getModels).not.toHaveBeenCalled()
  })

  it('opens and closes the native Details disclosure while preserving advanced evidence', async () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)

    const details = screen.getByTestId('models-details')
    const summary = within(details).getByText('Details')
    expect(summary.tagName).toBe('SUMMARY')
    summary.focus()
    expect(document.activeElement).toBe(summary)

    const opened = await openDetails()
    expect(opened.details.firstElementChild?.tagName).toBe('SUMMARY')
    expect(within(opened.evidence).getByRole('columnheader', { name: 'Reasoning' })).toBeInTheDocument()
    expect(within(opened.evidence).getByRole('columnheader', { name: 'Cost / 1M' })).toBeInTheDocument()
    expect(within(opened.details).getByText('5.1M')).toBeInTheDocument()
    expect(within(opened.evidence).getByRole('columnheader', { name: 'Generated tok/s' })).toBeInTheDocument()
    expect(within(opened.evidence).getByRole('columnheader', { name: 'Timing' })).toBeInTheDocument()
    expect(within(opened.evidence).getAllByText('observed')).toHaveLength(2)
    expect(within(opened.evidence).getByText('250.0ms')).toBeInTheDocument()

    fireEvent.click(summary)
    await waitFor(() => expect(opened.details).not.toHaveAttribute('open'))
    expect(screen.queryByRole('table', { name: 'Model usage details' })).not.toBeInTheDocument()
  })

  it('shows unavailable token-derived and timing metrics instead of fake zeros for legacy durable rows', async () => {
    const overview = loadedOverview({
      modelAccounting: {
        rows: [durableRow('Legacy model', 12, 9, 0, { tokenDetail: false })],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 0, calls: 0 },
      },
    })

    const { container } = render(<Models period="lifetime" provider="all" overview={overview} />)
    expect(screen.getByText('Legacy model')).toBeInTheDocument()
    const { details, evidence } = await openDetails()
    expect(within(details).getByText(/Rows without a durable token split show/i)).toBeInTheDocument()
    const row = within(evidence).getByRole('row', { name: /Legacy model/ })
    expect(row.querySelectorAll('.models-unavailable').length).toBeGreaterThanOrEqual(9)
    expect(container.querySelector('.provider-mono')).toBeInTheDocument()
  })

  it('sorts the durable evidence table by total observed tokens on demand', async () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)
    const { details, evidence } = await openDetails()

    fireEvent.click(within(details).getByRole('tab', { name: 'Total tokens' }))
    const modelRows = within(evidence).getAllByRole('row').slice(1)
    expect(modelRows[0]).toHaveTextContent('GPT-5.4')
  })

  it('sorts observed ms per 1K fastest-first and leaves untimed rows at the bottom', async () => {
    const overview = loadedOverview({
      modelAccounting: {
        rows: [
          durableRow('Untimed model', 9, 9, 0, { inputTokens: 1, outputTokens: 1 }),
          durableRow('Slower model', 8, 8, 0, { inputTokens: 1, outputTokens: 1, activeDurationMs: 4000, activeGeneratedTokens: 10_000 }),
          durableRow('Faster model', 7, 7, 0, { inputTokens: 1, outputTokens: 1, activeDurationMs: 2000, activeGeneratedTokens: 10_000 }),
        ],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })
    render(<Models period="lifetime" provider="all" overview={overview} />)
    const { details, evidence } = await openDetails()

    fireEvent.click(within(details).getByRole('tab', { name: 'Active ms / 1K' }))
    const bodyRows = within(evidence).getAllByRole('row').slice(1)
    expect(bodyRows[0]).toHaveTextContent('Faster model')
    expect(bodyRows[1]).toHaveTextContent('Slower model')
    expect(bodyRows[2]).toHaveTextContent('Untimed model')
  })

  it('keeps positive, explicit-zero, and unavailable Saved values distinct', () => {
    const overview = loadedOverview({
      modelAccounting: {
        rows: [
          durableRow('Saved model', 3, 3, 1.25),
          durableRow('Free model', 0, 2, 0),
          durableRow('Missing saved model', 2, 1, undefined),
        ],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })
    render(<Models period="lifetime" provider="all" overview={overview} />)
    const primary = screen.getByRole('table', { name: 'Model usage' })
    const savedRow = within(primary).getByRole('row', { name: /Saved model/ })
    const freeRow = within(primary).getByRole('row', { name: /Free model/ })
    const missingRow = within(primary).getByRole('row', { name: /Missing saved model/ })

    expect(within(savedRow).getAllByRole('cell')[3]).toHaveTextContent('$1.25')
    expect(within(freeRow).getAllByRole('cell')[3]).toHaveTextContent('$0.00')
    expect(within(within(missingRow).getAllByRole('cell')[3]).getByLabelText(/Saved is unavailable/)).toBeInTheDocument()
    expect(within(missingRow).getAllByRole('cell')[3]).toHaveTextContent('—')
  })

  it('qualifies estimated and unpriced Cost while keeping known zero Cost numeric', () => {
    const overview = loadedOverview({
      unpricedModels: [
        { model: 'Unpriced model', calls: 2, tokens: 0 },
        { model: 'Partially unpriced model', calls: 1, tokens: 0 },
      ],
      modelAccounting: {
        rows: [
          durableRow('Explicit free model', 0, 2, 0),
          durableRow('Estimated model', 4, 2, 0, { costIsEstimated: true, estimatedCostUSD: 1 }),
          durableRow('Unpriced model', 0, 2, 0),
          durableRow('Partially unpriced model', 5, 1, 0),
        ],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })
    render(<Models period="lifetime" provider="all" overview={overview} />)

    const primary = screen.getByRole('table', { name: 'Model usage' })
    const freeRow = within(primary).getByRole('row', { name: /Explicit free model/ })
    const estimatedRow = within(primary).getByRole('row', { name: /Estimated model/ })
    const unpricedRow = within(primary).getByRole('row', { name: /Unpriced model/ })
    const partialUnpricedRow = within(primary).getByRole('row', { name: /Partially unpriced model/ })
    expect(within(freeRow).getAllByRole('cell')[2]).toHaveTextContent('$0.00')
    expect(within(freeRow).getAllByRole('cell')[2]).not.toHaveTextContent(/unpriced|est\.|partial/i)
    expect(within(estimatedRow).getAllByRole('cell')[2]).toHaveTextContent('$4.00')
    expect(within(estimatedRow).getAllByRole('cell')[2]).toHaveTextContent('est.')
    expect(within(unpricedRow).getAllByRole('cell')[2]).toHaveTextContent('unpriced')
    expect(within(within(unpricedRow).getAllByRole('cell')[2]).getByLabelText(/Cost unavailable/)).toBeInTheDocument()
    expect(within(partialUnpricedRow).getAllByRole('cell')[2]).toHaveTextContent('$5.00')
    expect(within(partialUnpricedRow).getAllByRole('cell')[2]).toHaveTextContent('partial')
  })

  it('keeps Other models visible when durable reconciliation has a remainder', () => {
    const overview = loadedOverview({
      cost: 35,
      calls: 35,
      modelAccounting: {
        rows: [durableRow('Named model', 20, 20, 0)],
        gap: { cost: 15, savingsUSD: 0, calls: 15 },
        coverage: { cost: 20 / 35, calls: 20 / 35 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })
    render(<Models period="lifetime" provider="all" overview={overview} />)

    const primary = screen.getByRole('table', { name: 'Model usage' })
    const otherRow = within(primary).getByRole('row', { name: /Other models/ })
    expect(otherRow).toHaveTextContent('Other models')
    expect(within(otherRow).getAllByRole('cell')[1]).toHaveTextContent('15')
    expect(within(otherRow).getAllByRole('cell')[2]).toHaveTextContent('$15.00')
    expect(within(otherRow).getAllByRole('cell')[3]).toHaveTextContent('$0.00')
  })

  it('loads surviving session detail only when By task is requested', async () => {
    getModels.mockResolvedValue(taskRows)
    render(<Models period="week" provider="anthropic" overview={loadedOverview()} />)

    expect(getModels).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'By task' }))

    await waitFor(() => expect(getModels).toHaveBeenCalledWith('week', 'anthropic', true))
    expect(await screen.findByText('coding')).toBeInTheDocument()
    expect(screen.getByText('delegation')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText(/Task attribution needs the original session records/i)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Cache ×' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Cost / 1M' })).toBeInTheDocument()
  })

  it('carries observed and additive reasoning into task totals', async () => {
    getModels.mockResolvedValue([mixedTaskRow])
    render(<Models period="week" provider="anthropic" overview={loadedOverview()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'By task' }))

    expect(await screen.findByText('coding')).toBeInTheDocument()
    expect(screen.getAllByText('50').length).toBeGreaterThan(0)
    expect(screen.getAllByText('230').length).toBeGreaterThan(0)
  })

  it('keeps Evidence as an explicit on-demand diagnostic lens', async () => {
    getAudit.mockResolvedValue(auditRows)
    render(<Models period="30days" provider="all" overview={loadedOverview()} />)

    expect(getAudit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }))

    await waitFor(() => expect(getAudit).toHaveBeenCalledWith('30days', 'all'))
    expect(await screen.findByText('3.1M')).toBeInTheDocument()
    expect(screen.getByText('900K')).toBeInTheDocument()
    expect(screen.getByText('$252.00')).toBeInTheDocument()
  })

  it('routes Compare from the model surface without changing accounting state', () => {
    const onNavigate = vi.fn()
    render(<Models period="30days" provider="all" overview={loadedOverview()} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Compare…' }))
    expect(onNavigate).toHaveBeenCalledWith('compare')
  })
})
