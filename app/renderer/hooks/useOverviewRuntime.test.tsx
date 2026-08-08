// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import type { Polled } from './usePolled'
import { detectedProvidersFromOverview, useOverviewRuntime } from './useOverviewRuntime'

const mocks = vi.hoisted(() => ({
  clearPolledMemo: vi.fn(),
  getOverview: vi.fn(),
  refresh: vi.fn(),
  setActiveCurrency: vi.fn(),
  usePolled: vi.fn(),
  useProviderPrefetch: vi.fn(),
}))

vi.mock('../lib/format', () => ({
  setActiveCurrency: mocks.setActiveCurrency,
}))

vi.mock('../lib/ipc', () => ({
  metrora: {
    getOverview: mocks.getOverview,
  },
}))

vi.mock('./useDesktopScope', () => ({
  providerName: (id: string) => id === 'codex' ? 'Codex' : id,
}))

vi.mock('./usePolled', () => ({
  clearPolledMemo: mocks.clearPolledMemo,
  usePolled: mocks.usePolled,
}))

vi.mock('./useProviderPrefetch', () => ({
  overviewMemoKey: (provider: string, period: string, range: { from: string; to: string } | null, config: string | null) =>
    `overview|${provider}|${period}|${range?.from ?? ''}-${range?.to ?? ''}|${config ?? ''}`,
  useProviderPrefetch: mocks.useProviderPrefetch,
}))

const emptyPayload = {
  current: {
    providerDetails: [],
    providers: {},
  },
} as unknown as MenubarPayload

let polled: Polled<MenubarPayload>
let capturedFetcher: (() => Promise<MenubarPayload>) | undefined
let capturedOptions: { memoKey?: string } | undefined

function runtimeOptions(overrides: Partial<Parameters<typeof useOverviewRuntime>[0]> = {}) {
  return {
    period: '30days' as const,
    provider: 'all',
    customRange: null,
    scopedClaudeConfigSource: null,
    detectedProviders: [],
    setDetectedProviders: vi.fn(),
    ...overrides,
  }
}

describe('useOverviewRuntime', () => {
  beforeEach(() => {
    mocks.clearPolledMemo.mockReset()
    mocks.getOverview.mockReset().mockResolvedValue(emptyPayload)
    mocks.refresh.mockReset()
    mocks.setActiveCurrency.mockReset()
    mocks.useProviderPrefetch.mockReset()
    capturedFetcher = undefined
    capturedOptions = undefined
    polled = {
      data: null,
      error: null,
      loading: true,
      switching: false,
      lastSuccessAt: null,
      refresh: mocks.refresh,
    }
    mocks.usePolled.mockReset().mockImplementation((fetcher, _deps, options) => {
      capturedFetcher = fetcher
      capturedOptions = options
      return polled
    })
  })

  it('preserves Overview bridge call shapes and memo-key authority', async () => {
    const { rerender } = renderHook(
      (options: ReturnType<typeof runtimeOptions>) => useOverviewRuntime(options),
      { initialProps: runtimeOptions() },
    )

    await capturedFetcher?.()
    expect(mocks.getOverview).toHaveBeenLastCalledWith('30days', 'all')
    expect(capturedOptions?.memoKey).toBe('overview|all|30days|-|')

    rerender(runtimeOptions({ customRange: { from: '2026-08-01', to: '2026-08-03' } }))
    await capturedFetcher?.()
    expect(mocks.getOverview).toHaveBeenLastCalledWith(
      '30days',
      'all',
      { from: '2026-08-01', to: '2026-08-03' },
    )

    rerender(runtimeOptions({ scopedClaudeConfigSource: 'claude-config:work' }))
    await capturedFetcher?.()
    expect(mocks.getOverview).toHaveBeenLastCalledWith(
      '30days',
      'all',
      undefined,
      'claude-config:work',
    )
  })

  it('latches readiness after the first resolved data or error', async () => {
    const { result, rerender } = renderHook(
      (options: ReturnType<typeof runtimeOptions>) => useOverviewRuntime(options),
      { initialProps: runtimeOptions() },
    )
    expect(result.current.ready).toBe(false)

    polled = { ...polled, data: emptyPayload, loading: false }
    rerender(runtimeOptions())
    await waitFor(() => expect(result.current.ready).toBe(true))

    polled = { ...polled, data: null, error: null, loading: true }
    rerender(runtimeOptions())
    expect(result.current.ready).toBe(true)
  })

  it('owns provider discovery, accepted currency and prefetch inputs', async () => {
    const payload = {
      current: {
        providerDetails: [
          { id: 'codex', label: 'Codex', cost: 2 },
          { id: 'claude', label: 'Claude', cost: 5 },
        ],
        providers: {},
      },
      currency: { code: 'EUR', rate: 0.92, symbol: '€' },
    } as unknown as MenubarPayload
    polled = { ...polled, data: payload, loading: false }

    const { result } = renderHook(() => {
      const [detectedProviders, setDetectedProviders] = useState<Array<{ id: string; label: string }>>([])
      const runtime = useOverviewRuntime(runtimeOptions({ detectedProviders, setDetectedProviders }))
      return { detectedProviders, runtime }
    })

    await waitFor(() => expect(result.current.detectedProviders).toEqual([
      { id: 'claude', label: 'Claude' },
      { id: 'codex', label: 'Codex' },
    ]))
    expect(mocks.setActiveCurrency).toHaveBeenCalledWith({ code: 'EUR', rate: 0.92, symbol: '€' })
    expect(mocks.useProviderPrefetch).toHaveBeenLastCalledWith(expect.objectContaining({
      ready: true,
      hasOverviewData: true,
      overviewLoading: false,
      detectedProviders: result.current.detectedProviders,
    }))
  })

  it('does not accept currency from a memo-served switching payload', () => {
    polled = {
      ...polled,
      data: {
        ...emptyPayload,
        currency: { code: 'USD', rate: 1, symbol: '$' },
      } as MenubarPayload,
      switching: true,
    }

    renderHook(() => useOverviewRuntime(runtimeOptions()))
    expect(mocks.setActiveCurrency).not.toHaveBeenCalled()
  })

  it('refreshes every visible section and invalidates stale memo after config changes', () => {
    const { result } = renderHook(() => useOverviewRuntime(runtimeOptions()))

    act(() => result.current.refreshVisible())
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(result.current.refreshToken).toBe(1)

    act(() => result.current.onConfigMutated())
    expect(mocks.clearPolledMemo).toHaveBeenCalledOnce()
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(result.current.refreshToken).toBe(2)
  })
})

describe('detectedProvidersFromOverview', () => {
  it('preserves legacy provider fallback rules and cost ordering', () => {
    const payload = {
      current: {
        providers: {
          'grok build': 9,
          codex: 4,
          claude: 7,
        },
      },
    } as unknown as MenubarPayload

    expect(detectedProvidersFromOverview(payload)).toEqual([
      { id: 'claude', label: 'claude' },
      { id: 'codex', label: 'Codex' },
    ])
  })
})
