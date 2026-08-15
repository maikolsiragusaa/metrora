import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

import type { ShareStatus } from '@/lib/api'

function ConnectionQr({ payload }: { payload: string }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    void QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111214', light: '#ffffff' },
    }).then((value) => {
      if (!cancelled) setSvg(value)
    }).catch(() => {
      if (!cancelled) setSvg('')
    })
    return () => { cancelled = true }
  }, [payload])

  return svg ? (
    <div
      aria-label="Metrora connection QR code"
      className="aspect-square w-full max-w-[180px] rounded-md bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <div className="flex aspect-square w-full max-w-[180px] items-center justify-center rounded-md bg-white text-xs text-black/60">Preparing QR…</div>
  )
}

export function ShareConnectCard({ shareInfo }: { shareInfo?: ShareStatus }) {
  const [copied, setCopied] = useState(false)
  if (!shareInfo?.sharing || !shareInfo.connectPayload) return null
  const payload = shareInfo.connectPayload

  const copy = async () => {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(payload)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-interactive-secondary/40 p-3">
      <p className="text-xs font-semibold text-foreground">Connect phone</p>
      <p className="mt-1 text-[11px] leading-relaxed text-tertiary-foreground">Scan this code in Metrora Android, then compare the six-digit code on both devices.</p>
      <div className="mt-3 flex justify-center">
        <ConnectionQr payload={payload} />
      </div>
      <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-tertiary-foreground">{shareInfo.host}:{shareInfo.port}</p>
      {shareInfo.networkWarning && <p className="mt-2 text-[10px] leading-relaxed text-amber-700">{shareInfo.networkWarning}</p>}
      {shareInfo.addresses.length > 1 && (
        <p className="mt-2 text-[10px] leading-relaxed text-tertiary-foreground">Other LAN addresses: {shareInfo.addresses.slice(1).join(', ')}</p>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-2 min-h-9 w-full rounded-md border border-border px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-card"
      >
        {copied ? 'Copied connection payload' : 'Copy connection payload'}
      </button>
    </div>
  )
}
