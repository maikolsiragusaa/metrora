// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { SpendDrivers } from './SpendDrivers'
import { SpendOverview } from './SpendOverview'
import { SpendProjects } from './SpendProjects'

function makeCurrent(overrides: Partial<MenubarPayload['current']> = {}): MenubarPayload['current'] {
  return {
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
    topActivities: [],
    topModels: [],
    localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
    providers: {},
    topProjects: [],
    modelEfficiency: [],
    topSessions: [],
    retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
    routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
    tools: [],
    skills: [],
    subagents: [],
    mcpServers: [],
    ...overrides,
  }
}

function makePayload(current: MenubarPayload['current']): MenubarPayload {
  return {
    generated: '2026-07-10T12:00:00.000Z',
    current,
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: { daily: [] },
  }
}

function tokenKpiCard(viewTestId: string): HTMLElement {
  const view = screen.getByTestId(viewTestId)
  const card = within(view).getByText('Metered tokens').closest('.spend-kpi')
  expect(card).not.toBeNull()
  return card as HTMLElement
}

describe('Spend metered-token KPI evidence semantics', () => {
  it('keeps the legacy presentation for payloads without usageEvidence', () => {
    render(<SpendOverview data={makePayload(makeCurrent())} daily={[]} animateKey="static" />)
    const card = tokenKpiCard('spend-overview-view')
    expect(within(card).getByText('825')).toBeInTheDocument()
    expect(within(card).getByText('Input, output & cache')).toBeInTheDocument()
    expect(card).toHaveAttribute('data-evidence', 'available')
  })

  it('shows known quantities with an incompleteness note when evidence is partial', () => {
    render(<SpendOverview data={makePayload(makeCurrent({ usageEvidence: 'partial' }))} daily={[]} animateKey="static" />)
    const card = tokenKpiCard('spend-overview-view')
    expect(within(card).getByText('825')).toBeInTheDocument()
    expect(within(card).getByText(/Incomplete token data/)).toBeInTheDocument()
    expect(card).toHaveAttribute('data-evidence', 'partial')
  })

  it('never renders a false zero when no token evidence was reported', () => {
    const current = makeCurrent({ usageEvidence: 'unavailable', calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    render(<SpendOverview data={makePayload(current)} daily={[]} animateKey="static" />)
    const card = tokenKpiCard('spend-overview-view')
    expect(within(card).getByText('—')).toBeInTheDocument()
    expect(within(card).queryByText('0')).not.toBeInTheDocument()
    expect(within(card).getByText(/No token evidence reported/)).toBeInTheDocument()
    expect(card).toHaveAttribute('data-evidence', 'unavailable')
  })

  it('applies the same semantics on the Drivers view', () => {
    render(<SpendDrivers data={makePayload(makeCurrent({ usageEvidence: 'partial' }))} />)
    const card = tokenKpiCard('spend-drivers-view')
    expect(within(card).getByText('825')).toBeInTheDocument()
    expect(within(card).getByText(/Observed volume/)).toBeInTheDocument()
    expect(within(card).getByText(/Incomplete token data/)).toBeInTheDocument()
    expect(card).toHaveAttribute('data-evidence', 'partial')
  })

  it('keeps known counts on Drivers when complete and unevidenced records mix', () => {
    const current = makeCurrent({ usageEvidence: 'unavailable', inputTokens: 1200, outputTokens: 500, cacheReadTokens: 300, cacheWriteTokens: 0 })
    render(<SpendDrivers data={makePayload(current)} />)
    const card = tokenKpiCard('spend-drivers-view')
    expect(within(card).getByText('2K')).toBeInTheDocument()
    expect(within(card).getByText(/Incomplete token data/)).toBeInTheDocument()
    expect(card).toHaveAttribute('data-evidence', 'partial')
  })
})

describe('Spend Projects pagination under shrinking datasets', () => {
  function projectsPayload(count: number): MenubarPayload {
    const projectSpend = Array.from({ length: count }, (_, index) => ({
      name: `proj-${String(index + 1).padStart(2, '0')}`,
      cost: count - index,
      savingsUSD: 0,
      sessions: 1,
      calls: index + 1,
      avgCostPerSession: count - index,
    }))
    return makePayload(makeCurrent({ projectSpend, calls: count, sessions: count }))
  }

  it('keeps a valid page and the present projects when a refresh or global filter shrinks the dataset', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SpendProjects data={projectsPayload(30)} />)

    await user.click(screen.getByRole('button', { name: 'Next projects' }))
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument()
    expect(screen.getAllByTestId('spend-project-row')).toHaveLength(5)

    // A global filter or refresh reduces the dataset to 10 projects while
    // the user is still on the second page.
    rerender(<SpendProjects data={projectsPayload(10)} />)
    expect(screen.getAllByTestId('spend-project-row')).toHaveLength(10)
    expect(screen.getByText('1–10 of 10')).toBeInTheDocument()
    expect(screen.getByText('proj-01')).toBeInTheDocument()
    expect(screen.queryByText('No projects match this search.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next projects' })).not.toBeInTheDocument()
  })

  it('distinguishes an empty scope from a search without matches', () => {
    render(<SpendProjects data={projectsPayload(0)} />)
    expect(screen.getByText('No projects in this range yet.')).toBeInTheDocument()
  })
})
