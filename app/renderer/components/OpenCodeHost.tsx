import { useLayoutEffect, useRef, useState } from 'react'

import { metrora } from '../lib/ipc'
import type { OpenCodeViewBounds } from '../lib/metrora-bridge-types'

function readBounds(element: HTMLDivElement): OpenCodeViewBounds | null {
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width < 1 || rect.height < 1) return null
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

/** Empty renderer host only: the actual Code surface is a main-process View. */
export function OpenCodeHost() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [unavailable, setUnavailable] = useState(false)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    let active = true
    const bounds = () => {
      const value = readBounds(host)
      if (value) void metrora.opencodeUpdateBounds(value).catch(() => {})
    }

    const activate = async () => {
      const value = readBounds(host)
      if (!value) return
      try {
        const status = await metrora.opencodeActivate(value)
        if (active && status.state !== 'ready') setUnavailable(true)
      } catch {
        if (active) setUnavailable(true)
      }
    }
    void activate()

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bounds)
    observer?.observe(host)
    window.addEventListener('resize', bounds)
    return () => {
      active = false
      observer?.disconnect()
      window.removeEventListener('resize', bounds)
      void metrora.opencodeDeactivate().catch(() => {})
    }
  }, [])

  return (
    <div ref={hostRef} className="code-view-host" data-testid="opencode-web-contents-host" aria-label="OpenCode upstream surface">
      {unavailable ? <div className="code-view-unavailable" role="alert">Code is unavailable on this device.</div> : null}
    </div>
  )
}
