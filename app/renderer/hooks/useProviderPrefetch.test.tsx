// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { __resetPolledMemo, hasPolledMemo } from './usePolled'
import { overviewMemoKey, useProviderPrefetch } from './useProviderPrefetch'

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  metrora: {
    getOverview: mocks.getOverview,
  },
}))

const providers = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
]

const payload = { current: { providers: {} } } as unknown as MenubarPayload

function props(overrides: Partial<Parameters<typeof useProviderPrefetch>[0]> = {}) {
  return {
    ready: true,
    hasOverviewData: true,
    overviewLoading: false,
    detectedProviders: providers,
    period: '30days' as const,
    provider: 'all',
    customRange: null,
    scopedClaudeConfigSource: null,
    ...overrides,
  }
}

describe('useProviderPrefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getOverview.mockReset()
    mocks.getOverview.mockResolvedValue(payload)
    __resetPolledMemo()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('warms common periods for the active provider before alternative providers', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof props>) => useProviderPrefetch(current),
      { initialProps: props() },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(16_000) })

    expect(mocks.getOverview.mock.calls).toEqual([
      ['today', 'all', undefined, undefined, true],
      ['week', 'all', undefined, undefined, true],
      ['month', 'all', undefined, undefined, true],
      ['all', 'all', undefined, undefined, true],
      ['lifetime', 'all', undefined, undefined, true],
      ['30days', 'claude', undefined, undefined, true],
      ['30days', 'codex', undefined, undefined, true],
    ])
    for (const period of ['today', 'week', 'month', 'all', 'lifetime'] as const) {
      expect(hasPolledMemo(overviewMemoKey('all', period, null, null))).toBe(true)
    }
    expect(hasPolledMemo(overviewMemoKey('claude', '30days', null, null))).toBe(true)
    expect(hasPolledMemo(overviewMemoKey('codex', '30days', null, null))).toBe(true)

    rerender(props({ hasOverviewData: false }))
    rerender(props())
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000) })
    expect(mocks.getOverview).toHaveBeenCalledTimes(7)
  })

  it('does not warm custom-range or config-scoped views', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof props>) => useProviderPrefetch(current),
      { initialProps: props({ customRange: { from: '2026-08-01', to: '2026-08-03' } }) },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(16_000) })
    expect(mocks.getOverview).not.toHaveBeenCalled()

    rerender(props({ scopedClaudeConfigSource: 'claude-config:default' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000) })
    expect(mocks.getOverview).not.toHaveBeenCalled()
  })

  it('holds background warming while the visible overview is busy', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof props>) => useProviderPrefetch(current),
      { initialProps: props({ overviewLoading: true, detectedProviders: [] }) },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(mocks.getOverview).not.toHaveBeenCalled()

    rerender(props({ overviewLoading: false, detectedProviders: [] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(mocks.getOverview).toHaveBeenCalledOnce()
    expect(mocks.getOverview).toHaveBeenCalledWith('today', 'all', undefined, undefined, true)
  })

  it('keeps every warm task serial instead of fanning out concurrent CLI scans', async () => {
    let resolveFirst: ((value: MenubarPayload) => void) | undefined
    mocks.getOverview.mockImplementationOnce(() => new Promise<MenubarPayload>(resolve => { resolveFirst = resolve }))

    renderHook(() => useProviderPrefetch(props({ detectedProviders: [] })))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    // The first background read is still unresolved, so no second period may
    // start regardless of how far timers advance.
    expect(mocks.getOverview).toHaveBeenCalledTimes(1)
    expect(mocks.getOverview).toHaveBeenCalledWith('today', 'all', undefined, undefined, true)

    await act(async () => {
      resolveFirst?.(payload)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(mocks.getOverview).toHaveBeenCalledTimes(2)
    expect(mocks.getOverview).toHaveBeenLastCalledWith('week', 'all', undefined, undefined, true)
  })

  it('cancels the remaining warm sequence after unmount', async () => {
    let resolveFirst: ((value: MenubarPayload) => void) | undefined
    mocks.getOverview.mockImplementationOnce(() => new Promise<MenubarPayload>(resolve => { resolveFirst = resolve }))

    const { unmount } = renderHook(() => useProviderPrefetch(props()))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_800) })
    expect(mocks.getOverview).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      resolveFirst?.(payload)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(16_000)
    })

    expect(mocks.getOverview).toHaveBeenCalledTimes(1)
    expect(hasPolledMemo(overviewMemoKey('all', 'today', null, null))).toBe(false)
  })
})
