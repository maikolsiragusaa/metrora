// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload, SpendFlow } from '../lib/types'
import { Spend } from './Spend'

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn<() => Promise<MenubarPayload>>(),
  getSpendFlow: vi.fn<() => Promise<SpendFlow>>(),
}))

vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, metrora: mocks }
})

function daily(date: string, cost: number, models: Array<{ name: string; cost: number }>) {
  return {
    date,
    cost,
    savingsUSD: 0,
    calls: 10,
    inputTokens: 50,
    outputTokens: 25,
    cacheReadTokens: 5,
    cacheWriteTokens: 0,
    topModels: models.map(model => ({
      name: model.name,
      cost: model.cost,
      savingsUSD: 0,
      calls: 5,
      inputTokens: 25,
      outputTokens: 12,
    })),
  }
}

function makePayload(): MenubarPayload {
  return {
    generated: '2026-07-10T12:00:00.000Z',
    current: {
      label: 'Last 7 days',
      cost: 32,
      calls: 40,
      sessions: 8,
      oneShotRate: null,
      inputTokens: 500,
      outputTokens: 250,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      cacheHitPercent: 10,
      codexCredits: 0,
      topActivities: [{ name: 'coding', cost: 20, savingsUSD: 0, turns: 12, oneShotRate: null }],
      topModels: [{ name: 'claude-opus-4', cost: 20, savingsUSD: 0, savingsBaselineModel: '', calls: 24, brandId: 'anthropic' }],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      projectSpend: [
        {
          name: 'metrora',
          cost: 20,
          savingsUSD: 0,
          sessions: 5,
          calls: 25,
          avgCostPerSession: 4,
          dailySpend: [{ date: '2026-07-04', cost: 8 }, { date: '2026-07-10', cost: 12 }],
          sessionDetails: [{ date: '2026-07-10', calls: 3, cost: 12, savingsUSD: 0, inputTokens: 50, outputTokens: 20, models: [{ name: 'claude-opus-4', cost: 12, savingsUSD: 0 }] }],
        },
        { name: 'example-dashboard', cost: 12, savingsUSD: 0, sessions: 3, calls: 15, avgCostPerSession: 4 },
      ],
      topProjects: [
        { name: 'metrora', cost: 20, savingsUSD: 0, sessions: 5, avgCostPerSession: 4, sessionDetails: [] },
        { name: 'example-dashboard', cost: 12, savingsUSD: 0, sessions: 3, avgCostPerSession: 4, sessionDetails: [] },
      ],
      modelEfficiency: [],
      topSessions: [],
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [{ name: 'Read', calls: 30 }],
      skills: [],
      subagents: [{ name: 'reviewer', calls: 2, cost: 3 }],
      mcpServers: [{ name: 'filesystem', calls: 9 }],
    },
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: {
      daily: [
        daily('2026-07-04', 8, [{ name: 'claude-opus-4', cost: 8 }]),
        daily('2026-07-06', 4, [{ name: 'gpt-5.5-codex', cost: 4 }]),
        daily('2026-07-10', 20, [{ name: 'claude-opus-4', cost: 12 }, { name: 'gpt-5.5-codex', cost: 4 }]),
      ],
    },
  }
}

function makeFlow(): SpendFlow {
  return {
    period: { label: 'Last 7 days', start: '2026-07-04', end: '2026-07-10' },
    models: [
      { id: 'claude-opus-4', label: 'claude-opus-4', cost: 20 },
      { id: 'gpt-5.5-codex', label: 'gpt-5.5-codex', cost: 12 },
    ],
    projects: [
      { id: 'metrora', label: 'metrora', cost: 20 },
      { id: '__other__', label: '__other__', cost: 12 },
    ],
    links: [
      { model: 'claude-opus-4', project: 'metrora', cost: 20 },
      { model: 'gpt-5.5-codex', project: '__other__', cost: 12 },
    ],
  }
}

describe('Spend control center', () => {
  beforeEach(() => {
    mocks.getOverview.mockReset()
    mocks.getSpendFlow.mockReset()
    mocks.getOverview.mockResolvedValue(makePayload())
    mocks.getSpendFlow.mockResolvedValue(makeFlow())
  })

  it('defaults to Overview with a contiguous daily chart and only the approved views', async () => {
    const { container } = render(<Spend period="week" provider="all" range={{ from: '2026-07-04', to: '2026-07-10' }} />)

    expect(await screen.findByTestId('spend-overview-view')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Drivers' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Flow' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Compare' })).not.toBeInTheDocument()
    expect(screen.getByText('Total spend')).toBeInTheDocument()
    expect(screen.getByText('$32.00')).toBeInTheDocument()

    const chart = screen.getByTestId('spend-daily-chart')
    expect(chart).toHaveAttribute('data-chart-mode', 'model')
    expect(chart.querySelectorAll('.spend-chart-column')).toHaveLength(7)
    expect(container.querySelectorAll('[data-testid="sankey-ribbon"]')).toHaveLength(0)
    expect(screen.queryByText('Read')).not.toBeInTheDocument()
    expect(screen.queryByText('filesystem')).not.toBeInTheDocument()
  })

  it('uses the observed fallback when historical model detail is unavailable', async () => {
    const payload = makePayload()
    payload.history.daily = [daily('2026-07-10', 5, [])]
    mocks.getOverview.mockResolvedValue(payload)

    render(<Spend period="today" provider="all" range={{ from: '2026-07-10', to: '2026-07-10' }} />)

    const chart = await screen.findByTestId('spend-daily-chart')
    expect(chart).toHaveAttribute('data-chart-mode', 'observed')
    expect(within(chart).getByText('Observed spend')).toBeInTheDocument()
  })

  it('opens a project inspector without mixing it into the unselected table', async () => {
    const user = userEvent.setup()
    render(<Spend period="week" provider="all" />)

    await user.click(await screen.findByRole('tab', { name: 'Projects' }))
    expect(screen.getByTestId('spend-projects-view')).toBeInTheDocument()
    expect(screen.queryByTestId('spend-project-inspector')).not.toBeInTheDocument()

    await user.click(screen.getAllByTestId('spend-project-row')[0]!)
    expect(screen.getByTestId('spend-project-inspector')).toBeInTheDocument()
    expect(screen.getByText('Spend history')).toBeInTheDocument()
    expect(screen.getByText('Recent sessions')).toBeInTheDocument()
    expect(screen.getByText('Selected project')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close project details' }))
    expect(screen.queryByTestId('spend-project-inspector')).not.toBeInTheDocument()
  })

  it('supports project search and keeps calls as a canonical optional column', async () => {
    const user = userEvent.setup()
    render(<Spend period="week" provider="all" />)
    await user.click(await screen.findByRole('tab', { name: 'Projects' }))
    const search = screen.getByRole('textbox', { name: 'Search projects' })
    await user.type(search, 'example')
    expect(screen.getByText('example-dashboard')).toBeInTheDocument()
    expect(screen.queryByText('metrora')).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Calls' })).toBeInTheDocument()
  })

  it('keeps spend Drivers focused on monetary attribution and omits call-only Tools/MCP rows', async () => {
    const user = userEvent.setup()
    render(<Spend period="week" provider="all" />)
    await user.click(await screen.findByRole('tab', { name: 'Drivers' }))

    expect(screen.getByText('Activity cost attribution')).toBeInTheDocument()
    expect(screen.getByText('coding')).toBeInTheDocument()
    expect(screen.getByText('Subagent spend')).toBeInTheDocument()
    expect(screen.getByText('reviewer')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'MCP' })).not.toBeInTheDocument()
  })

  it('renders the directional flow and supports node focus', async () => {
    const user = userEvent.setup()
    const { container } = render(<Spend period="week" provider="all" />)
    await user.click(await screen.findByRole('tab', { name: 'Flow' }))

    expect(await screen.findByText('Cost flow · model → project')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid="sankey-ribbon"]')).toHaveLength(2)
    const modelNode = container.querySelector('[data-testid="sankey-node"][data-side="model"]') as HTMLElement
    expect(modelNode).toBeTruthy()
    await user.click(modelNode)
    expect(modelNode).toHaveAttribute('data-selected', 'true')
    expect(container.querySelector('[data-testid="sankey-ribbon"]')?.getAttribute('stroke-opacity')).toBe('.46')
  })
})
