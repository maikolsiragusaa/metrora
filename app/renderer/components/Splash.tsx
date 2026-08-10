import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ProviderLogo } from './ProviderLogo'
import { MetroraMark } from './MetroraMark'
import { motionClass, reducedMotion } from '../lib/motion'
import { metrora } from '../lib/ipc'
import type { ScanProgressEvent } from '../lib/types'
import { version } from '../../package.json'

const MIN_ON_SCREEN_MS = 600
const CROSSFADE_MS = 250

type Phase = 'lit' | 'out' | 'done'
type ProvStatus = 'pending' | 'active' | 'done'

type Progress = {
  order: string[]
  status: Record<string, ProvStatus>
  claudeDone: number
  claudeTotal: number
  cold: boolean
}

const EMPTY: Progress = { order: [], status: {}, claudeDone: 0, claudeTotal: 0, cold: false }

function reduceProgress(state: Progress, event: ScanProgressEvent): Progress {
  switch (event.kind) {
    case 'providers': {
      const status: Record<string, ProvStatus> = {}
      for (const provider of event.providers) status[provider] = state.status[provider] ?? 'pending'
      return { ...state, order: event.providers, status, cold: state.cold || event.cold === true }
    }
    case 'provider': {
      const order = state.order.includes(event.provider) ? state.order : [...state.order, event.provider]
      const next: ProvStatus = event.state === 'done' || event.state === 'skipped' ? 'done' : 'active'
      return { ...state, order, status: { ...state.status, [event.provider]: next } }
    }
    case 'tick':
      return { ...state, claudeDone: event.done, claudeTotal: event.total }
    case 'done': {
      const status = { ...state.status }
      for (const provider of state.order) status[provider] = 'done'
      return { ...state, status }
    }
  }
}

function providerLabel(id: string): string {
  return id.split(/[-\s]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function SplashStatus({ progress }: { progress: Progress }) {
  const active = progress.order.find(id => progress.status[id] === 'active') ?? null
  const counter = active === 'claude' && progress.claudeTotal > 0
    ? ` · ${progress.claudeDone.toLocaleString('en-US')}/${progress.claudeTotal.toLocaleString('en-US')}`
    : ''
  const line = active
    ? `Indexing ${providerLabel(active)}${counter}`
    : progress.order.length > 0
      ? 'Preparing your usage history…'
      : 'Loading local analytics…'
  const note = progress.cold
    ? 'First history scan · future launches reuse the local index'
    : 'Reading your local Metrora data'

  return (
    <div className="splash-status" role="status" aria-live="polite">
      <div className="splash-status-line">{line}</div>
      {progress.order.length > 0 && (
        <div className="splash-prov-strip" aria-hidden="true">
          {progress.order.map(id => (
            <span key={id} className={`splash-prov ${progress.status[id] ?? 'pending'}`} title={providerLabel(id)}>
              <ProviderLogo provider={id} size={15} />
            </span>
          ))}
        </div>
      )}
      <div className="splash-status-note">{note}</div>
    </div>
  )
}

/** Full-window Metrora startup surface over the local scan. */
export function Splash({ hasData, hasError }: { hasData: boolean; hasError: boolean }) {
  const [phase, setPhase] = useState<Phase>('lit')
  const [progress, setProgress] = useState<Progress>(EMPTY)
  const shownAt = useRef(Date.now())
  const done = useRef(false)

  useEffect(() => {
    if (!metrora || typeof metrora.onProgress !== 'function') return
    return metrora.onProgress(event => setProgress(previous => reduceProgress(previous, event)))
  }, [])

  useEffect(() => {
    if (done.current || (!hasData && !hasError)) return
    if (hasError || reducedMotion()) {
      done.current = true
      setPhase('done')
      return
    }
    const wait = Math.max(0, MIN_ON_SCREEN_MS - (Date.now() - shownAt.current))
    const timer = setTimeout(() => setPhase('out'), wait)
    return () => clearTimeout(timer)
  }, [hasData, hasError])

  useEffect(() => {
    if (phase !== 'out') return
    const timer = setTimeout(() => {
      done.current = true
      setPhase('done')
    }, CROSSFADE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === 'done' || typeof document === 'undefined') return null

  const base = phase === 'out' ? 'splash splash-out' : 'splash'
  return createPortal(
    <div className={motionClass(base, 'splash-lit')} aria-label="Metrora is loading">
      <div className="splash-mark"><MetroraMark size={76} /></div>
      <div className="splash-word">Metrora</div>
      <div className="splash-version">v{version}</div>
      {phase === 'lit' && <SplashStatus progress={progress} />}
    </div>,
    document.body,
  )
}
