// @vitest-environment jsdom
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { ApprovePairingResult, ShareStatus } from '../lib/types'
import { PAIRING_STEP_TOTAL, pairingStepNumber, usePairingStage } from './companionPairingStage'

const bridge = vi.hoisted(() => ({
  approvePairing: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  metrora: bridge,
  normalizeCliError: (error: unknown) => ({
    kind: 'nonzero',
    message: error instanceof Error ? error.message : String(error),
  }),
}))

function shareStatus(overrides: Partial<ShareStatus> = {}): ShareStatus {
  return {
    sharing: false,
    name: 'Metrora Desktop',
    port: 7777,
    host: '192.168.1.10',
    addresses: ['192.168.1.10'],
    connectPayload: null,
    always: false,
    peers: 0,
    pending: [],
    ...overrides,
  }
}

function polled(data: ShareStatus | null): Polled<ShareStatus> {
  return { data, error: null, loading: !data, switching: false, lastSuccessAt: data ? 1 : null, refresh: () => {}, refreshFresh: () => {} }
}

function approval(status: ShareStatus, outcome: ApprovePairingResult['outcome']): ApprovePairingResult {
  return { status, outcome }
}

describe('usePairingStage', () => {
  beforeEach(() => {
    bridge.approvePairing.mockReset()
  })

  it('maps the three dialog steps to the real pairing phases', () => {
    expect(PAIRING_STEP_TOTAL).toBe(3)
    expect(pairingStepNumber({ kind: 'scan' })).toBe(1)
    expect(pairingStepNumber({ kind: 'verify', id: 'p', name: 'n', code: 'c' })).toBe(2)
    expect(pairingStepNumber({ kind: 'complete', name: 'n' })).toBe(3)
    expect(pairingStepNumber({ kind: 'ended', reason: 'expired' })).toBeNull()
  })

  it('stays in scan while waiting for the service or the first status', () => {
    const { result, rerender } = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(null) },
    })
    expect(result.current.stage).toEqual({ kind: 'scan' })

    // A stale pre-start status (sharing off) must not read as "service stopped".
    rerender({ status: polled(shareStatus({ sharing: false })) })
    expect(result.current.stage).toEqual({ kind: 'scan' })
  })

  it('promotes a pending request to verify with the real device identity', async () => {
    const { result, rerender } = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(shareStatus({ sharing: true, connectPayload: 'metrora://x' })) },
    })
    await waitFor(() => expect(result.current.stage).toEqual({ kind: 'scan' }))

    rerender({ status: polled(shareStatus({
      sharing: true,
      connectPayload: 'metrora://x',
      pending: [{ id: 'pair-1', name: 'Pixel 8', code: '482913' }],
    })) })
    await waitFor(() => expect(result.current.stage).toEqual({ kind: 'verify', id: 'pair-1', name: 'Pixel 8', code: '482913' }))
  })

  it('shows success only on a positively confirmed paired outcome', async () => {
    bridge.approvePairing.mockResolvedValue(approval(shareStatus({ sharing: true, pending: [] }), 'paired'))
    const { result, rerender } = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(shareStatus({
        sharing: true,
        connectPayload: 'metrora://x',
        pending: [{ id: 'pair-2', name: 'Pixel 8', code: '112233' }],
      })) },
    })
    await waitFor(() => expect(result.current.stage.kind).toBe('verify'))

    await act(() => result.current.approve({ id: 'pair-2', name: 'Pixel 8', code: '112233' }))
    expect(bridge.approvePairing).toHaveBeenCalledWith('pair-2', true)
    expect(result.current.stage).toEqual({ kind: 'complete', name: 'Pixel 8' })
  })

  it('freezes the verify stage while an approval is in flight', async () => {
    let resolveApproval!: (value: ApprovePairingResult) => void
    bridge.approvePairing.mockImplementation(() => new Promise(resolve => { resolveApproval = resolve }))
    const { result, rerender } = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(shareStatus({
        sharing: true,
        connectPayload: 'metrora://x',
        pending: [{ id: 'pair-7', name: 'Pixel 8', code: '112233' }],
      })) },
    })
    await waitFor(() => expect(result.current.stage.kind).toBe('verify'))

    // The approval is in flight: a poll that no longer lists the request
    // must not promote or expire the stage on its own. Start the approval
    // without awaiting its completion (it suspends on the bridge promise).
    let approvePromise!: Promise<void>
    await act(async () => {
      approvePromise = result.current.approve({ id: 'pair-7', name: 'Pixel 8', code: '112233' })
      await Promise.resolve()
    })
    act(() => {
      rerender({ status: polled(shareStatus({ sharing: true, connectPayload: 'metrora://x' })) })
    })
    expect(result.current.stage.kind).toBe('verify')
    expect(result.current.busy).toBe(true)

    await act(async () => {
      resolveApproval(approval(shareStatus({ sharing: true, pending: [] }), 'paired'))
      await approvePromise
    })
    expect(result.current.stage).toEqual({ kind: 'complete', name: 'Pixel 8' })
  })

  it('ends expired when the request vanished before the approval click', async () => {
    bridge.approvePairing.mockResolvedValue(approval(shareStatus({ sharing: true, pending: [] }), 'expired'))
    const { result } = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(shareStatus({
        sharing: true,
        connectPayload: 'metrora://x',
        pending: [{ id: 'pair-8', name: 'Pixel 8', code: '112233' }],
      })) },
    })
    await waitFor(() => expect(result.current.stage.kind).toBe('verify'))

    await act(() => result.current.approve({ id: 'pair-8', name: 'Pixel 8', code: '112233' }))
    expect(result.current.stage).toEqual({ kind: 'ended', reason: 'expired' })
    expect(result.current.actionError).toBeNull()
  })

  it('ends in error when persistence rolls back or the outcome is unknown', async () => {
    for (const outcome of ['persist-failed', 'unknown'] as const) {
      bridge.approvePairing.mockResolvedValue(approval(shareStatus({ sharing: true, pending: [] }), outcome))
      const { result } = renderHook(({ status }) => usePairingStage(status, async () => true), {
        initialProps: { status: polled(shareStatus({
          sharing: true,
          connectPayload: 'metrora://x',
          pending: [{ id: `pair-${outcome}`, name: 'Pixel 8', code: '112233' }],
        })) },
      })
      await waitFor(() => expect(result.current.stage.kind).toBe('verify'))

      await act(() => result.current.approve({ id: `pair-${outcome}`, name: 'Pixel 8', code: '112233' }))
      expect(result.current.stage.kind).toBe('ended')
      expect(result.current.stage).toMatchObject({ kind: 'ended', reason: 'error' })
      expect(screen.queryByText('Device paired')).not.toBeInTheDocument()
    }
  })

  it('declines through the bridge and returns to scan', async () => {
    bridge.approvePairing.mockResolvedValue(approval(shareStatus({ sharing: true, pending: [] }), 'declined'))
    const { result } = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(shareStatus({
        sharing: true,
        connectPayload: 'metrora://x',
        pending: [{ id: 'pair-4', name: 'Pixel 8', code: '998877' }],
      })) },
    })
    await waitFor(() => expect(result.current.stage.kind).toBe('verify'))

    await act(() => result.current.decline('pair-4'))
    expect(bridge.approvePairing).toHaveBeenCalledWith('pair-4', false)
    expect(result.current.stage).toEqual({ kind: 'scan' })
  })

  it('marks a vanished pending request as expired and recovers by scanning again', async () => {
    const onStart = vi.fn(async () => true)
    const { result, rerender } = renderHook(({ status }) => usePairingStage(status, onStart), {
      initialProps: { status: polled(shareStatus({
        sharing: true,
        connectPayload: 'metrora://x',
        pending: [{ id: 'pair-5', name: 'Pixel 8', code: '123321' }],
      })) },
    })
    await waitFor(() => expect(result.current.stage.kind).toBe('verify'))

    rerender({ status: polled(shareStatus({ sharing: true, connectPayload: 'metrora://x' })) })
    await waitFor(() => expect(result.current.stage).toEqual({ kind: 'ended', reason: 'expired' }))

    await act(async () => { await result.current.retry() })
    expect(onStart).not.toHaveBeenCalled()
    expect(result.current.stage).toEqual({ kind: 'scan' })
  })

  it('ends honestly when the service stops and restarts through the real action', async () => {
    const onStart = vi.fn(async () => true)
    const { result, rerender } = renderHook(({ status }) => usePairingStage(status, onStart), {
      initialProps: { status: polled(shareStatus({ sharing: true, connectPayload: 'metrora://x' })) },
    })
    await waitFor(() => expect(result.current.stage).toEqual({ kind: 'scan' }))

    rerender({ status: polled(shareStatus({ sharing: false })) })
    await waitFor(() => expect(result.current.stage).toEqual({ kind: 'ended', reason: 'service-off' }))

    await act(async () => { await result.current.retry() })
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(result.current.stage).toEqual({ kind: 'scan' })
  })

  it('surfaces a failed restart instead of waiting forever', async () => {
    const onStart = vi.fn(async () => false)
    const { result, rerender } = renderHook(({ status }) => usePairingStage(status, onStart), {
      initialProps: { status: polled(shareStatus({ sharing: true, connectPayload: 'metrora://x' })) },
    })
    await waitFor(() => expect(result.current.stage).toEqual({ kind: 'scan' }))

    rerender({ status: polled(shareStatus({ sharing: false })) })
    await waitFor(() => expect(result.current.stage).toEqual({ kind: 'ended', reason: 'service-off' }))

    await act(async () => { await result.current.retry() })
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(result.current.stage).toEqual({ kind: 'ended', reason: 'error', detail: 'The local pairing service did not start. Nothing changed on your paired devices.' })
  })

  it('keeps the verify stage and reports the error when approval fails', async () => {
    bridge.approvePairing.mockRejectedValue(new Error('approval failed'))
    const { result } = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(shareStatus({
        sharing: true,
        connectPayload: 'metrora://x',
        pending: [{ id: 'pair-6', name: 'Pixel 8', code: '554433' }],
      })) },
    })
    await waitFor(() => expect(result.current.stage.kind).toBe('verify'))

    await act(() => result.current.approve({ id: 'pair-6', name: 'Pixel 8', code: '554433' }))
    expect(result.current.stage.kind).toBe('verify')
    expect(result.current.actionError).toBe('approval failed')
  })
})
