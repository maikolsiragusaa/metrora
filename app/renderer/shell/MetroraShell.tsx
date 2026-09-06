import { useEffect, useRef, useState, type ReactNode } from 'react'

import { readStorage } from '../lib/storage'

type WindowChromeMode = 'always' | 'auto'

function storedWindowChromeMode(): WindowChromeMode {
  return readStorage('windowControlsMode') === 'auto' ? 'auto' : 'always'
}

/** The single renderer frame. Navigation and product state remain outside this shell. */
export function MetroraShell({
  sidebar,
  children,
  className,
}: {
  sidebar: ReactNode
  children: ReactNode
  className?: string
}) {
  const [windowChromeMode, setWindowChromeMode] = useState<WindowChromeMode>(storedWindowChromeMode)
  const [windowChromeRevealed, setWindowChromeRevealed] = useState(() => storedWindowChromeMode() === 'always')
  const nativeChromeMode = useRef<WindowChromeMode | null>(null)

  useEffect(() => {
    const onModeChange = (event: Event) => {
      const next = (event as CustomEvent<WindowChromeMode>).detail
      if (next === 'always' || next === 'auto') setWindowChromeMode(next)
    }
    window.addEventListener('metrora:window-chrome-mode-change', onModeChange)
    return () => window.removeEventListener('metrora:window-chrome-mode-change', onModeChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const bridge = (window as unknown as {
      metrora?: { setWindowChromeMode?: (mode: WindowChromeMode) => Promise<boolean> }
    }).metrora
    const syncNativeChrome = (mode: WindowChromeMode) => {
      if (nativeChromeMode.current === mode) return
      nativeChromeMode.current = mode
      if (bridge?.setWindowChromeMode) void bridge.setWindowChromeMode(mode).catch(() => {})
    }

    root.dataset.windowChromeMode = windowChromeMode
    if (windowChromeMode === 'always') {
      setWindowChromeRevealed(true)
      syncNativeChrome('always')
      return
    }

    setWindowChromeRevealed(false)
    syncNativeChrome('auto')
    const hide = () => {
      setWindowChromeRevealed(false)
      syncNativeChrome('auto')
    }
    const onPointerMove = (event: PointerEvent) => {
      // Keep the reveal target generous enough for a real Windows pointer at
      // 125%/150% scaling while avoiding accidental reveals during normal use.
      if (event.clientY <= 48) {
        setWindowChromeRevealed(true)
        syncNativeChrome('always')
      } else if (event.clientY > 64) {
        hide()
      }
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', hide)
    }
  }, [windowChromeMode])

  return (
    <div className="metrora-window-frame">
      <div
        className={['metrora-window-titlebar', windowChromeRevealed ? 'is-revealed' : ''].filter(Boolean).join(' ')}
        aria-label="Metrora window title bar"
        data-window-chrome-mode={windowChromeMode}
        data-window-chrome-revealed={windowChromeRevealed ? 'true' : 'false'}
      />
      <div className={['metrora-shell', className].filter(Boolean).join(' ')} data-metrora-shell="true">
        {sidebar}
        <main className="metrora-shell__main">{children}</main>
      </div>
    </div>
  )
}
