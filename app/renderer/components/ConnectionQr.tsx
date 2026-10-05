import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** Renders the live connection payload as an inline QR SVG. The payload always
 *  comes from the local share runtime; nothing here fabricates connection data. */
export function ConnectionQr({ payload, level = 'M' }: { payload: string; level?: 'M' | 'H' }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    void QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: level,
      color: { dark: '#111214', light: '#ffffff' },
    }).then(value => {
      if (!cancelled) setSvg(value)
    }).catch(() => {
      if (!cancelled) setSvg('')
    })
    return () => { cancelled = true }
  }, [payload, level])

  return svg ? (
    <div
      aria-label="Metrora connection QR code"
      className="set-share-qr"
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : <div className="set-share-qr set-share-qr-loading" role="status">Preparing QR…</div>
}
