// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditRow, DateRange, ModelPricingState, ModelPricingSummary, ModelReportRow } from '../lib/types'
import { Models } from './Models'

const { getModels, getAudit, getOverview } = vi.hoisted(() => ({
  getModels: vi.fn<(period: string, provider: string, byTask: boolean, range?: DateRange) => Promise<ModelReportRow[]>>(),
  getAudit: vi.fn<(period: string, provider: string, range?: DateRange) => Promise<AuditRow[]>>(),
  getOverview: vi.fn<(period: string, provider: string, range?: DateRange) => Promise<any>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getModels, getAudit, getOverview } }
})

function pricing(state: ModelPricingState, totalCalls: number): ModelPricingSummary {
  const base: ModelPricingSummary = { state, totalCalls, coveredCalls: totalCalls, pricedCalls: totalCalls, explicitZeroCalls: 0, unavailableCalls: 0, unknownCalls: 0, missingPriceRecordCalls: 0 }
  if (state === 'explicit-zero') return { ...base, pricedCalls: 0, explicitZeroCalls: totalCalls }
  if (state === 'unavailable') return { ...base, coveredCalls: 0, pricedCalls: 0, unavailableCalls: totalCalls, missingPriceRecordCalls: totalCalls }
  if (state === 'unknown') return { ...base, coveredCalls: 0, pricedCalls: 0, unknownCalls: totalCalls }
  return base
}

const rows: ModelReportRow[] = [
  {
    provider: 'anthropic',
    providerDisplayName: 'Anthropic',
    model: 'claude-opus-4.8',
    modelDisplayName: 'Claude Opus 4.8',
    category: null,
    topCategory: 'coding',
    topCategoryShare: 0.71,
    inputTokens: 152_600_000,
    outputTokens: 9_640_000,
    cacheWriteTokens: 16_000_000,
    cacheReadTokens: 119_400_000,
    totalTokens: 297_640_000,
    calls: 4812,
    costUSD: 331.2,
    savingsUSD: 86.4,
    savingsBaselineModel: 'Claude Opus 4.8',
    pricing: pricing('priced', 4812),
    credits: null,
  },
  {
    provider: 'codex',
    providerDisplayName: 'Codex',
    model: 'gpt-5.5-codex',
    modelDisplayName: 'GPT-5.5 Codex',
    category: null,
    topCategory: 'debugging',
    topCategoryShare: 0.42,
    inputTokens: 86_900_000,
    outputTokens: 7_520_000,
    cacheWriteTokens: 3_200_000,
    cacheReadTokens: 45_100_000,
    totalTokens: 142_720_000,
    calls: 2704,
    costUSD: 137.9,
    savingsUSD: 35.1,
    savingsBaselineModel: 'GPT-5.5 Codex',
    pricing: pricing('priced', 2704),
    credits: 173,
  },
  {
    provider: 'local',
    providerDisplayName: 'Local',
    model: 'llama-local',
    modelDisplayName: 'Llama Local',
    category: null,
    inputTokens: 750_000,
    outputTokens: 400_000,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 1_150_000,
    calls: 82,
    costUSD: 0,
    savingsUSD: 12.34,
    savingsBaselineModel: 'Claude Opus 4.8',
    pricing: pricing('explicit-zero', 82),
    credits: null,
  },
  {
    provider: 'custom',
    providerDisplayName: 'Custom',
    model: 'my-proxy-model',
    modelDisplayName: 'my-proxy-model',
    category: null,
    inputTokens: 4_800_000,
    outputTokens: 400_000,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 5_200_000,
    calls: 176,
    costUSD: 0,
    savingsUSD: 0,
    savingsBaselineModel: '',
    pricing: pricing('unavailable', 176),
    credits: null,
  },
]

const byTaskRows: ModelReportRow[] = [
  {
    ...rows[0],
    category: 'coding',
    calls: 3400,
    inputTokens: 100_000_000,
    outputTokens: 6_100_000,
    cacheReadTokens: 88_000_000,
    totalTokens: 210_100_000,
    costUSD: 244.12,
    savingsUSD: 61.22,
    pricing: pricing('priced', 3400),
  },
  {
    ...rows[0],
    category: 'delegation',
    calls: 120,
    inputTokens: 8_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 6_000_000,
    totalTokens: 14_500_000,
    costUSD: 20.88,
    savingsUSD: 5.18,
    pricing: pricing('priced', 120),
  },
]

const auditRows: AuditRow[] = [
  {
    provider: 'anthropic',
    providerDisplayName: 'Anthropic',
    model: 'claude-opus-4.8',
    modelDisplayName: 'Claude Opus 4.8',
    calls: 1200,
    raw: { inputTokens: 50_000_000, outputTokens: 3_100_000, reasoningTokens: 900_000, cacheCreationInputTokens: 8_000_000, cacheReadInputTokens: 40_000_000, cachedInputTokens: 0, webSearchRequests: 0 },
    displayed: { inputTokens: 50_000_000, outputTokens: 4_000_000, cacheWriteTokens: 8_000_000, cacheReadTokens: 40_000_000 },
    rates: { inputCostPerToken: 0.000003, outputCostPerToken: 0.000015, cacheWriteCostPerToken: 0.00000375, cacheReadCostPerToken: 0.0000003, webSearchCostPerRequest: 0.01, fastMultiplier: 1 },
    cost: { input: 150, output: 60, cacheWrite: 30, cacheRead: 12, webSearch: 0, recomputedTotalUSD: 252 },
    attributedCostUSD: 252,
  },
  {
    provider: 'custom',
    providerDisplayName: 'Custom',
    model: 'my-proxy-model',
    modelDisplayName: 'my-proxy-model',
    calls: 90,
    raw: { inputTokens: 4_800_000, outputTokens: 400_000, reasoningTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cachedInputTokens: 0, webSearchRequests: 0 },
    displayed: { inputTokens: 4_800_000, outputTokens: 400_000, cacheWriteTokens: 0, cacheReadTokens: 0 },
    rates: null,
    cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, recomputedTotalUSD: 0 },
    attributedCostUSD: 0,
  },
]

function emptyDurable() {
  return { current: { topModels: [], cost: 0, calls: 0 } }
}

describe('Models', () => {
  beforeEach(() => {
    getModels.mockReset()
    getAudit.mockReset()
    getOverview.mockReset()
    getOverview.mockResolvedValue(emptyDurable())
  })

  it('renders priced surviving-session rows with series dots, costs, and savings', async () => {
    getModels.mockResolvedValue(rows)

    const { container } = render(<Models period="30days" provider="all" />)

    expect(await screen.findByText('Claude Opus 4.8')).toBeInTheDocument()
    expect(screen.getByText('4,812')).toBeInTheDocument()
    expect(screen.getByText('152.6M')).toBeInTheDocument()
    expect(screen.getByText('9.6M')).toBeInTheDocument()
    expect(screen.getByText('119.4M')).toBeInTheDocument()
    expect(screen.getByText('$331.20')).toBeInTheDocument()
    expect(screen.getByText('$86.40')).toHaveClass('pos')
    expect(screen.getByText('GPT-5.5 Codex')).toBeInTheDocument()
    expect(screen.getByText('$137.90')).toBeInTheDocument()
    expect(screen.getByText('$35.10')).toHaveClass('pos')

    const dots = [...container.querySelectorAll('.mdot')]
    expect(dots.some(dot => dot.getAttribute('style')?.includes('var(--s-opus)'))).toBe(true)
    expect(dots.some(dot => dot.getAttribute('style')?.includes('var(--s-gpt)'))).toBe(true)
  })

  it('uses durable accounting as the primary by-model authority without hiding narrower detail', async () => {
    getOverview.mockResolvedValue({
      current: {
        cost: 1456.252943,
        calls: 22275,
        topModels: [
          { name: 'GPT-5.4', cost: 1456.252943, savingsUSD: 0, savingsBaselineModel: '', calls: 22275 },
        ],
      },
    })
    getModels.mockResolvedValue([{
      ...rows[1],
      model: 'gpt-5.4',
      modelDisplayName: 'GPT-5.4',
      calls: 6439,
      costUSD: 409.300054,
      pricing: pricing('priced', 6439),
    }])

    render(<Models period="lifetime" provider="all" />)

    expect(await screen.findByText('Historical accounting')).toBeInTheDocument()
    expect(screen.getByText('$1,456.25')).toBeInTheDocument()
    expect(screen.getByText('22,275')).toBeInTheDocument()
    expect(screen.getByText(/same accounting authority used by Home/i)).toBeInTheDocument()
    expect(await screen.findByText('$409.30')).toBeInTheDocument()
    expect(screen.getByText('6,439')).toBeInTheDocument()
    expect(screen.getByText(/may be a subset of historical accounting/i)).toBeInTheDocument()
  })

  it('names the provider on each surviving model row so duplicate model names stay distinguishable', async () => {
    const dupRows: ModelReportRow[] = [
      { ...rows[0], provider: 'minimax', providerDisplayName: 'MiniMax', model: 'minimax-m3', modelDisplayName: 'MiniMax M3' },
      { ...rows[1], provider: 'openrouter', providerDisplayName: 'OpenRouter', model: 'minimax-m3', modelDisplayName: 'MiniMax M3' },
    ]
    getModels.mockResolvedValue(dupRows)

    render(<Models period="30days" provider="all" />)

    expect(await screen.findAllByText('MiniMax M3')).toHaveLength(2)
    expect(screen.getByText('MiniMax')).toBeInTheDocument()
    expect(screen.getByText('OpenRouter')).toBeInTheDocument()
  })

  it('names the provider on each by-task model group and labels it as available detail', async () => {
    getModels.mockResolvedValueOnce([rows[0]]).mockResolvedValueOnce(byTaskRows)

    render(<Models period="week" provider="all" />)

    expect(await screen.findByText('Claude Opus 4.8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'By task' }))

    expect(await screen.findByText('coding')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText(/Task attribution requires original session records/i)).toBeInTheDocument()
  })

  it('renders codex rows with credits and real cost as priced', async () => {
    getModels.mockResolvedValue([rows[1]])

    render(<Models period="30days" provider="all" />)

    expect(await screen.findByText('GPT-5.5 Codex')).not.toHaveClass('dim')
    expect(screen.getByText('$137.90')).not.toHaveClass('dim')
    expect(screen.getByText('$35.10')).toHaveClass('pos')
    expect(screen.queryByText('add alias ›')).not.toBeInTheDocument()
  })

  it('renders local saved-only rows as priced with real savings', async () => {
    getModels.mockResolvedValue([rows[2]])

    render(<Models period="30days" provider="all" />)

    expect(await screen.findByText('Llama Local')).not.toHaveClass('dim')
    expect(screen.getByText('750K')).toBeInTheDocument()
    expect(screen.getByText('400K')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).not.toHaveClass('dim')
    expect(screen.getByText('$12.34')).toHaveClass('pos')
    expect(screen.queryByText('add alias ›')).not.toBeInTheDocument()
  })

  it('keeps usage visible when model pricing is unavailable', async () => {
    getModels.mockResolvedValue([rows[3]])

    render(<Models period="30days" provider="all" />)

    expect(await screen.findByText('my-proxy-model')).not.toHaveClass('dim')
    expect(screen.getByText('4.8M')).toBeInTheDocument()
    expect(screen.getByText('400K')).toBeInTheDocument()
    expect(screen.getByText('Price unavailable')).toBeInTheDocument()
    expect(screen.getByText('add alias ›')).toHaveClass('alias')
    expect(screen.getByRole('cell', { name: 'Cost unavailable' })).toHaveTextContent('—')
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('refetches with byTask=true and renders the task category', async () => {
    getModels.mockResolvedValueOnce(rows).mockResolvedValueOnce(byTaskRows)

    render(<Models period="week" provider="anthropic" />)

    expect(await screen.findByText('Claude Opus 4.8')).toBeInTheDocument()
    expect(getModels).toHaveBeenCalledWith('week', 'anthropic', false)

    fireEvent.click(screen.getByRole('tab', { name: 'By task' }))

    await waitFor(() => expect(getModels).toHaveBeenCalledWith('week', 'anthropic', true))
    expect(await screen.findByText('coding')).toBeInTheDocument()
    expect(screen.getByText('delegation')).toBeInTheDocument()
    expect(screen.getByText('3,520')).toBeInTheDocument()
    expect(screen.getByText('$265.00')).toBeInTheDocument()
    expect(screen.getByText('$66.40')).toBeInTheDocument()
    expect(screen.getByText('$244.12')).toBeInTheDocument()
    expect(screen.getAllByText('Claude Opus 4.8')).toHaveLength(1)
    expect(document.querySelectorAll('.model-task-group')).toHaveLength(1)
    expect(document.querySelectorAll('.model-task-row')).toHaveLength(2)
  })

  it('renders the audit lens with raw vs normalized token columns and an estimated flag', async () => {
    getModels.mockResolvedValue(rows)
    getAudit.mockResolvedValue(auditRows)

    render(<Models period="30days" provider="all" />)

    expect(await screen.findByText('Claude Opus 4.8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }))

    expect(await screen.findByText('my-proxy-model')).toBeInTheDocument()
    expect(getAudit).toHaveBeenCalledWith('30days', 'all')
    expect(screen.getByText('3.1M')).toBeInTheDocument()
    expect(screen.getByText('900K')).toBeInTheDocument()
    expect(screen.getByText('4M')).toBeInTheDocument()
    expect(screen.getByText('$252.00')).toBeInTheDocument()
    expect(screen.getAllByText('est')).toHaveLength(1)
  })

  it('shows the audit empty state when there is nothing to audit', async () => {
    getModels.mockResolvedValue(rows)
    getAudit.mockResolvedValue([])

    render(<Models period="week" provider="all" />)

    expect(await screen.findByText('Claude Opus 4.8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }))

    expect(await screen.findByText('No model usage to audit in this range yet.')).toBeInTheDocument()
  })

  it('passes the exact custom range to both durable and surviving authorities', async () => {
    const range = { from: '2026-07-01', to: '2026-07-31' }
    getModels.mockResolvedValue(rows)

    render(<Models period="30days" provider="codex" range={range} />)

    await screen.findByText('Claude Opus 4.8')
    expect(getOverview).toHaveBeenCalledWith('30days', 'codex', range)
    expect(getModels).toHaveBeenCalledWith('30days', 'codex', false, range)
  })
})
