import { useEffect, useRef, useState } from 'react'

import { normalizeCliError, metrora } from '../lib/ipc'
import type { Polled } from '../hooks/usePolled'
import type { PendingPairing, ShareStatus } from '../lib/types'

/**
 * Stage machine for the v002 pairing dialog, driven entirely by the polled
 * ShareStatus bridge. The three stages map to the real pairing phases
 * (scan → verify → paired); success is shown only after the runtime confirms
 * the pending request is gone. This module owns no protocol logic of its own.
 */
export type PairingStage =
  | { kind: 'scan' }
  | { kind: 'verify'; id: string; name: string; code: string }
  | { kind: 'complete'; name: string }
  | { kind: 'ended'; reason: 'service-off' | 'expired' | 'error'; detail?: string }

export const PAIRING_STEP_TOTAL = 3

export function pairingStepNumber(stage: PairingStage): number | null {
  if (stage.kind === 'scan') return 1
  if (stage.kind === 'verify') return 2
  if (stage.kind === 'complete') return 3
  return null
}

export function usePairingStage(shareStatus: Polled<ShareStatus>, onStart: () => Promise<boolean>): {
  stage: PairingStage
  busy: boolean
  actionError: string | null
  approve: (pairing: PendingPairing) => Promise<void>
  decline: (id: string) => Promise<void>
  retry: () => Promise<void>
} {
  const share = shareStatus.data
  const [stage, setStage] = useState<PairingStage>({ kind: 'scan' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const approvedRef = useRef<{ id: string; name: string } | null>(null)
  // "Pairing is not active" is only meaningful once the dialog has actually
  // seen the service running — otherwise a freshly opened dialog could misread
  // a stale pre-start poll as a stopped service.
  const seenSharingRef = useRef(false)

  useEffect(() => {
    if (!share) return
    if (share.sharing) seenSharingRef.current = true
    setStage(current => {
      if (current.kind === 'complete' || current.kind === 'ended') return current
      if (current.kind === 'verify') {
        if (share.pending.some(pairing => pairing.id === current.id)) return current
        if (approvedRef.current?.id === current.id) {
          return { kind: 'complete', name: approvedRef.current.name }
        }
        const next = share.pending[0]
        if (next) return { kind: 'verify', id: next.id, name: next.name, code: next.code }
        return { kind: 'ended', reason: 'expired' }
      }
      const next = share.pending[0]
      if (next) return { kind: 'verify', id: next.id, name: next.name, code: next.code }
      if (!share.sharing && seenSharingRef.current) return { kind: 'ended', reason: 'service-off' }
      return current
    })
  }, [share])

  const approve = async (pairing: PendingPairing) => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    approvedRef.current = { id: pairing.id, name: pairing.name }
    try {
      const status = await metrora.approvePairing(pairing.id, true)
      shareStatus.refresh()
      if (!status.pending.some(entry => entry.id === pairing.id)) {
        setStage({ kind: 'complete', name: pairing.name })
      } else {
        // The runtime kept the request pending; stay on verify and let the
        // poll resolve the stage. Never show success without confirmation.
        approvedRef.current = null
      }
    } catch (error) {
      approvedRef.current = null
      setActionError(normalizeCliError(error).message)
    } finally {
      setBusy(false)
    }
  }

  const decline = async (id: string) => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await metrora.approvePairing(id, false)
      shareStatus.refresh()
      approvedRef.current = null
      setStage({ kind: 'scan' })
    } catch (error) {
      setActionError(normalizeCliError(error).message)
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    approvedRef.current = null
    setActionError(null)
    if (!share?.sharing) {
      const started = await onStart()
      if (!started) {
        setStage({ kind: 'ended', reason: 'error', detail: 'The local pairing service did not start. Nothing changed on your paired devices.' })
        return
      }
    }
    setStage({ kind: 'scan' })
  }

  return { stage, busy, actionError, approve, decline, retry }
}
