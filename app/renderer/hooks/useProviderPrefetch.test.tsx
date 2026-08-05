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
  codeburn: {
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

  it('warms each inactive provider once with background priority', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof props>) => useProviderPrefetch(current),
      { initialProps: props() },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })

    expect(mocks.getOverview.mock.calls).toEqual([
      ['30days', 'claude', undefined, undefined, true],
      ['30days', 'codex', undefined, undefined, true],
    ])
    expect(hasPolledMemo(overviewMemoKey('claude', '30days', null, null))).toBe(true)
    expect(hasPolledMemo(overviewMemoKey('codex', '30days', null, null))).toBe(true)

    rerender(props({ hasOverviewData: false }))
    rerender(props())
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(mocks.getOverview).toHaveBeenCalledTimes(2)
  })

  it('does not warm custom-range or config-scoped views', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof props>) => useProviderPrefetch(current),
      { initialProps: props({ customRange: { from: '2026-08-01', to: '2026-08-03' } }) },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(mocks.getOverview).not.toHaveBeenCalled()

    rerender(props({ scopedClaudeConfigSource: 'claude-config:default' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(mocks.getOverview).not.toHaveBeenCalled()
  })

  it('holds background warming while the visible overview is busy', async () => {
    const { rerender } = renderHook(
      (current: ReturnType<typeof props>) => useProviderPrefetch(current),
      { initialProps: props({ overviewLoading: true, detectedProviders: [providers[0]!] }) },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(mocks.getOverview).not.toHaveBeenCalled()

    rerender(props({ overviewLoading: false, detectedProviders: [providers[0]!] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(mocks.getOverview).toHaveBeenCalledOnce()
    expect(mocks.getOverview).toHaveBeenCalledWith('30days', 'claude', undefined, undefined, true)
  })

  it('cancels the remaining warm sequence after unmount', async () => {
    let resolveFirst: ((value: MenubarPayload) => void) | undefined
    mocks.getOverview.mockImplementationOnce(() => new Promise<MenubarPayload>(resolve => { resolveFirst = resolve }))

    const { unmount } = renderHook(() => useProviderPrefetch(props()))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    expect(mocks.getOverview).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      resolveFirst?.(payload)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(8_000)
    })

    expect(mocks.getOverview).toHaveBeenCalledTimes(1)
    expect(hasPolledMemo(overviewMemoKey('claude', '30days', null, null))).toBe(false)
  })
})
