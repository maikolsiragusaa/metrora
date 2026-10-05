// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { ShareStatus } from '../lib/types'
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

  it('shows success only after the runtime confirms the request is gone', async () => {
    bridge.approvePairing.mockResolvedValue(shareStatus({ sharing: true, pending: [] }))
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

    // The runtime kept the request pending: no success, stay on verify.
    bridge.approvePairing.mockResolvedValue(shareStatus({
      sharing: true,
      pending: [{ id: 'pair-3', name: 'Pixel 9', code: '445566' }],
    }))
    const second = renderHook(({ status }) => usePairingStage(status, async () => true), {
      initialProps: { status: polled(shareStatus({
        sharing: true,
        connectPayload: 'metrora://x',
        pending: [{ id: 'pair-3', name: 'Pixel 9', code: '445566' }],
      })) },
    })
    await waitFor(() => expect(second.result.current.stage.kind).toBe('verify'))
    await act(() => second.result.current.approve({ id: 'pair-3', name: 'Pixel 9', code: '445566' }))
    expect(second.result.current.stage.kind).toBe('verify')
  })

  it('declines through the bridge and returns to scan', async () => {
    bridge.approvePairing.mockResolvedValue(shareStatus({ sharing: true, pending: [] }))
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
