// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload, ModelReportRow, TelemetryStatus } from '../lib/types'
import { useDesktopTelemetry } from './useDesktopTelemetry'

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
  getModels: vi.fn(),
  telemetryStatus: vi.fn(),
  telemetryTrack: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  metrora: {
    completeOnboarding: mocks.completeOnboarding,
    getModels: mocks.getModels,
    telemetryStatus: mocks.telemetryStatus,
    telemetryTrack: mocks.telemetryTrack,
  },
}))

const payload = {
  current: {
    label: 'Last 30 days',
    cost: 24,
    providers: { claude: 20, codex: 4 },
    topModels: [{ name: 'claude-opus', cost: 20 }],
    topActivities: [{ name: 'coding', oneShotRate: 0.625 }],
    mcpServers: [{ name: 'github', calls: 15 }],
    skills: [{ name: 'review', turns: 5 }],
  },
} as unknown as MenubarPayload

function options(overrides: Partial<Parameters<typeof useDesktopTelemetry>[0]> = {}) {
  return {
    overviewData: payload,
    period: '30days' as const,
    provider: 'all',
    customRange: null,
    scopedClaudeConfigSource: null,
    ...overrides,
  }
}

function modelRow(): ModelReportRow {
  return {
    provider: 'claude',
    providerDisplayName: 'Claude',
    model: 'claude-opus-4',
    modelDisplayName: 'claude-opus',
    category: null,
    topCategory: 'coding',
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costUSD: 20,
    savingsUSD: 0,
    savingsBaselineModel: '',
    calls: 1,
    credits: null,
  }
}

describe('useDesktopTelemetry', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-08-04T00:30:00Z'))
    mocks.completeOnboarding.mockReset().mockResolvedValue(undefined)
    mocks.getModels.mockReset().mockResolvedValue([modelRow()])
    mocks.telemetryStatus.mockReset().mockResolvedValue({
      onboarded: true,
      enabled: false,
      defaultEnabled: false,
    } as TelemetryStatus)
    mocks.telemetryTrack.mockReset().mockResolvedValue(undefined)
  })

  it('shows consent only when onboarding is incomplete and persists the choice', async () => {
    const status = {
      onboarded: false,
      enabled: false,
      defaultEnabled: true,
    } as TelemetryStatus
    mocks.telemetryStatus.mockResolvedValue(status)

    const { result } = renderHook(() => useDesktopTelemetry(options({ overviewData: null })))
    await waitFor(() => expect(result.current.onboardingStatus).toEqual(status))

    act(() => result.current.finishOnboarding(true))
    expect(result.current.onboardingStatus).toBeNull()
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(true)
  })

  it('exposes one best-effort event boundary for shell navigation', () => {
    const { result } = renderHook(() => useDesktopTelemetry(options({ overviewData: null })))
    act(() => result.current.trackEvent('section_view', { section: 'models' }))
    expect(mocks.telemetryTrack).toHaveBeenCalledWith('section_view', { section: 'models' })
  })

  it('emits one enriched daily snapshot only from the canonical scope', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof options>) => useDesktopTelemetry(current),
      { initialProps: options() },
    )

    await waitFor(() => expect(mocks.telemetryTrack).toHaveBeenCalledWith(
      'usage_snapshot',
      expect.objectContaining({
        period: 'Last 30 days',
        providerCount: 2,
        costBucket: '10-50',
        models: [{ name: 'claude-opus', costBucket: '10-50', topCategory: 'coding' }],
      }),
    ))
    expect(mocks.getModels).toHaveBeenCalledWith('30days', 'all', false)

    rerender(options({ overviewData: { ...payload } }))
    await Promise.resolve()
    expect(mocks.getModels).toHaveBeenCalledTimes(1)
    expect(mocks.telemetryTrack.mock.calls.filter(([name]) => name === 'usage_snapshot')).toHaveLength(1)
  })

  it('does not build snapshots for provider, range, or config-scoped views', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof options>) => useDesktopTelemetry(current),
      { initialProps: options({ provider: 'claude' }) },
    )
    rerender(options({ customRange: { from: '2026-08-01', to: '2026-08-03' } }))
    rerender(options({ scopedClaudeConfigSource: 'claude-config:work' }))
    await Promise.resolve()

    expect(mocks.getModels).not.toHaveBeenCalled()
    expect(mocks.telemetryTrack).not.toHaveBeenCalledWith('usage_snapshot', expect.anything())
  })

  it('degrades to a valid snapshot when model-category enrichment fails', async () => {
    mocks.getModels.mockRejectedValue(new Error('models unavailable'))
    renderHook(() => useDesktopTelemetry(options()))

    await waitFor(() => expect(mocks.telemetryTrack).toHaveBeenCalledWith(
      'usage_snapshot',
      expect.objectContaining({
        models: [{ name: 'claude-opus', costBucket: '10-50' }],
      }),
    ))
  })
})
