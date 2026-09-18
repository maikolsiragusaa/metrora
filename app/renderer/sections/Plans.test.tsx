// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveCurrency } from '../lib/format'
import type { JsonPlanSummary, QuotaProvider, StatusJson } from '../lib/types'
import { Plans } from './Plans'

const { getPlans, getQuota } = vi.hoisted(() => ({
  getPlans: vi.fn<(period: string) => Promise<StatusJson>>(),
  getQuota: vi.fn<(force?: boolean) => Promise<QuotaProvider[]>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, metrora: { getPlans, getQuota } }
})

const periodStart = new Date(2026, 5, 15).toISOString()
const periodEnd = new Date(2026, 6, 15).toISOString()

const claudePlan: JsonPlanSummary = {
  id: 'claude-max',
  provider: 'claude',
  budget: 200,
  spent: 230,
  percentUsed: 115,
  status: 'over',
  projectedMonthEnd: 254,
  daysUntilReset: 4,
  periodStart,
  periodEnd,
}

const cursorPlan: JsonPlanSummary = {
  id: 'cursor-pro',
  provider: 'cursor',
  budget: 20,
  spent: 8.2,
  percentUsed: 41,
  status: 'under',
  projectedMonthEnd: 12.4,
  daysUntilReset: 4,
  periodStart,
  periodEnd,
}

const codexPlan: JsonPlanSummary = {
  id: 'none',
  provider: 'codex',
  budget: 0,
  spent: 31.02,
  percentUsed: 15,
  status: 'under',
  projectedMonthEnd: 31.02,
  daysUntilReset: 4,
  periodStart,
  periodEnd,
}

const baseStatus = {
  currency: 'USD',
  today: { cost: 22.5, savings: 4.2, calls: 19 },
  month: { cost: 269.02, savings: 52, calls: 181 },
} satisfies Omit<StatusJson, 'plan' | 'plans'>

const statusWithPlans: StatusJson = {
  ...baseStatus,
  plans: {
    claude: claudePlan,
    cursor: cursorPlan,
    codex: codexPlan,
  },
}

function quotaProviders(): QuotaProvider[] {
  const now = Date.now()
  return [
    quota('claude', {
      planLabel: 'Max 20x',
      windows: [
        { id: 'five_hour', label: '5-hour', usedFraction: 0.25, resetsAt: new Date(now + 2 * 60 * 60_000 + 30 * 60_000).toISOString(), windowSeconds: null },
        { id: 'seven_day', label: 'Weekly', usedFraction: 0.92, resetsAt: new Date(now + (3 * 24 + 14) * 60 * 60_000 + 30 * 60_000).toISOString(), windowSeconds: null },
      ],
    }),
    quota('codex', { connection: 'disconnected', availability: 'unavailable', freshness: 'unavailable', observedAt: null }),
  ]
}

function quota(provider: 'claude' | 'codex', overrides: Partial<QuotaProvider> = {}): QuotaProvider {
  return {
    schemaVersion: 1,
    provider,
    authority: 'provider-reported',
    availability: 'available',
    connection: 'connected',
    freshness: 'fresh',
    observedAt: '2026-07-12T00:00:00.000Z',
    planLabel: null,
    windows: [],
    credits: null,
    rateLimit: { state: 'clear', retryAt: null },
    ...overrides,
  }
}

describe('Plans', () => {
  beforeEach(() => {
    setActiveCurrency({ code: 'USD', symbol: '$', rate: 1 })
    getPlans.mockReset()
    getQuota.mockReset()
    getQuota.mockResolvedValue(quotaProviders())
  })

  it('renders live quota windows, tier, severity, disconnected hint, and manual plans below', async () => {
    getPlans.mockResolvedValue(statusWithPlans)

    const { container } = render(<Plans period="30days" />)

    expect((await screen.findAllByText('Max 20x')).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Capacity' })).toBeInTheDocument()
    expect(screen.getByLabelText('Capacity status: Connected')).toBeInTheDocument()
    expect(screen.getByText('25% used · 75% remaining · resets in 2h 29m')).toBeInTheDocument()
    expect(screen.getByText('92% used · 8% remaining · resets in 3d 14h')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="quota-track-five_hour"] i')).toHaveClass('accent')
    expect(container.querySelector('[data-testid="quota-track-seven_day"] i')).toHaveClass('bad')
    // The disconnected provider is a list row; its recovery copy lives in the
    // inspector once selected.
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }))
    expect(screen.getByText('Not connected. Log in with the Codex CLI.')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Budget plans' })).toBeInTheDocument()
    expect(screen.getByText('Cursor Pro')).toBeInTheDocument()
    expect(screen.getByText('$20.00 / month · cursor')).toBeInTheDocument()
    expect(screen.getByText('$8.20 · 41%')).toBeInTheDocument()
    const cursorFill = container.querySelector('[data-testid="plan-track-cursor"] i')
    expect(cursorFill).toHaveStyle({ width: '41%' })
    expect(cursorFill).not.toHaveClass('over')
    expect(screen.getByText('On track')).toHaveClass('pace', 'ok')
    expect(screen.queryByText('Claude Max')).not.toBeInTheDocument()
    expect(screen.queryByText('API usage')).not.toBeInTheDocument()
  })

  it('shows the provider list with search, status filter, and a detail inspector', async () => {
    getPlans.mockResolvedValue(baseStatus)

    render(<Plans period="30days" />)

    // List rows carry the provider name, plan sublabel, and status.
    expect(await screen.findByRole('button', { name: /Claude.*Max 20x.*Connected/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Codex.*OpenAI.*Disconnected/ })).toBeInTheDocument()
    // The first provider is inspected by default.
    expect(screen.getByLabelText('Claude capacity details')).toBeInTheDocument()
    // Search narrows the list without a new fetch.
    fireEvent.change(screen.getByLabelText('Search providers'), { target: { value: 'codex' } })
    expect(screen.queryByRole('button', { name: /Claude/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Codex/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search providers'), { target: { value: '' } })
    // Status filter narrows the list without a new fetch.
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'unavailable' } })
    expect(screen.queryByRole('button', { name: /Claude/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Codex/ })).toBeInTheDocument()
    expect(getQuota).toHaveBeenCalledTimes(1)
  })

  it('switches the inspector when another provider row is selected', async () => {
    getPlans.mockResolvedValue(baseStatus)

    render(<Plans period="30days" />)

    expect(await screen.findByLabelText('Claude capacity details')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }))
    expect(screen.getByLabelText('Codex capacity details')).toBeInTheDocument()
    expect(screen.queryByLabelText('Claude capacity details')).not.toBeInTheDocument()
    expect(screen.getByText('Not connected. Log in with the Codex CLI.')).toBeInTheDocument()
    // Selecting rows is client-side: no additional quota fetch.
    expect(getQuota).toHaveBeenCalledTimes(1)
  })

  it('summarizes factual counts without a fabricated overall capacity percentage', async () => {
    getPlans.mockResolvedValue(baseStatus)

    const { container } = render(<Plans period="30days" />)

    await screen.findByRole('button', { name: /Claude/ })
    const summary = screen.getByRole('list', { name: 'Capacity summary' })
    expect(within(summary).getByText('Providers')).toBeInTheDocument()
    expect(screen.getByText('1 connected · 1 unavailable')).toBeInTheDocument()
    expect(screen.getByText('Using capacity')).toBeInTheDocument()
    expect(screen.getByText('Provider credits')).toBeInTheDocument()
    expect(screen.getByText('No provider credits reported')).toBeInTheDocument()
    expect(screen.queryByText('Pooled credits')).not.toBeInTheDocument()
    // No single overall-remaining bar may be synthesized across providers.
    expect(container.querySelector('[role="progressbar"]')).not.toBeInTheDocument()
    // Team membership is workspace display language, not a product entity: with
    // no workspace context there is no team card and no invented headcount.
    expect(screen.queryByText('Team members')).not.toBeInTheDocument()
  })

  it('sums real provider credit balances in the pooled credits card', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([quota('codex', { planLabel: 'Plus', credits: { balance: 3.5, currency: 'USD' } })])

    render(<Plans period="30days" />)

    expect(await screen.findByText('$3.50')).toBeInTheDocument()
    expect(screen.getByText('Available from 1 provider')).toBeInTheDocument()
  })

  it('offers honest Usage and Team access inspector tabs without fake content', async () => {
    getPlans.mockResolvedValue(baseStatus)
    const onNavigate = vi.fn()

    render(<Plans period="30days" onNavigate={onNavigate} />)

    await screen.findByLabelText('Claude capacity details')
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))
    expect(screen.getByText(/lives with the rest of your Metrora data/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Models' }))
    expect(onNavigate).toHaveBeenCalledWith('models')
    fireEvent.click(screen.getByRole('tab', { name: /Team access/ }))
    expect(screen.getByText(/Workspace teams are not connected yet/)).toBeInTheDocument()
  })

  it('opens provider configuration in Settings from the inspector', async () => {
    getPlans.mockResolvedValue(baseStatus)
    const onNavigate = vi.fn()

    render(<Plans period="30days" onNavigate={onNavigate} />)

    await screen.findByLabelText('Claude capacity details')
    fireEvent.click(screen.getByRole('button', { name: 'Open in Settings' }))
    expect(onNavigate).toHaveBeenCalledWith('settings', 'plans')
  })

  it('shows the Workspaces beta placeholder without pretending live enterprise data', async () => {
    getPlans.mockResolvedValue(baseStatus)

    render(<Plans period="30days" />)

    await screen.findByRole('button', { name: /Claude/ })
    fireEvent.click(screen.getByRole('tab', { name: /Workspaces/ }))
    expect(screen.getByText(/None of this is live yet/)).toBeInTheDocument()
    expect(screen.getByText(/will scope provider capacity to the selected collaboration scope/)).toBeInTheDocument()
    // No invented numbers, pools, members, or policies anywhere.
    expect(screen.queryByText(/12 members/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument()
  })

  it('reports the last provider observation without claiming a fresh refresh', async () => {
    getPlans.mockResolvedValue(baseStatus)

    render(<Plans period="30days" />)

    expect(await screen.findByText(/Last updated/)).toBeInTheDocument()
  })

  it('agrees on one canonical status across summary, list, and inspector', async () => {
    getPlans.mockResolvedValue(baseStatus)
    // A failed collection with no retained facts is unavailable everywhere —
    // never "Waiting" in one surface and "Unavailable" in another.
    getQuota.mockResolvedValue([
      quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }),
      quota('codex', {
        planLabel: 'Plus',
        windows: [{ id: 'secondary', label: 'Weekly', usedFraction: 0.1, resetsAt: null, windowSeconds: 604800 }],
      }),
    ])

    render(<Plans period="30days" />)

    expect(await screen.findByText('1 connected · 1 unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Claude.*Anthropic.*Unavailable/ })).toBeInTheDocument()
    // The evidence-bearing provider is selected first, so the inspector shows
    // the connected provider, not the unavailable one.
    expect(screen.getByLabelText('Codex capacity details')).toBeInTheDocument()
    expect(screen.getByLabelText('Capacity status: Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Claude/ }))
    expect(screen.getByLabelText('Claude capacity details')).toBeInTheDocument()
    expect(screen.getByLabelText('Capacity status: Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
  })

  it('selects the provider with fresh evidence first and keeps manual selection stable', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([
      quota('claude', { connection: 'disconnected', availability: 'unavailable', freshness: 'unavailable', observedAt: null }),
      quota('codex', {
        planLabel: 'Plus',
        windows: [{ id: 'secondary', label: 'Weekly', usedFraction: 0.1, resetsAt: null, windowSeconds: 604800 }],
      }),
    ])

    const { rerender } = render(<Plans period="30days" refreshToken={0} />)

    // Codex carries the only fresh evidence, so it is inspected first even
    // though Claude orders first in the list.
    expect(await screen.findByLabelText('Codex capacity details')).toBeInTheDocument()
    // A manual selection sticks across refreshes while its provider is present.
    fireEvent.click(screen.getByRole('button', { name: /Claude/ }))
    expect(screen.getByLabelText('Claude capacity details')).toBeInTheDocument()
    rerender(<Plans period="30days" refreshToken={1} />)
    expect(await screen.findByLabelText('Claude capacity details')).toBeInTheDocument()
  })

  it('keeps provider provenance in a progressive details disclosure', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([quota('codex', { planLabel: 'Plus', credits: { balance: 3.5, currency: 'USD' } })])

    const { container } = render(<Plans period="30days" />)

    await screen.findByText('Credits remaining · $3.50')
    const details = container.querySelector('details.quota-details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Provider details'))
    expect(details).toHaveAttribute('open')
    expect(details).toHaveTextContent('Source')
    expect(details).toHaveTextContent('Provider-reported')
    expect(details).toHaveTextContent('Observed')
  })

  it('renders provider credits when no quota windows are present', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([quota('codex', { planLabel: 'Plus', credits: { balance: 3.5, currency: 'USD' } })])

    render(<Plans period="30days" />)

    expect(await screen.findByText('The provider did not report quota windows.')).toBeInTheDocument()
    expect(screen.getByText('Credits remaining · $3.50')).toBeInTheDocument()
  })

  it('renders an explicit zero credit balance when no quota windows are present', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([quota('codex', { credits: { balance: 0, currency: 'USD' } })])

    render(<Plans period="30days" />)

    expect(await screen.findByText('Credits remaining · $0.00')).toBeInTheDocument()
  })

  it('labels a passed reset boundary without fabricating unavailable capacity', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([
      quota('claude', {
        planLabel: 'Pro',
        windows: [{ id: 'primary', label: 'Primary', usedFraction: 1, resetsAt: '2026-07-11T00:00:00.000Z', windowSeconds: null }],
      }),
      quota('codex', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }),
    ])

    render(<Plans period="30days" />)

    expect(await screen.findByText('100% used · 0% remaining · reset passed')).toBeInTheDocument()
    expect(screen.getByLabelText('Capacity status: Connected')).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^quota-track-/)).toHaveLength(1)
    // The unavailable provider is one selection away in the list.
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }))
    expect(screen.getByLabelText('Capacity status: Unavailable')).toBeInTheDocument()
  })

  it('renders stale credits-only last-good data with its original observation note', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([quota('codex', {
      connection: 'transientFailure',
      availability: 'unavailable',
      freshness: 'stale',
      observedAt: '2026-07-12T00:00:00.000Z',
      credits: { balance: 3.5, currency: 'USD' },
    })])

    render(<Plans period="30days" />)

    expect(await screen.findByText(/Showing last provider-reported quota from/)).toBeInTheDocument()
    expect(screen.getByLabelText('Capacity status: Stale')).toBeInTheDocument()
    expect(screen.getByText('Credits remaining · $3.50')).toBeInTheDocument()
  })

  it('does not render injected provider facts when freshness is unavailable', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([quota('codex', {
      availability: 'unavailable',
      freshness: 'unavailable',
      observedAt: null,
      planLabel: 'Injected Plan',
      windows: [{ id: 'primary', label: 'Injected window', usedFraction: 0.25, resetsAt: null, windowSeconds: null }],
      credits: { balance: 3.5, currency: 'USD' },
    })])

    const { container } = render(<Plans period="30days" />)

    expect(await screen.findByText('The provider did not report quota evidence.')).toBeInTheDocument()
    expect(screen.queryByText('Injected Plan')).not.toBeInTheDocument()
    expect(screen.queryByText('Credits remaining · $3.50')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quota-track-primary')).not.toBeInTheDocument()
    expect(container.querySelector('.quota-windows')).not.toBeInTheDocument()
  })

  it('keeps manual budget overage and clamped-track behavior', async () => {
    getPlans.mockResolvedValue({
      ...baseStatus,
      plans: {
        grok: { ...claudePlan, id: 'supergrok', provider: 'grok' },
      },
    })

    const { container } = render(<Plans period="30days" />)

    expect(await screen.findByText('SuperGrok')).toBeInTheDocument()
    expect(screen.getByText('$230.00 · 115% · $30.00 over')).toBeInTheDocument()
    const fill = container.querySelector('[data-testid="plan-track-grok"] i')
    expect(fill).toHaveStyle({ width: '100%' })
    expect(fill).toHaveClass('over')
    expect(screen.getByText('On pace to exceed; projected $254.00 by Jul 14')).toHaveClass('pace', 'hot')
  })

  it('renders near status as an amber non-exceeding projection when below budget', async () => {
    getPlans.mockResolvedValue({
      ...baseStatus,
      plans: {
        grok: {
          id: 'supergrok-heavy',
          provider: 'grok',
          budget: 300,
          spent: 255,
          percentUsed: 85,
          status: 'near',
          projectedMonthEnd: 280,
          daysUntilReset: 4,
          periodStart,
          periodEnd,
        },
      },
    })

    render(<Plans period="30days" />)

    const pace = await screen.findByText('85% of budget used; projected $280.00 by Jul 14')
    expect(pace).toHaveClass('pace', 'hot')
    expect(screen.queryByText(/On pace to exceed/)).not.toBeInTheDocument()
  })

  it('falls back to StatusJson.plan when the CLI returns a singular plan summary', async () => {
    getPlans.mockResolvedValue({
      ...baseStatus,
      plan: cursorPlan,
    })

    render(<Plans period="month" />)

    expect(await screen.findByText('Cursor Pro')).toBeInTheDocument()
  })

  it('omits the budget section when StatusJson has no manual plan summaries', async () => {
    getPlans.mockResolvedValue({
      currency: 'USD',
      today: { cost: 0, savings: 0, calls: 0 },
      month: { cost: 0, savings: 0, calls: 0 },
    })

    render(<Plans period="month" />)

    fireEvent.click(await screen.findByRole('button', { name: /Codex/ }))
    expect(screen.getByText('Not connected. Log in with the Codex CLI.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Budget plans' })).not.toBeInTheDocument()
  })

  it('renders the CLI locate state when getPlans reports not-found', async () => {
    getPlans.mockRejectedValue({ kind: 'not-found', message: 'metrora not found' })

    render(<Plans period="week" />)

    expect(await screen.findByText('Locate the metrora CLI')).toBeInTheDocument()
  })

  it('does not re-apply the FX rate to CLI-converted plan values (symbol swap only)', async () => {
    // getPlans values arrive already converted by the CLI (convertCost). With a
    // EUR rate active, the pane must only swap the symbol — a second ×0.9 here
    // would render €18.00 / €7.38 instead of the correct €20.00 / €8.20.
    setActiveCurrency({ code: 'EUR', symbol: '€', rate: 0.9 })
    getPlans.mockResolvedValue({ ...baseStatus, currency: 'EUR', plans: { cursor: cursorPlan } })

    render(<Plans period="30days" />)

    expect(await screen.findByText('€20.00 / month · cursor')).toBeInTheDocument()
    expect(screen.getByText('€8.20 · 41%')).toBeInTheDocument()
  })

  it('forces a quota refresh only when refreshToken changes, not on the steady poll', async () => {
    getPlans.mockResolvedValue(statusWithPlans)

    const { rerender } = render(<Plans period="30days" refreshToken={0} />)
    await screen.findAllByText('Max 20x')
    expect(getQuota).toHaveBeenCalledWith(false) // mount is a steady poll
    getQuota.mockClear()

    rerender(<Plans period="30days" refreshToken={1} />) // manual refresh bumps the token
    await waitFor(() => expect(getQuota).toHaveBeenCalledWith(true))

    getQuota.mockClear()
    rerender(<Plans period="30days" refreshToken={1} />) // unchanged token must not re-force
    for (const call of getQuota.mock.calls) expect(call[0]).toBe(false)
  })

  it('renders permission-denied CLI failures as the amber Full Disk Access state', async () => {
    getPlans.mockRejectedValue({ kind: 'nonzero', message: 'Cursor permission denied: grant Full Disk Access' })

    render(<Plans period="week" />)

    expect(await screen.findByText('Permission denied')).toBeInTheDocument()
    expect(screen.getByText('permission denied; grant Full Disk Access')).toHaveStyle({ color: 'var(--warn)' })
  })

  it('expands the Connect affordance from the provider inspector', async () => {
    getPlans.mockResolvedValue(statusWithPlans)

    render(<Plans period="30days" />)

    fireEvent.click(await screen.findByRole('button', { name: /Codex/ }))
    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(screen.getByText('Not connected. Log in with the Codex CLI.')).toBeInTheDocument()
    fireEvent.click(connect)
    expect(screen.getByText('codex login')).toBeInTheDocument()
  })

  it('renders the honest rate-limited note on a 429 backoff, per provider owner', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([
      quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null, rateLimit: { state: 'backoff', retryAt: '2026-07-12T00:05:00.000Z' } }),
      quota('codex', { connection: 'stale', availability: 'unavailable', freshness: 'stale', rateLimit: { state: 'backoff', retryAt: '2026-07-12T00:05:00.000Z' } }),
    ])

    render(<Plans period="30days" />)

    // Each provider's note renders in its own inspector selection.
    expect(await screen.findByText('Anthropic rate limited the quota endpoint, retrying in a few minutes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }))
    expect(screen.getByText('OpenAI rate limited the quota endpoint, retrying in a few minutes')).toBeInTheDocument()
    // The rate-limited note replaces the generic waiting copy.
    expect(screen.queryByText('waiting on the CLI…')).not.toBeInTheDocument()
  })

  it('falls back to the generic waiting note when a transient failure is not rate limited', async () => {
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([
      quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null }),
    ])

    render(<Plans period="30days" />)

    expect(await screen.findByText('Provider quota is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.queryByText(/rate limited the quota endpoint/)).not.toBeInTheDocument()
  })

  it('renders the access-denied state with provider-neutral recovery copy and a locked indicator', async () => {
    getPlans.mockResolvedValue(statusWithPlans)
    getQuota.mockResolvedValue([
      quota('claude', { connection: 'accessDenied', availability: 'unavailable', freshness: 'unavailable', observedAt: null }),
      quota('codex', { planLabel: 'Plus', windows: [{ id: 'secondary', label: 'Weekly', usedFraction: 0.1, resetsAt: null, windowSeconds: 604800 }] }),
    ])

    render(<Plans period="30days" />)

    // The evidence-bearing provider is inspected first; the locked provider
    // is one selection away.
    expect(await screen.findByLabelText('Codex capacity details')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Claude/ }))
    expect(screen.getByText('Credential access is needed. Grant access in the provider or operating-system prompt, then Refresh.')).toBeInTheDocument()
    // List row, inspector badge, status block and details grid all agree on
    // the one canonical status — never "Waiting" here, never a second label.
    expect(screen.getAllByText('Locked').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
    expect(screen.queryByText('Access needed')).not.toBeInTheDocument()
  })
})