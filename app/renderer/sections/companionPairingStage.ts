import { useEffect, useRef, useState } from 'react'

import { normalizeCliError, metrora } from '../lib/ipc'
import type { Polled } from '../hooks/usePolled'
import type { PendingPairing, ShareStatus } from '../lib/types'

/**
 * Stage machine for the v002 pairing dialog, driven by the polled
 * ShareStatus bridge plus the positively confirmed outcome of each approval.
 * The three stages map to the real pairing phases (scan → verify → paired)
 * with no artificial steps. Success renders ONLY on a `paired` outcome for
 * the specific request id — a vanished pending entry is never completion
 * evidence (it also vanishes on expiry, decline, or a failed save). This
 * module owns no protocol logic of its own.
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
  const busyRef = useRef(false)
  // "Pairing is not active" is only meaningful once the dialog has actually
  // seen the service running — otherwise a freshly opened dialog could misread
  // a stale pre-start poll as a stopped service.
  const seenSharingRef = useRef(false)

  useEffect(() => {
    if (!share) return
    if (share.sharing) seenSharingRef.current = true
    // While an approval is in flight the runtime answer (not the next poll)
    // owns the stage: a poll landing mid-approval must not promote, expire,
    // or otherwise move the verify stage on its own.
    if (busyRef.current) return
    setStage(current => {
      if (current.kind === 'complete' || current.kind === 'ended') return current
      if (current.kind === 'verify') {
        if (share.pending.some(pairing => pairing.id === current.id)) return current
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
    busyRef.current = true
    setActionError(null)
    try {
      const { outcome } = await metrora.approvePairing(pairing.id, true)
      shareStatus.refresh()
      // Only a positively confirmed `paired` outcome for THIS request id
      // renders success. Every other terminal outcome moves to an explicit
      // end state instead of trusting the pending list.
      if (outcome === 'paired') {
        setStage({ kind: 'complete', name: pairing.name })
      } else if (outcome === 'expired') {
        setStage({ kind: 'ended', reason: 'expired' })
      } else {
        setStage({
          kind: 'ended',
          reason: 'error',
          detail: outcome === 'persist-failed'
            ? 'The device approved pairing, but saving it failed and nothing was paired. Scan the QR code again to retry.'
            : 'The pairing outcome is unknown. Nothing was confirmed paired. Scan the QR code again to retry.',
        })
      }
    } catch (error) {
      setActionError(normalizeCliError(error).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const decline = async (id: string) => {
    if (busy) return
    setBusy(true)
    busyRef.current = true
    setActionError(null)
    try {
      await metrora.approvePairing(id, false)
      shareStatus.refresh()
      setStage({ kind: 'scan' })
    } catch (error) {
      setActionError(normalizeCliError(error).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const retry = async () => {
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
