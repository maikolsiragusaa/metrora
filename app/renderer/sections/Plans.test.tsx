import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Plans, rateLimitedNote } from './Plans'
import type { QuotaProvider, StatusJson } from '../lib/types'
import { refreshAll } from '../lib/refreshCadence'

const { getPlans, getQuota } = vi.hoisted(() => ({
  getPlans: vi.fn(),
  getQuota: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  metrora: {
    getPlans,
    getQuota,
  },
}))

const baseStatus: StatusJson = {
  generated: '2026-07-12T00:00:00.000Z',
  period: '30days',
  currency: 'USD',
  plan: null,
  plans: {},
  providers: [],
  pricing: { currency: 'USD', current: true, source: 'embedded', lastUpdated: '2026-07-12T00:00:00.000Z' },
}

const statusWithPlans: StatusJson = {
  ...baseStatus,
  plans: {
    cursor: {
      provider: 'cursor',
      id: 'cursor-pro',
      spent: 8.2,
      budget: 20,
      percentUsed: 41,
      projectedMonthEnd: 12,
      status: 'ok',
      periodStart: '2026-07-01',
      periodEnd: '2026-08-01',
    },
  },
}

function quota(provider: QuotaProvider['provider'], overrides: Partial<QuotaProvider> = {}): QuotaProvider {
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
    getPlans.mockReset()
    getQuota.mockReset()
    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([])
  })

  it('renders live quota windows, tier, severity, disconnected hint, and manual plans below', async () => {
    getPlans.mockResolvedValue(statusWithPlans)
    getQuota.mockResolvedValue([
      quota('claude', {
        planLabel: 'Max 5x',
        windows: [
          { id: 'five_hour', label: '5-hour', usedFraction: 0.75, resetsAt: '2026-07-12T03:00:00.000Z', windowSeconds: 18_000 },
          { id: 'seven_day', label: 'Weekly', usedFraction: 0.92, resetsAt: '2026-07-15T00:00:00.000Z', windowSeconds: 604_800 },
        ],
      }),
      quota('codex', { connection: 'disconnected', availability: 'unavailable', freshness: 'unavailable', observedAt: null }),
    ])

    render(<Plans period="30days" />)

    expect(await screen.findByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Max 5x')).toBeInTheDocument()
    expect(screen.getByText(/75% used/)).toBeInTheDocument()
    expect(screen.getByTestId('quota-track-five_hour').querySelector('i')).toHaveClass('warn')
    expect(screen.getByTestId('quota-track-seven_day').querySelector('i')).toHaveClass('bad')
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('Not connected. Sign in with the Codex CLI, then Refresh.')).toBeInTheDocument()
    expect(screen.getByText('Cursor Pro')).toBeInTheDocument()
  })

  it('keeps provider provenance in a progressive details disclosure', async () => {
    getQuota.mockResolvedValue([
      quota('kimi', {
        source: { kind: 'provider-api', stability: 'experimental' },
        windows: [{ id: 'weekly', label: 'Weekly', usedFraction: 0.2, resetsAt: null, windowSeconds: 604_800 }],
      }),
    ])

    render(<Plans period="30days" />)

    expect(await screen.findByText('Kimi Code')).toBeInTheDocument()
    expect(screen.getByText('Provider details')).toBeInTheDocument()
    expect(screen.getByText('Provider API · Experimental')).toBeInTheDocument()
  })

  it('renders provider credits when no quota windows are present', async () => {
    getQuota.mockResolvedValue([quota('codex', { credits: { balance: 3.5, currency: 'USD' } })])
    render(<Plans period="30days" />)
    expect(await screen.findByText('Credits remaining · $3.50')).toBeInTheDocument()
  })

  it('renders an explicit zero credit balance when no quota windows are present', async () => {
    getQuota.mockResolvedValue([quota('codex', { credits: { balance: 0, currency: 'USD' } })])
    render(<Plans period="30days" />)
    expect(await screen.findByText('Credits remaining · $0.00')).toBeInTheDocument()
  })

  it('labels a passed reset boundary without fabricating unavailable capacity', async () => {
    getQuota.mockResolvedValue([
      quota('claude', { windows: [{ id: 'five_hour', label: '5-hour', usedFraction: 0.25, resetsAt: '2020-01-01T00:00:00.000Z', windowSeconds: 18_000 }] }),
    ])
    render(<Plans period="30days" />)
    expect(await screen.findByText(/reset passed/)).toBeInTheDocument()
  })

  it('renders stale credits-only last-good data with its original observation note', async () => {
    getQuota.mockResolvedValue([
      quota('codex', {
        availability: 'unavailable', connection: 'transientFailure', freshness: 'stale',
        observedAt: '2026-07-11T23:00:00.000Z', credits: { balance: 2.25, currency: 'USD' },
      }),
    ])
    render(<Plans period="30days" />)
    expect(await screen.findByText('Credits remaining · $2.25')).toBeInTheDocument()
    expect(screen.getByText(/Showing last provider-reported quota from/)).toBeInTheDocument()
  })

  it('does not render injected provider facts when freshness is unavailable', async () => {
    getQuota.mockResolvedValue([
      quota('codex', {
        availability: 'unavailable', connection: 'connected', freshness: 'unavailable', observedAt: null,
        planLabel: 'Injected', credits: { balance: 999, currency: 'USD' },
        windows: [{ id: 'fake', label: 'Fake', usedFraction: 1, resetsAt: null, windowSeconds: null }],
      }),
    ])
    render(<Plans period="30days" />)
    expect(await screen.findByText('The provider did not report quota evidence.')).toBeInTheDocument()
    expect(screen.queryByText('Injected')).not.toBeInTheDocument()
    expect(screen.queryByText('Credits remaining · $999.00')).not.toBeInTheDocument()
    expect(screen.queryByText('Fake')).not.toBeInTheDocument()
  })

  it('keeps manual budget overage and clamped-track behavior', async () => {
    getPlans.mockResolvedValue({
      ...baseStatus,
      plans: {
        cursor: {
          provider: 'cursor', id: 'cursor-pro', spent: 25, budget: 20, percentUsed: 125,
          projectedMonthEnd: 30, status: 'over', periodStart: '2026-07-01', periodEnd: '2026-08-01',
        },
      },
    })
    render(<Plans period="30days" />)
    expect(await screen.findByText('$25.00 · 125% · $5.00 over')).toBeInTheDocument()
    expect(screen.getByTestId('plan-track-cursor').querySelector('i')).toHaveStyle({ width: '100%' })
  })

  it('renders near status as an amber non-exceeding projection when below budget', async () => {
    getPlans.mockResolvedValue({
      ...baseStatus,
      plans: {
        cursor: {
          provider: 'cursor', id: 'cursor-pro', spent: 16, budget: 20, percentUsed: 80,
          projectedMonthEnd: 19, status: 'near', periodStart: '2026-07-01', periodEnd: '2026-08-01',
        },
      },
    })
    render(<Plans period="30days" />)
    expect(await screen.findByText(/80% of budget used/)).toBeInTheDocument()
    expect(screen.getByText(/projected \$19\.00/)).toBeInTheDocument()
  })

  it('falls back to StatusJson.plan when the CLI returns a singular plan summary', async () => {
    getPlans.mockResolvedValue({ ...baseStatus, plan: statusWithPlans.plans!.cursor, plans: {} })
    render(<Plans period="30days" />)
    expect(await screen.findByText('Cursor Pro')).toBeInTheDocument()
  })

  it('omits the budget section when StatusJson has no manual plan summaries', async () => {
    getPlans.mockResolvedValue(baseStatus)
    render(<Plans period="30days" />)
    await screen.findByText('No provider capacity is available.')
    expect(screen.queryByText('Budget plans')).not.toBeInTheDocument()
  })

  it('renders the CLI locate state when getPlans reports not-found', async () => {
    getPlans.mockRejectedValue({ kind: 'not-found', message: 'Metrora CLI not found' })
    render(<Plans period="30days" />)
    expect(await screen.findByText('Metrora CLI not found')).toBeInTheDocument()
  })

  it('does not re-apply the FX rate to CLI-converted plan values (symbol swap only)', async () => {
    getPlans.mockResolvedValue({
      ...baseStatus,
      currency: 'EUR',
      plans: {
        cursor: {
          provider: 'cursor', id: 'cursor-pro', spent: 8.2, budget: 20, percentUsed: 41,
          projectedMonthEnd: 12, status: 'ok', periodStart: '2026-07-01', periodEnd: '2026-08-01',
        },
      },
    })
    render(<Plans period="30days" />)
    expect(await screen.findByText('€8.20 · 41%')).toBeInTheDocument()
    expect(screen.getByText('€20.00 / month · cursor')).toBeInTheDocument()
  })

  it('forces a quota refresh only when refreshToken changes, not on the steady poll', async () => {
    vi.useFakeTimers()
    try {
      getPlans.mockResolvedValue(baseStatus)
      getQuota.mockResolvedValue([])
      const { rerender } = render(<Plans period="30days" refreshToken={0} />)
      await act(async () => { await Promise.resolve() })
      expect(getQuota).toHaveBeenLastCalledWith(false)
      rerender(<Plans period="30days" refreshToken={1} />)
      await act(async () => { await Promise.resolve() })
      expect(getQuota).toHaveBeenLastCalledWith(true)
      act(() => refreshAll())
      await act(async () => { await Promise.resolve() })
      expect(getQuota).toHaveBeenLastCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders permission-denied CLI failures as the amber Full Disk Access state', async () => {
    getPlans.mockRejectedValue({ kind: 'nonzero', message: 'Operation not permitted while opening a provider log' })
    render(<Plans period="30days" />)
    expect(await screen.findByText('Full Disk Access needed')).toBeInTheDocument()
  })

  it('expands the Connect affordance and forces a keychain refresh from Refresh', async () => {
    getPlans.mockResolvedValue(statusWithPlans)
    getQuota.mockResolvedValue([quota('codex', { connection: 'disconnected', availability: 'unavailable', freshness: 'unavailable', observedAt: null })])
    render(<Plans period="30days" />)

    const connect = await screen.findByRole('button', { name: 'Connect' })
    fireEvent.click(connect)
    expect(screen.getByText('codex login')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await act(async () => { await Promise.resolve() })
    expect(getQuota).toHaveBeenLastCalledWith(true)
  })

  it('renders the honest rate-limited note on a 429 backoff, per provider owner', async () => {
    expect(rateLimitedNote('claude')).toContain('Anthropic')
    expect(rateLimitedNote('codex')).toContain('OpenAI')
    expect(rateLimitedNote('copilot')).toContain('GitHub')
    expect(rateLimitedNote('kimi')).toContain('Moonshot AI')
    expect(rateLimitedNote('antigravity')).toContain('Google')

    getPlans.mockResolvedValue(baseStatus)
    getQuota.mockResolvedValue([
      quota('claude', { connection: 'transientFailure', availability: 'unavailable', freshness: 'unavailable', observedAt: null, rateLimit: { state: 'backoff', retryAt: '2026-07-12T00:05:00.000Z' } }),
      quota('codex', { connection: 'stale', availability: 'unavailable', freshness: 'stale', rateLimit: { state: 'backoff', retryAt: '2026-07-12T00:05:00.000Z' } }),
    ])

    render(<Plans period="30days" />)

    expect(await screen.findByText('Anthropic rate limited the quota endpoint, retrying in a few minutes')).toBeInTheDocument()
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

    expect(await screen.findByText('Credential access is needed. Grant access in the provider or operating-system prompt, then Refresh.')).toBeInTheDocument()
    expect(screen.getByText('locked')).toBeInTheDocument()
  })
})
