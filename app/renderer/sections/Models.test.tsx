// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditRow, DateRange, ModelPricingSummary, ModelReportRow } from '../lib/types'
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
  } as any
}

describe('Models', () => {
  beforeEach(() => {
    getModels.mockReset()
    getAudit.mockReset()
  })

  it('renders one durable model table with shared token/cache/unit-cost/performance metrics without spawning the detail report', () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)

    expect(screen.getByText('Model usage')).toBeInTheDocument()
    expect(screen.getByText('GPT-5.4')).toBeInTheDocument()
    expect(screen.getByText('Claude Opus 4.8')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Cache ×' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'ms / 1K' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Cost / 1M' })).toBeInTheDocument()
    expect(screen.getByText('9×')).toBeInTheDocument()
    expect(screen.getByText('5.1M')).toBeInTheDocument()
    expect(screen.getByText('250.0ms')).toBeInTheDocument()
    expect(screen.getByText('300.0ms')).toBeInTheDocument()
    expect(screen.getByText(/observed active-generation timing/i)).toBeInTheDocument()
    expect(screen.queryByText(/Detailed token breakdown/i)).not.toBeInTheDocument()
    expect(getModels).not.toHaveBeenCalled()
  })

  it('shows unavailable token-derived and timing metrics instead of fake zeros for legacy durable rows', () => {
    const overview = loadedOverview({
      modelAccounting: {
        rows: [{
          name: 'Legacy model',
          cost: 12,
          savingsUSD: 0,
          calls: 9,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          tokenDetail: false,
        }],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 0, calls: 0 },
      },
    })

    const { container } = render(<Models period="lifetime" provider="all" overview={overview} />)

    expect(screen.getByText(/Legacy rows without a durable token split show/i)).toBeInTheDocument()
    const row = screen.getByText('Legacy model').closest('tr')!
    expect(row.textContent?.match(/—/g)?.length).toBeGreaterThanOrEqual(8)
    expect(container.querySelector('.provider-mono')).toBeInTheDocument()
  })

  it('sorts the durable model table by total observed tokens on demand', () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Total tokens' }))
    const modelRows = screen.getAllByRole('row').filter(row => row.querySelector('tbody') == null).slice(1)
    expect(modelRows[0]).toHaveTextContent('GPT-5.4')
  })

  it('sorts observed ms per 1K fastest-first and leaves untimed rows at the bottom', () => {
    const overview = loadedOverview({
      modelAccounting: {
        rows: [
          {
            name: 'Untimed model', cost: 9, savingsUSD: 0, calls: 9,
            inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, tokenDetail: true,
          },
          {
            name: 'Slower model', cost: 8, savingsUSD: 0, calls: 8,
            inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, tokenDetail: true,
            activeDurationMs: 4000, activeGeneratedTokens: 10_000,
          },
          {
            name: 'Faster model', cost: 7, savingsUSD: 0, calls: 7,
            inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, tokenDetail: true,
            activeDurationMs: 2000, activeGeneratedTokens: 10_000,
          },
        ],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })
    render(<Models period="lifetime" provider="all" overview={overview} />)

    fireEvent.click(screen.getByRole('tab', { name: 'ms / 1K' }))
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows[0]).toHaveTextContent('Faster model')
    expect(bodyRows[1]).toHaveTextContent('Slower model')
    expect(bodyRows[2]).toHaveTextContent('Untimed model')
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

  it('keeps Audit as an explicit on-demand diagnostic lens', async () => {
    getAudit.mockResolvedValue(auditRows)
    render(<Models period="30days" provider="all" overview={loadedOverview()} />)

    expect(getAudit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }))

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