// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompareJsonReport, ModelStats } from '../lib/types'
import { Compare } from './Compare'

const mocks = vi.hoisted(() => ({
  getCompareModels: vi.fn<(period: string, provider: string) => Promise<ModelStats[]>>(),
  getCompare: vi.fn<(period: string, provider: string, modelA: string, modelB: string) => Promise<CompareJsonReport>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, metrora: mocks }
})

const modelA: ModelStats = {
  model: 'Opus 4.8', calls: 4812, cost: 331.2, outputTokens: 9_640_000, inputTokens: 152_600_000,
  cacheReadTokens: 119_400_000, cacheWriteTokens: 16_000_000, totalTurns: 1000, editTurns: 786,
  oneShotTurns: 558, retries: 267, selfCorrections: 33, editCost: 0.42,
  firstSeen: '2026-06-12T00:00:00.000Z', lastSeen: '2026-07-11T00:00:00.000Z',
}
const modelB: ModelStats = {
  model: 'Sonnet 5', calls: 3318, cost: 108.63, outputTokens: 6_080_000, inputTokens: 77_700_000,
  cacheReadTokens: 63_300_000, cacheWriteTokens: 7_000_000, totalTurns: 850, editTurns: 641,
  oneShotTurns: 404, retries: 300, selfCorrections: 40, editCost: 0.19,
  firstSeen: '2026-06-14T00:00:00.000Z', lastSeen: '2026-07-11T00:00:00.000Z',
}
const report: CompareJsonReport = {
  period: { label: 'Last 30 days', provider: 'all' },
  modelA,
  modelB,
  metrics: [
    { section: 'Performance', label: 'One-shot rate', valueA: 71, valueB: 63, formatFn: 'percent', winner: 'a' },
    { section: 'Performance', label: 'Retry rate', valueA: 8, valueB: 12, formatFn: 'percent', winner: 'a' },
    { section: 'Efficiency', label: 'Cost / call', valueA: 0.069, valueB: 0.033, formatFn: 'cost', winner: 'b' },
    { section: 'Efficiency', label: 'Cache hit rate', valueA: 44, valueB: 45, formatFn: 'percent', winner: 'b' },
  ],
  categories: [
    { category: 'Coding', turnsA: 400, editTurnsA: 312, oneShotRateA: 74, turnsB: 350, editTurnsB: 280, oneShotRateB: 66, winner: 'a' },
  ],
  workingStyle: [
    { label: 'Planning rate', valueA: 22, valueB: 9, formatFn: 'percent' },
  ],
}

describe('Compare', () => {
  beforeEach(() => {
    mocks.getCompareModels.mockReset()
    mocks.getCompare.mockReset()
  })

  it('defaults to the top two and makes observed usage the primary comparison', async () => {
    const user = userEvent.setup()
    mocks.getCompareModels.mockResolvedValue([modelA, modelB])
    mocks.getCompare.mockResolvedValue(report)
    render(<Compare period="30days" provider="all" />)

    const first = await screen.findByLabelText('First model')
    const second = screen.getByLabelText('Second model')
    await waitFor(() => {
      expect(first).toHaveTextContent('Opus 4.8 · 4,812 calls')
      expect(second).toHaveTextContent('Sonnet 5 · 3,318 calls')
    })

    expect(await screen.findByRole('table', { name: 'Observed usage comparison' })).toBeInTheDocument()
    expect(mocks.getCompare).toHaveBeenCalledWith('30days', 'all', 'Opus 4.8', 'Sonnet 5')
    expect(screen.getByRole('table', { name: 'Observed efficiency comparison' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Comparison observation context' })).toBeInTheDocument()
    expect(screen.getByText(/not a benchmark score or a claim about general model quality/i)).toBeInTheDocument()

    const usage = screen.getByRole('table', { name: 'Observed usage comparison' })
    expect(within(usage).getByText('Cache ×')).toBeInTheDocument()
    expect(within(usage).getByText('Total tokens')).toBeInTheDocument()
    expect(within(usage).getByText('Cost / 1M')).toBeInTheDocument()
    expect(within(usage).getByLabelText('Opus 4.8, Cache ×: 0.78×')).toBeInTheDocument()
    expect(within(usage).getByLabelText('Opus 4.8, Total tokens: 297.6M')).toBeInTheDocument()
    expect(within(usage).getByLabelText('Opus 4.8, Cost / 1M: $1.11')).toBeInTheDocument()

    // The old backend Cache hit rate is deliberately not duplicated in the
    // primary efficiency block now that Cache × is the shared user-facing metric.
    expect(screen.getByRole('table', { name: 'Observed efficiency comparison' })).not.toHaveTextContent('Cache hit rate')
    expect(screen.queryByTitle('Better value')).not.toBeInTheDocument()

    await user.click(second)
    await user.click(screen.getByRole('option', { name: 'Opus 4.8 · 4,812 calls' }))
    await waitFor(() => expect(first).toHaveTextContent('Sonnet 5 · 3,318 calls'))
    expect(mocks.getCompare).toHaveBeenCalledWith('30days', 'all', 'Sonnet 5', 'Opus 4.8')
  })

  it('keeps workflow heuristics collapsed and explicitly experimental', async () => {
    const user = userEvent.setup()
    mocks.getCompareModels.mockResolvedValue([modelA, modelB])
    mocks.getCompare.mockResolvedValue(report)
    render(<Compare period="30days" provider="all" />)

    const disclosure = await screen.findByText('Workflow diagnostics · Experimental')
    expect(disclosure.closest('details')).not.toHaveAttribute('open')

    await user.click(disclosure)
    const diagnostics = screen.getByRole('table', { name: 'Editing signals comparison' })
    expect(within(diagnostics).getByText('One-shot rate')).toBeInTheDocument()
    expect(within(diagnostics).getByText('Retry rate')).toBeInTheDocument()
    expect(screen.getByText(/Secondary signals, not model quality scores/i)).toBeInTheDocument()
    expect(screen.queryByTitle('Better value')).not.toBeInTheDocument()
  })

  it('keeps unavailable cache reuse distinct from zero', async () => {
    const sparseModelA: ModelStats = {
      ...modelA,
      inputTokens: 0,
      cacheReadTokens: 20_000,
      firstSeen: '',
      lastSeen: '',
    }
    const sparseReport: CompareJsonReport = {
      ...report,
      modelA: sparseModelA,
      metrics: [
        { section: 'Performance', label: 'One-shot rate', valueA: null, valueB: 63, formatFn: 'percent', winner: 'b' },
        report.metrics[2]!,
      ],
      categories: [
        { ...report.categories[0]!, oneShotRateA: null, winner: 'b' },
      ],
    }
    mocks.getCompareModels.mockResolvedValue([sparseModelA, modelB])
    mocks.getCompare.mockResolvedValue(sparseReport)
    render(<Compare period="30days" provider="all" />)

    const usage = await screen.findByRole('table', { name: 'Observed usage comparison' })
    expect(within(usage).getByLabelText('Opus 4.8, Cache ×: —')).toHaveTextContent('—')
    expect(screen.getByLabelText('Opus 4.8, Days observed: Not available')).toBeInTheDocument()
  })

  it('notes that custom ranges are unsupported and still compares by period', async () => {
    mocks.getCompareModels.mockResolvedValue([modelA, modelB])
    mocks.getCompare.mockResolvedValue(report)
    render(<Compare period="30days" provider="all" range={{ from: '2026-07-01', to: '2026-07-11' }} />)

    expect(await screen.findByText('Compare uses the selected period; custom dates are not supported yet.')).toBeInTheDocument()
    expect(mocks.getCompareModels).toHaveBeenCalledWith('30days', 'all')
  })

  it('renders the need-two-models note without requesting a report', async () => {
    mocks.getCompareModels.mockResolvedValue([modelA])
    render(<Compare period="week" provider="all" />)

    expect(await screen.findByText('Need at least two models with usage in this range to compare.')).toBeInTheDocument()
    expect(mocks.getCompare).not.toHaveBeenCalled()
  })
})
