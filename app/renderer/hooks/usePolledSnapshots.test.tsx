// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { RefreshCadenceContext, type RefreshCadence } from '../lib/refreshCadence'
import { currentReportGeneration, publishReportGeneration } from '../lib/reportGeneration'
import { invalidateDurableSnapshots, readDurableSnapshot } from '../lib/reportSnapshot'
import { __resetPolledMemo, clearPolledMemo, usePolled } from './usePolled'

type Payload = { current: { cost: number }; freshness: { readMode: string; reconciliation: string; durableThrough: string | null } }

function report(cost: number, reconciliation = 'complete'): Payload {
  return { current: { cost }, freshness: { readMode: 'fresh', reconciliation, durableThrough: '2026-09-16' } }
}

function manualWrapper() {
  const value: RefreshCadence = { value: 'x', intervalMs: null, setValue: () => {} }
  return ({ children }: { children: ReactNode }) => createElement(RefreshCadenceContext.Provider, { value }, children)
}

beforeEach(() => {
  localStorage.clear()
  __resetPolledMemo()
})

afterEach(() => {
  localStorage.clear()
  __resetPolledMemo()
})

describe('usePolled durable restart snapshots', () => {
  it('paints a durable complete snapshot instantly without stamping a refresh, then revalidates', async () => {
    localStorage.setItem(
      'metrora.reportSnapshot.v1.scope|all',
      JSON.stringify({ v: 1, at: 1111, generation: 0, fingerprint: '0:0', value: report(7) }),
    )
    const fetcher = vi.fn(() => new Promise<Payload>(() => {}))

    const { result } = renderHook(() => usePolled(fetcher, [], { memoKey: 'scope|all' }), { wrapper: manualWrapper() })

    expect(result.current.data).toMatchObject({ current: { cost: 7 } })
    // A snapshot from an earlier run is painted but never reported as a
    // refresh this process made.
    expect(result.current.lastSuccessAt).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(true)
  })

  it('persists a complete fetch for the next launch but never a degraded one', async () => {
    const resolvers: Array<(v: Payload) => void> = []
    const fetcher = vi.fn(() => new Promise<Payload>(resolve => { resolvers.push(resolve) }))
    const { result, unmount } = renderHook(() => usePolled(fetcher, [], { memoKey: 'persist|all' }), { wrapper: manualWrapper() })

    await act(async () => { resolvers[0]!(report(9)) })
    expect(result.current.data).toMatchObject({ current: { cost: 9 } })
    expect(readDurableSnapshot<Payload>('persist|all')?.value).toMatchObject({ current: { cost: 9 } })
    unmount()

    // A degraded success resolves into the live view but must not overwrite
    // the restart-time exact answer.
    __resetPolledMemo()
    const resolvers2: Array<(v: Payload) => void> = []
    const fetcher2 = vi.fn(() => new Promise<Payload>(resolve => { resolvers2.push(resolve) }))
    const second = renderHook(() => usePolled(fetcher2, [], { memoKey: 'persist|all' }), { wrapper: manualWrapper() })
    expect(second.result.current.data).toMatchObject({ current: { cost: 9 } })
    await act(async () => { resolvers2[0]!(report(3, 'degraded')) })
    // Degraded never displaces the complete answer on screen either.
    expect(second.result.current.data).toMatchObject({ current: { cost: 9 } })
    expect(readDurableSnapshot<Payload>('persist|all')?.value).toMatchObject({ current: { cost: 9 } })
    second.unmount()
  })

  it('replaces a degraded view once the producer converges', async () => {
    const calls: Array<{ resolve: (v: Payload) => void }> = []
    const fetcher = vi.fn(() => new Promise<Payload>(resolve => { calls.push({ resolve }) }))
    const { result } = renderHook(() => usePolled(fetcher, [], { memoKey: 'converge|all' }), { wrapper: manualWrapper() })

    await act(async () => { calls[0]!.resolve(report(3, 'degraded')) })
    expect(result.current.data).toMatchObject({ current: { cost: 3 } })
    act(() => { result.current.refresh() })
    await act(async () => { calls[1]!.resolve(report(11)) })
    expect(result.current.data).toMatchObject({ current: { cost: 11 } })
  })

  it('starts a real new attempt after a failure with no lock left behind', async () => {
    const calls: Array<{ resolve: (v: Payload) => void; reject: (e: unknown) => void }> = []
    const fetcher = vi.fn(() => new Promise<Payload>((resolve, reject) => { calls.push({ resolve, reject }) }))
    const manual = vi.fn(() => new Promise<Payload>((resolve, reject) => { calls.push({ resolve, reject }) }))
    const onManualSuccess = vi.fn()
    const { result } = renderHook(
      () => usePolled(fetcher, [], { manualFetcher: manual, onManualSuccess }),
      { wrapper: manualWrapper() },
    )
    await act(async () => { calls[0]!.resolve(report(1)) })

    act(() => { result.current.refreshFresh() })
    await act(async () => { calls[1]!.reject({ kind: 'timeout', message: 'no progress' }) })
    expect(result.current.error).toMatchObject({ kind: 'timeout' })

    act(() => { result.current.refreshFresh() })
    await act(async () => { calls[2]!.resolve(report(2)) })
    expect(result.current.data).toMatchObject({ current: { cost: 2 } })
    expect(result.current.error).toBeNull()
    expect(onManualSuccess).toHaveBeenCalledTimes(1)
    expect(manual).toHaveBeenCalledTimes(2)
  })

  it('invalidates durable snapshots when accounting config mutates', async () => {
    const resolvers: Array<(v: Payload) => void> = []
    const fetcher = vi.fn(() => new Promise<Payload>(resolve => { resolvers.push(resolve) }))
    const { unmount } = renderHook(() => usePolled(fetcher, [], { memoKey: 'cfg|all' }), { wrapper: manualWrapper() })
    await act(async () => { resolvers[0]!(report(5)) })
    expect(readDurableSnapshot('cfg|all')).toBeDefined()
    unmount()

    clearPolledMemo()
    expect(readDurableSnapshot('cfg|all')).toBeUndefined()
  })

  it('publishes a canonical generation per successful explicit refresh', async () => {
    const calls: Array<{ resolve: (v: Payload) => void }> = []
    const fetcher = vi.fn(() => new Promise<Payload>(resolve => { calls.push({ resolve }) }))
    const manual = vi.fn(() => new Promise<Payload>(resolve => { calls.push({ resolve }) }))
    const onManualSuccess = vi.fn(() => { publishReportGeneration() })
    const { result } = renderHook(
      () => usePolled(fetcher, [], { manualFetcher: manual, onManualSuccess }),
      { wrapper: manualWrapper() },
    )
    await act(async () => { calls[0]!.resolve(report(1)) })
    expect(currentReportGeneration().n).toBe(0)

    act(() => { result.current.refreshFresh() })
    await act(async () => { calls[1]!.resolve(report(2)) })
    expect(currentReportGeneration().n).toBe(1)
    expect(currentReportGeneration().at).toEqual(expect.any(Number))
  })

  it('does not persist section payloads that lack a freshness envelope', async () => {
    const resolvers: Array<(v: Array<{ sessionId: string }>) => void> = []
    const fetcher = vi.fn(() => new Promise<Array<{ sessionId: string }>>(resolve => { resolvers.push(resolve) }))
    renderHook(() => usePolled(fetcher, [], { memoKey: 'sessions|all' }), { wrapper: manualWrapper() })
    await act(async () => { resolvers[0]!([{ sessionId: 's1' }]) })
    expect(readDurableSnapshot('sessions|all')).toBeUndefined()
    expect(localStorage.length).toBe(0)
    invalidateDurableSnapshots()
  })
})
