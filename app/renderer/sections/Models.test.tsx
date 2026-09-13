// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditRow, DateRange, DurableModelAccountingRow, DurableModelPresentationRow, ModelPricingSummary, ModelReportRow } from '../lib/types'
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

describe('Models', () => {
  beforeEach(() => {
    getModels.mockReset()
    getAudit.mockReset()
  })

  it('renders the detailed model control-center table by default', () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)

    const primary = screen.getByRole('table', { name: 'Model usage' })
    expect(within(primary).getAllByRole('columnheader').map(header =>
      header.querySelector('.models-sort-header span')?.textContent ?? header.textContent)).toEqual([
      'Model', 'Provider', 'Source', 'Calls', 'Input', 'Output', 'Cache R', 'Cache W', 'Cache×', 'Total', 'ms/1K', 'Cost', 'Cost/1M',
    ])
    expect(screen.getByText('GPT-5.4')).toBeInTheDocument()
    expect(screen.getByText('Claude Opus 4.8')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Model inspector' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Reasoning' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Total tokens' })).not.toBeInTheDocument()
    expect(screen.queryByText(/durable accounting values/i)).not.toBeInTheDocument()
    expect(getModels).not.toHaveBeenCalled()
  })

  it('discloses degraded source reconciliation above durable model totals', () => {
    const overview = loadedOverview()
    overview.data.freshness = { readMode: 'fresh', reconciliation: 'degraded', durableThrough: '2026-09-08' }

    render(<Models period="lifetime" provider="all" overview={overview} />)

    expect(screen.getByRole('status')).toHaveTextContent('source reconciliation is incomplete')
  })

  it('opens and closes the model inspector with observed detail', () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select GPT-5.4' }))
    const inspector = screen.getByRole('complementary', { name: 'Model inspector' })
    expect(within(inspector).getByText('Token composition')).toBeInTheDocument()
    expect(within(inspector).getByText('250.0ms')).toBeInTheDocument()
    expect(within(inspector).getByText('5.1M total')).toBeInTheDocument()
    expect(within(inspector).getByText('Available daily token activity')).toBeInTheDocument()
    expect(within(inspector).getByText('Daily activity unavailable for this model.')).toBeInTheDocument()
    expect(inspector.querySelector('.models-activity-plot')).toBeNull()
    expect(within(inspector).queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
    expect(within(inspector).getByRole('tab', { name: 'Providers / Routes' })).toBeInTheDocument()
    expect(within(inspector).getByRole('tab', { name: 'Metadata' })).toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole('button', { name: 'Close model inspector' }))
    expect(screen.queryByRole('complementary', { name: 'Model inspector' })).not.toBeInTheDocument()
  })

  it('keeps factual model names unchanged and does not add model-name badges', () => {
    const names = [
      'Cursor (auto)',
      'Codex Auto Review',
      'GPT-5.6 Luna',
      'GPT-5.6 Sol',
      'GLM-5.3-Flash',
      'mimo-v2.5-free',
      'muse-spark-alpha',
      'unknown',
    ]
    const overview = loadedOverview({
      modelAccounting: {
        rows: names.map(name => durableRow(name, 1, 1, 0)),
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })

    render(<Models period="lifetime" provider="all" overview={overview} />)

    const table = screen.getByRole('table', { name: 'Model usage' })
    for (const name of names) {
      expect(within(table).getByRole('button', { name: `Select ${name}` })).toBeInTheDocument()
    }
    expect(within(table).queryByText(/unresolved model|synthetic|pseudo-model|auto model/i)).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /add alias/i })).not.toBeInTheDocument()
  })

  it('separates model brand, provider, and source in the inspector while keeping provenance reachable', () => {
    const overview = loadedOverview({
      modelAccounting: {
        rows: [durableRow('GPT-5.6 Luna', 2, 4, 0, { brandId: 'openai', provider: 'openai', sourceProviders: ['codex'], rawModels: ['gpt-5.6-luna'] })],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })

    render(<Models period="lifetime" provider="all" overview={overview} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select GPT-5.6 Luna' }))

    const inspector = screen.getByRole('complementary', { name: 'Model inspector' })
    const identity = within(inspector).getByLabelText('Model identity details')
    expect(within(inspector).getByText('GPT-5.6 Luna')).toBeInTheDocument()
    expect(identity).toHaveTextContent('Brand')
    expect(identity).toHaveTextContent('OpenAI')
    expect(identity).toHaveTextContent('Provider')
    expect(identity).toHaveTextContent('Source')
    expect(identity).toHaveTextContent('Codex')
    expect(within(inspector).queryByText('Model house')).not.toBeInTheDocument()
    expect(within(inspector).queryByText('GPT-5.6 Luna OpenAI')).not.toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole('tab', { name: 'Metadata' }))
    expect(within(inspector).getByText('Exact identifiers retained by Metrora')).toBeInTheDocument()
    expect(within(inspector).getByText('gpt-5.6-luna')).toBeInTheDocument()
    expect(within(inspector).getByText('Canonical ID')).toBeInTheDocument()
  })

  it('renders available daily activity from matching history and no fabricated series', () => {
    const overview = loadedOverview()
    overview.data.history = {
      daily: [{
        date: '2026-09-10',
        cost: 1,
        savingsUSD: 0,
        calls: 3,
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        topModels: [{ name: 'GPT-5.4', cost: 1, savingsUSD: 0, calls: 3, inputTokens: 1_000, outputTokens: 500 }],
      }],
    }

    render(<Models period="lifetime" provider="all" overview={overview} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select GPT-5.4' }))

    const inspector = screen.getByRole('complementary', { name: 'Model inspector' })
    expect(within(inspector).getByRole('img', { name: /Daily token activity for GPT-5\.4/ })).toBeInTheDocument()
    expect(within(inspector).getByText(/3 calls/)).toBeInTheDocument()
    expect(within(inspector).getByText(/1\.5K observed/)).toBeInTheDocument()
    expect(within(inspector).queryByText('Daily activity unavailable for this model.')).not.toBeInTheDocument()
  })

  it('shows unavailable token-derived and timing metrics instead of fake zeros for legacy durable rows', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Select Legacy model' }))
    const inspector = screen.getByRole('complementary', { name: 'Model inspector' })
    expect(within(inspector).getByText(/Token composition is unavailable/i)).toBeInTheDocument()
    const row = within(screen.getByRole('table', { name: 'Model usage' })).getByRole('row', { name: /Legacy model/ })
    expect(row.querySelectorAll('.models-unavailable').length).toBeGreaterThanOrEqual(7)
    expect(container.querySelector('.provider-mono')).toBeInTheDocument()
  })

  it('sorts the primary model table by total observed tokens on demand', () => {
    render(<Models period="lifetime" provider="all" overview={loadedOverview()} />)

    const table = screen.getByRole('table', { name: 'Model usage' })
    fireEvent.click(within(table).getByRole('button', { name: 'Total' }))
    const modelRows = within(screen.getByRole('table', { name: 'Model usage' })).getAllByRole('row').slice(1)
    expect(modelRows[0]).toHaveTextContent('GPT-5.4')
  })

  it('sorts observed ms per 1K fastest-first on double-click and leaves untimed rows at the bottom', async () => {
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
    const table = screen.getByRole('table', { name: 'Model usage' })
    const timingHeader = within(table).getByRole('button', { name: 'ms/1K' })

    fireEvent.click(timingHeader)
    fireEvent.click(timingHeader)
    fireEvent.doubleClick(timingHeader)

    const bodyRows = within(screen.getByRole('table', { name: 'Model usage' })).getAllByRole('row').slice(1)
    expect(bodyRows[0]).toHaveTextContent('Faster model')
    expect(bodyRows[1]).toHaveTextContent('Slower model')
    expect(bodyRows[2]).toHaveTextContent('Untimed model')
  })

  it('does not expose unsupported Saved or efficiency claims in the primary table', () => {
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
    expect(within(primary).queryByRole('columnheader', { name: 'Saved' })).not.toBeInTheDocument()
    expect(within(primary).queryByRole('columnheader', { name: /Efficiency/i })).not.toBeInTheDocument()
    expect(within(primary).getByRole('row', { name: /Saved model/ })).toBeInTheDocument()
    expect(within(primary).getByRole('row', { name: /Free model/ })).toBeInTheDocument()
    expect(within(primary).getByRole('row', { name: /Missing saved model/ })).toBeInTheDocument()
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
    expect(within(freeRow).getAllByRole('cell')[11]).toHaveTextContent('$0.00')
    expect(within(freeRow).getAllByRole('cell')[11]).not.toHaveTextContent(/unpriced|est\.|partial/i)
    expect(within(estimatedRow).getAllByRole('cell')[11]).toHaveTextContent('$4.00')
    expect(within(estimatedRow).getAllByRole('cell')[11]).toHaveTextContent('est.')
    expect(within(unpricedRow).getAllByRole('cell')[11]).toHaveTextContent('unpriced')
    expect(within(within(unpricedRow).getAllByRole('cell')[11]).getByLabelText(/Cost unavailable/)).toBeInTheDocument()
    expect(within(partialUnpricedRow).getAllByRole('cell')[11]).toHaveTextContent('$5.00')
    expect(within(partialUnpricedRow).getAllByRole('cell')[11]).toHaveTextContent('partial')
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
    expect(within(otherRow).getAllByRole('cell')[3]).toHaveTextContent('15')
    expect(within(otherRow).getAllByRole('cell')[11]).toHaveTextContent('$15.00')
    expect(within(otherRow).getAllByRole('cell')[12]).toHaveTextContent('—')
  })

  it('filters canonical model rows by search, model brand, and source without fetching again', () => {
    const codexAccounting = durableRow('GPT-5.4', 20, 20, 0, { brandId: 'openai', provider: 'openai', sourceProviders: ['codex'], rawModels: ['gpt-5.4'] })
    const openAiSibling = durableRow('GPT-5.5', 8, 8, 0, { brandId: 'openai', provider: 'amazon-bedrock', sourceProviders: ['zed'], rawModels: ['openai.gpt-5.5'] })
    const claudeAccounting = durableRow('Claude Opus 4.8', 10, 10, 0, { brandId: 'anthropic', provider: 'anthropic', sourceProviders: ['claude'], rawModels: ['claude-opus-4-8'] })
    const present = (row: DurableModelAccountingRow, identity: string): DurableModelPresentationRow => ({
      ...row,
      presentationIdentity: identity,
      provider: row.provider,
      providers: row.provider ? [row.provider] : [],
      sourceProviders: row.sourceProviders ?? [],
      rawModels: row.rawModels ?? [row.name],
      canonicalIdentities: [],
      economicVariants: ['default'],
      reasoningSemantics: 'unavailable',
      timingCoverage: 'unavailable',
      deliveryRows: [row],
      deliveryStatus: 'exact',
    })
    const overview = loadedOverview({
      modelAccounting: {
        rows: [codexAccounting, openAiSibling, claudeAccounting],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
      modelPresentation: {
        rows: [present(codexAccounting, 'test:codex'), present(openAiSibling, 'test:openai-sibling'), present(claudeAccounting, 'test:claude')],
        accountingRowCount: 3,
      },
    })
    render(<Models period="lifetime" provider="all" overview={overview} />)
    const table = () => screen.getByRole('table', { name: 'Model usage' })
    const search = screen.getByRole('textbox', { name: 'Filter models' })
    const providerStrip = screen.getByRole('group', { name: 'Filter models by model brand' })

    expect(screen.queryByRole('combobox', { name: 'Provider' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Provider' })).toHaveAttribute('title', 'Delivery provider or API route')
    expect(screen.getByRole('columnheader', { name: 'Source' })).toHaveAttribute('title', 'Metrora client/source that contributed the usage')
    expect(within(table()).getByRole('row', { name: /GPT-5\.4/ })).toHaveTextContent('OpenAI')
    expect(within(table()).getByRole('row', { name: /GPT-5\.4/ })).toHaveTextContent('Codex')
    expect(within(table()).getByRole('row', { name: /GPT-5\.5/ })).toHaveTextContent('Amazon Bedrock')
    expect(within(table()).getByRole('row', { name: /GPT-5\.5/ })).toHaveTextContent('Zed')

    fireEvent.change(search, { target: { value: 'codex' } })
    expect(within(table()).getByRole('row', { name: /GPT-5\.4/ })).toBeInTheDocument()
    expect(within(table()).queryByRole('row', { name: /Claude Opus/ })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(within(providerStrip).getByRole('button', { name: 'Anthropic' }))
    expect(within(table()).getByRole('row', { name: /Claude Opus/ })).toBeInTheDocument()
    expect(within(table()).queryByRole('row', { name: /GPT-5\.4/ })).not.toBeInTheDocument()
    expect(within(table()).queryByRole('row', { name: /GPT-5\.5/ })).not.toBeInTheDocument()

    fireEvent.click(within(providerStrip).getByRole('button', { name: 'All model brands' }))
    fireEvent.click(screen.getByRole('button', { name: 'Model source' }))
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }))
    expect(within(table()).getByRole('row', { name: /GPT-5\.4/ })).toBeInTheDocument()
    expect(within(table()).queryByRole('row', { name: /Claude Opus/ })).not.toBeInTheDocument()
    expect(within(table()).queryByRole('row', { name: /GPT-5\.5/ })).not.toBeInTheDocument()
    expect(getModels).not.toHaveBeenCalled()
  })

  it('loads surviving session detail only when By task is requested', async () => {
    getModels.mockResolvedValue(taskRows)
    render(<Models period="week" provider="anthropic" overview={loadedOverview()} />)

    expect(getModels).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'By task' }))

    await waitFor(() => expect(getModels).toHaveBeenCalledWith('week', 'anthropic', true))
    expect(await screen.findByText('coding')).toBeInTheDocument()
    expect(screen.getByText('delegation')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Models grouped by task' })).getAllByText('Anthropic')).toHaveLength(2)
    expect(screen.getByText(/Task attribution needs the original session records/i)).toBeInTheDocument()
    const taskTable = screen.getByRole('table', { name: 'Models grouped by task' })
    expect(within(taskTable).getByRole('columnheader', { name: 'Task' })).toBeInTheDocument()
    expect(within(taskTable).getByRole('columnheader', { name: 'Model' })).toBeInTheDocument()
    const taskRail = screen.getByRole('complementary', { name: 'Task insights' })
    expect(taskRail).toHaveClass('models-task-insights-rail')
    expect(taskRail).toHaveAttribute('data-sticky-rail', 'true')
    expect(screen.getByRole('columnheader', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeInTheDocument()
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
    const evidenceTable = screen.getByRole('table', { name: 'Model usage evidence' })
    expect(within(evidenceTable).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Model', 'Source', 'Calls', 'Total tokens', 'Cost', 'Cost / 1M', 'Raw fields', 'Pricing', 'Recon', 'Reasoning',
    ])
    expect(within(evidenceTable).queryByRole('columnheader', { name: 'Evidence' })).not.toBeInTheDocument()
    expect(within(evidenceTable).getByText('Complete')).toBeInTheDocument()
    expect(within(evidenceTable).getByText('Resolved')).toBeInTheDocument()
    expect(within(evidenceTable).getByText('100%')).toBeInTheDocument()
    expect(within(evidenceTable).getByText('Observed')).toBeInTheDocument()
    expect(within(evidenceTable).getByText('102M')).toBeInTheDocument()
    expect(within(evidenceTable).getByText('$252.00')).toBeInTheDocument()
    const evidenceDetail = await screen.findByRole('complementary', { name: 'Model evidence detail' })
    expect(within(evidenceDetail).getByText(/3.1M tokens/)).toBeInTheDocument()
    expect(within(evidenceDetail).getByText(/900K tokens/)).toBeInTheDocument()
    expect(within(evidenceDetail).getByText('Pricing resolution')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close model evidence detail' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('keeps unpriced evidence and reconciliation unknown without fabricated percentages', async () => {
    const unpricedAudit: AuditRow = {
      ...auditRows[0]!,
      rates: null,
      attributedCostUSD: 0,
      cost: { ...auditRows[0]!.cost, recomputedTotalUSD: 0 },
    }
    getAudit.mockResolvedValue([unpricedAudit])
    render(<Models period="30days" provider="all" overview={loadedOverview()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }))
    await waitFor(() => expect(getAudit).toHaveBeenCalledWith('30days', 'all'))

    const evidenceTable = screen.getByRole('table', { name: 'Model usage evidence' })
    const row = within(evidenceTable).getByRole('row', { name: /Claude Opus 4\.8/ })
    expect(row).toHaveTextContent('Unpriced')
    expect(row).toHaveTextContent('Unknown')
    expect(row).not.toHaveTextContent('0%')
    const detail = await screen.findByRole('complementary', { name: 'Model evidence detail' })
    expect(within(detail).getAllByText('Unpriced')).not.toHaveLength(0)
  })

  it('opens the in-page Compare workspace without changing accounting state', () => {
    const onNavigate = vi.fn()
    const { container } = render(<Models period="30days" provider="all" overview={loadedOverview()} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }))
    expect(screen.getByRole('complementary', { name: 'Compare models panel' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Compare GPT-5.4' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Compare Claude Opus 4.8' })).toBeChecked()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('.models-filter-select')).toBeNull()
    expect(screen.getByRole('button', { name: 'Delivery provider' })).toHaveTextContent('All delivery providers')
    fireEvent.click(screen.getByRole('button', { name: 'Delivery provider' }))
    expect(screen.getByRole('option', { name: 'All delivery providers' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'All delivery providers' }))
    expect(screen.getByText('Key takeaways')).toBeInTheDocument()
    expect(screen.getByText(/Measured signals/)).toBeInTheDocument()
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('keeps known model brand identity when Compare has no delivery provider', () => {
    const overview = loadedOverview({
      modelAccounting: {
        rows: [durableRow('Gemini 3.8 Flash', 2, 2, 0, { brandId: 'google', sourceProviders: ['antigravity'], rawModels: ['gemini-3.8-flash'] })],
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })

    render(<Models period="lifetime" provider="all" overview={overview} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }))

    const comparison = screen.getByRole('complementary', { name: 'Compare models panel' })
    expect(within(comparison).getByText('Google · Provider unavailable')).toBeInTheDocument()
    const tableRow = within(screen.getByRole('table', { name: 'Models available for comparison' })).getByRole('row', { name: /Gemini 3\.8 Flash/ })
    const providerCell = within(tableRow).getAllByRole('cell')[2]!
    expect(within(providerCell).getByText('Provider unavailable')).toBeInTheDocument()
    expect(providerCell.querySelector('img')).toBeNull()
  })

  it('preserves the three-model Compare selection bound', () => {
    const names = ['Model one', 'Model two', 'Model three', 'Model four']
    const overview = loadedOverview({
      modelAccounting: {
        rows: names.map(name => durableRow(name, 1, 1, 0)),
        gap: { cost: 0, savingsUSD: 0, calls: 0 },
        coverage: { cost: 1, calls: 1 },
        tokenCoverage: { cost: 1, calls: 1 },
      },
    })

    render(<Models period="lifetime" provider="all" overview={overview} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }))

    expect(screen.getByText('3/3 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Compare Model four' })).toBeDisabled()
  })
})
