import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

import { normalizeCliError, metrora } from '../lib/ipc'
import type { Polled } from '../hooks/usePolled'
import type { ShareStatus } from '../lib/types'
import { showToast } from '../lib/toast'

function ConnectionQr({ payload }: { payload: string }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    void QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111214', light: '#ffffff' },
    }).then(value => {
      if (!cancelled) setSvg(value)
    }).catch(() => {
      if (!cancelled) setSvg('')
    })
    return () => { cancelled = true }
  }, [payload])

  return svg ? (
    <div
      aria-label="Metrora connection QR code"
      className="set-share-qr"
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : <div className="set-share-qr set-share-qr-loading" role="status">Preparing QR…</div>
}

export function ShareConnectSurface({ shareStatus }: { shareStatus: Polled<ShareStatus> }) {
  const [busy, setBusy] = useState(false)
  const [responding, setResponding] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const data = shareStatus.data

  const toggleSharing = async () => {
    if (!data) return
    setBusy(true)
    try {
      if (data.sharing) await metrora.stopShare()
      else await metrora.startShare(data.always)
      shareStatus.refresh()
    } catch (error) {
      showToast(normalizeCliError(error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyPayload = async () => {
    if (!data?.connectPayload || !navigator.clipboard) {
      showToast('Connection payload could not be copied.', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(data.connectPayload)
      setCopied(true)
      showToast('Connection payload copied.')
      window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      showToast(normalizeCliError(error).message, 'error')
    }
  }

  const respondToPairing = async (id: string, approve: boolean) => {
    if (responding) return
    setResponding(id)
    try {
      await metrora.approvePairing(id, approve)
      shareStatus.refresh()
    } catch (error) {
      showToast(normalizeCliError(error).message, 'error')
    } finally {
      setResponding(null)
    }
  }

  return (
    <div className="set-share-surface" aria-live="polite">
      <div className="set-share-head">
        <div>
          <b className="set-share-title">Connect phone</b>
          <p className="set-cap">Scan this code in Metrora Android, then compare the six-digit code on both devices.</p>
        </div>
        {data && <button className="btnp" disabled={busy} onClick={() => void toggleSharing()}>{busy ? 'Updating…' : data.sharing ? 'Stop sharing' : 'Start sharing'}</button>}
      </div>

      {!data ? (
        <p className="set-cap">Reading sharing status…</p>
      ) : !data.sharing || !data.connectPayload ? (
        <p className="set-cap">Start sharing to show a local connection QR code.</p>
      ) : (
        <>
          <div className="set-share-qr-wrap"><ConnectionQr payload={data.connectPayload} /></div>
          <p className="set-share-address">{data.host ?? 'Local network'}:{data.port}</p>
          {data.networkWarning && <p className="set-share-warning">{data.networkWarning}</p>}
          {data.addresses.length > 1 && <p className="set-cap">Other local addresses: {data.addresses.slice(1).join(', ')}</p>}
          <button className="btnp set-share-copy" onClick={() => void copyPayload()}>{copied ? 'Copied connection payload' : 'Copy connection payload'}</button>
        </>
      )}

      {data?.pending.length ? (
        <div className="set-share-pending">
          <b>Pairing request</b>
          {data.pending.map(pairing => (
            <div className="set-share-pending-row" key={pairing.id}>
              <div className="lx"><b>{pairing.name}</b><span>Compare code <code>{pairing.code}</code> on both devices.</span></div>
              <span className="set-share-actions">
                <button className="btnp btnp-primary" disabled={responding !== null} onClick={() => void respondToPairing(pairing.id, true)}>Approve</button>
                <button className="btnp" disabled={responding !== null} onClick={() => void respondToPairing(pairing.id, false)}>Decline</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
