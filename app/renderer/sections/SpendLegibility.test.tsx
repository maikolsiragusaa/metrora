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

function payload(): MenubarPayload {
  return {
    generated: '2026-08-04T12:00:00.000Z',
    current: {
      label: 'Today',
      cost: 4.5,
      calls: 3,
      sessions: 2,
      oneShotRate: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitPercent: 0,
      codexCredits: 0,
      topActivities: [],
      topModels: [],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      topProjects: [{
        name: 'project-alpha',
        cost: 4.5,
        savingsUSD: 0,
        sessions: 2,
        avgCostPerSession: 2.25,
        sessionDetails: [
          {
            date: 'not-a-date',
            calls: 1,
            cost: 1.5,
            savingsUSD: 0,
            inputTokens: 0,
            outputTokens: 0,
            models: [],
          },
          {
            date: '2026-08-04',
            calls: 2,
            cost: 3,
            savingsUSD: 0,
            inputTokens: 0,
            outputTokens: 0,
            models: [
              { name: 'model-a', cost: 2, savingsUSD: 0 },
              { name: 'model-b', cost: 1, savingsUSD: 0 },
            ],
          },
        ],
      }],
      modelEfficiency: [],
      topSessions: [],
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [],
      skills: [],
      subagents: [],
      mcpServers: [],
    },
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: { daily: [] },
  }
}

function emptyFlow(): SpendFlow {
  return {
    period: { label: 'Today', start: '2026-08-04', end: '2026-08-04' },
    models: [],
    projects: [],
    links: [],
  }
}

describe('Spend project session evidence', () => {
  beforeEach(() => {
    mocks.getOverview.mockReset()
    mocks.getSpendFlow.mockReset()
    mocks.getOverview.mockResolvedValue(payload())
    mocks.getSpendFlow.mockResolvedValue(emptyFlow())
  })

  it('names missing dates and models without turning them into zero or an anonymous dash', async () => {
    const user = userEvent.setup()
    render(<Spend period="today" provider="all" />)

    await user.click(await screen.findByRole('button', { name: /project-alpha/i }))

    const table = screen.getByRole('table', { name: 'project-alpha sessions' })
    expect(within(table).getByRole('columnheader', { name: 'Date' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Models' })).toBeInTheDocument()
    expect(within(table).getByLabelText('Date not available')).toHaveTextContent('—')
    expect(within(table).getByLabelText('Models: not identified')).toHaveTextContent('Not identified')
  })

  it('preserves every model in the accessible name while keeping the dense row compact', async () => {
    const user = userEvent.setup()
    render(<Spend period="today" provider="all" />)

    await user.click(await screen.findByRole('button', { name: /project-alpha/i }))

    const table = screen.getByRole('table', { name: 'project-alpha sessions' })
    const models = within(table).getByLabelText('Models: model-a, model-b')
    expect(models).toHaveTextContent('model-a +1 more')
    expect(models).toHaveAttribute('title', 'model-a, model-b')
    expect(within(table).getByRole('row', { name: /Aug 4\. Models model-a, model-b\. 2 calls\. Cost \$3\.00\./ })).toBeInTheDocument()
  })
})