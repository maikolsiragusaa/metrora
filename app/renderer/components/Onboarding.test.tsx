// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload, QuotaProvider, ShareStatus } from '../lib/types'

const bridge = vi.hoisted(() => ({
  getOverview: vi.fn<(period: string, provider: string) => Promise<MenubarPayload>>(),
  getQuota: vi.fn<() => Promise<QuotaProvider[]>>(),
  cliStatus: vi.fn<() => Promise<{ found: boolean; path: string | null }>>(),
  getShareStatus: vi.fn<() => Promise<ShareStatus>>(),
  startShare: vi.fn<(always?: boolean) => Promise<ShareStatus>>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
}))

vi.mock('../lib/ipc', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return { ...actual, metrora: bridge }
})

import { Onboarding } from './Onboarding'

function payload(overrides: Partial<MenubarPayload['current']> = {}): MenubarPayload {
  return {
    generated: new Date().toISOString(),
    current: {
      label: 'Today', cost: 0, calls: 0, sessions: 3, oneShotRate: null,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      cacheHitPercent: 0, codexCredits: 0, topActivities: [], topModels: [],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: { codex: 0 },
      providerDetails: [{ id: 'codex', label: 'Codex', cost: 0 }],
      topProjects: [], modelEfficiency: [], topSessions: [],
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [], skills: [], subagents: [], mcpServers: [],
      ...overrides,
    },
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: { daily: [] },
  }
}

function shareStatus(overrides: Partial<ShareStatus> = {}): ShareStatus {
  return {
    sharing: false, name: 'Metrora Desktop', port: 0, host: null, addresses: [],
    connectPayload: null, always: false, peers: 0, pending: [], ...overrides,
  }
}

function overview(data: MenubarPayload | null = payload(), overrides: Partial<Polled<MenubarPayload>> = {}): Polled<MenubarPayload> {
  return {
    data, error: null, loading: false, switching: false, lastSuccessAt: Date.now(),
    refresh: vi.fn(), refreshFresh: vi.fn(), ...overrides,
  }
}

describe('Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches the welcome composition and keeps account actions unavailable', () => {
    const onDone = vi.fn()
    render(<Onboarding overview={overview()} ready onDone={onDone} />)

    expect(screen.getByRole('dialog', { name: 'Welcome to Metrora' })).toBeInTheDocument()
    expect(screen.getByText('Your AI Control Center')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue locally' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Create account/ })).toBeDisabled()
    expect(screen.queryByText('Guest')).not.toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('advances to canonical discovery entries and never invents providers', () => {
    const refreshFresh = vi.fn()
    const data = payload({ providerDetails: [
      { id: 'codex', label: 'Codex', cost: 0 },
      { id: 'claude', label: 'Claude', cost: 0 },
    ] })
    render(<Onboarding overview={overview(data, { refreshFresh })} ready onDone={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue locally' }))

    expect(screen.getByRole('heading', { name: 'We found your AI tools' })).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument()
    expect(screen.queryByText('Ollama')).not.toBeInTheDocument()
    expect(refreshFresh).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Code with freedom.' })).toBeInTheDocument()
  })

  it('uses the lifetime inventory without mutating Home scope or probing Code readiness', () => {
    const home = payload({ providerDetails: [{ id: 'today-only', label: 'Today only', cost: 0 }] })
    const lifetime = payload({ providerDetails: [{ id: 'lifetime-source', label: 'Lifetime source', cost: 0 }] })
    const refreshFresh = vi.fn()
    render(<Onboarding overview={overview(home, { refreshFresh })} inventory={overview(lifetime)} ready onDone={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue locally' }))

    expect(screen.getByText('Lifetime source')).toBeInTheDocument()
    expect(screen.queryByText('Today only')).not.toBeInTheDocument()
    expect(refreshFresh).not.toHaveBeenCalled()
    expect(bridge.cliStatus).not.toHaveBeenCalled()
  })

  it('densifies a large canonical source list instead of creating a tall scrollable card', () => {
    const details = Array.from({ length: 12 }, (_, index) => ({
      id: `provider-${index}`,
      label: `Provider ${index}`,
      cost: 12 - index,
    }))
    const data = payload({
      providers: Object.fromEntries(details.map(entry => [entry.id, entry.cost])),
      providerDetails: details,
    })
    render(<Onboarding overview={overview(data)} ready onDone={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue locally' }))

    expect(document.querySelector('.onboarding-source-grid-many')).toBeInTheDocument()
    expect(screen.getAllByText('Local source')).toHaveLength(12)
  })

  it('shows truthful empty and partial discovery states', () => {
    const empty = payload({ providerDetails: [], providers: {} })
    const { rerender } = render(<Onboarding overview={overview(empty)} ready onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue locally' }))
    expect(screen.getByText('No local sources detected')).toBeInTheDocument()

    rerender(<Onboarding overview={overview(payload(), { error: { kind: 'timeout', message: 'timeout' } })} ready onDone={() => {}} />)
    expect(screen.getByText(/last local snapshot is available/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('uses the existing pairing authority and keeps the companion optional', async () => {
    const initial = shareStatus()
    const started = shareStatus({ sharing: true, host: '192.168.1.10', port: 4317, connectPayload: 'metrora://connect?host=192.168.1.10&port=4317' })
    bridge.getShareStatus.mockResolvedValue(initial)
    bridge.startShare.mockResolvedValue(started)
    render(<Onboarding overview={overview()} ready onDone={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue locally' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Take Metrora with you' })).toBeInTheDocument()
    expect(screen.getByText('Pair with Android')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()

    const pair = await screen.findByRole('button', { name: 'Pair now' })
    fireEvent.click(pair)
    await waitFor(() => expect(bridge.startShare).toHaveBeenCalledWith(false))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByText('MTR-7F3K-9D2Q')).not.toBeInTheDocument()
  })

  it('renders ready facts from the snapshot and provider quota authority', async () => {
    bridge.getQuota.mockResolvedValue([])
    const data = {
      ...payload({
        sessions: 5,
      modelAccounting: {
        rows: [{ name: 'gpt', cost: 0, savingsUSD: 0, calls: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokenDetail: false }],
        gap: { cost: 0, savingsUSD: 0, calls: 0 }, coverage: { cost: 0, calls: 1 },
      },
      }),
      projectScope: { selectedId: 'all', options: [], sourceProjects: [{ id: 'one', name: 'one', contributors: [], assignedProjectId: null }], registry: { status: 'valid' as const, writable: true } },
    }
    const onDone = vi.fn()
    render(<Onboarding overview={overview(data)} ready onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue locally' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByRole('heading', { name: 'You’re ready' })).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('No provider-reported quota available')).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText('16 GB')).not.toBeInTheDocument()
    expect(screen.getByText('Code workspace')).toBeInTheDocument()
    expect(screen.queryByText('Code ready')).not.toBeInTheDocument()
    expect(bridge.cliStatus).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open Metrora' }))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
