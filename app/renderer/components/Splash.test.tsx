// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The splash captures the canonical Metrora bridge at import.
let progressCb: ((event: unknown) => void) | undefined
vi.mock('../lib/ipc', () => ({
  metrora: { onProgress: (cb: (event: unknown) => void) => { progressCb = cb; return () => { progressCb = undefined } } },
  normalizeCliError: (err: unknown) => err,
}))

import { Splash } from './Splash'
import { mockMatchMedia as mockReducedMotion } from '../lib/testMatchMedia'

function splashEl(): HTMLElement | null {
  return document.querySelector('.splash')
}

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('Splash', () => {
  it('stays up while the first overview fetch has neither data nor error and says what it is doing', () => {
    render(<Splash hasData={false} hasError={false} />)
    const el = splashEl()
    expect(el).toBeInTheDocument()
    expect(el).not.toHaveClass('splash-lit')
    expect(el?.querySelector('video')).toBeNull()
    expect(el?.querySelector('.splash-mark svg')).not.toBeNull()
    expect(el?.textContent).toContain('Metrora')
    expect(document.querySelector('.splash-status-line')?.textContent).toBe('Loading local analytics…')
    expect(el?.textContent).toContain('Reading your local Metrora data')
  })

  it('holds the min on-screen time, then crossfades away once data lands', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).toBeInTheDocument()

    rerender(<Splash hasData hasError={false} />)
    act(() => { vi.advanceTimersByTime(599) })
    expect(splashEl()).toBeInTheDocument()
    expect(splashEl()).not.toHaveClass('splash-out')

    act(() => { vi.advanceTimersByTime(1) })
    expect(splashEl()).toHaveClass('splash-out')

    act(() => { vi.advanceTimersByTime(250) })
    expect(splashEl()).not.toBeInTheDocument()
  })

  it('yields immediately when the first fetch errors, with no min-time', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).toBeInTheDocument()

    rerender(<Splash hasData={false} hasError />)
    expect(splashEl()).not.toBeInTheDocument()
  })

  it('never reappears on a later loading state after it has dismissed', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    rerender(<Splash hasData hasError={false} />)
    act(() => { vi.advanceTimersByTime(600) })
    act(() => { vi.advanceTimersByTime(250) })
    expect(splashEl()).not.toBeInTheDocument()

    rerender(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).not.toBeInTheDocument()
    rerender(<Splash hasData hasError={false} />)
    expect(splashEl()).not.toBeInTheDocument()
  })

  it('upgrades the generic status to live cold-scan progress', () => {
    render(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).toBeInTheDocument()
    expect(document.querySelector('.splash-status-line')?.textContent).toBe('Loading local analytics…')

    act(() => {
      progressCb?.({ kind: 'providers', cold: true, providers: ['claude', 'codex'] })
      progressCb?.({ kind: 'provider', provider: 'claude', state: 'start' })
      progressCb?.({ kind: 'tick', provider: 'claude', done: 120, total: 480 })
    })

    const status = document.querySelector('.splash-status')
    expect(status).toBeInTheDocument()
    expect(status?.querySelector('.splash-status-line')?.textContent).toBe('Indexing Claude · 120/480')
    expect(status?.textContent).toContain('First history scan')
    expect(document.querySelectorAll('.splash-prov').length).toBe(2)
    expect(document.querySelector('.splash-prov.active')?.getAttribute('title')).toBe('Claude')

    act(() => { progressCb?.({ kind: 'provider', provider: 'claude', state: 'done' }) })
    expect(document.querySelector('.splash-prov.done')?.getAttribute('title')).toBe('Claude')
    expect(document.querySelector('.splash-status-line')?.textContent).toBe('Preparing your usage history…')
  })

  it('keeps a compact warm-launch status instead of looking frozen', () => {
    render(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).toBeInTheDocument()

    act(() => {
      progressCb?.({ kind: 'providers', cold: false, providers: ['claude', 'codex'] })
      progressCb?.({ kind: 'provider', provider: 'claude', state: 'start' })
      progressCb?.({ kind: 'tick', provider: 'claude', done: 40, total: 60 })
    })

    expect(document.querySelector('.splash-status-line')?.textContent).toBe('Indexing Claude · 40/60')
    expect(document.querySelector('.splash-status')?.textContent).toContain('Reading your local Metrora data')
  })

  it('swaps instantly under reduced motion (no fade, no min-time)', () => {
    mockReducedMotion(true)
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    const el = splashEl()
    expect(el).toBeInTheDocument()
    expect(el).not.toHaveClass('splash-lit')

    rerender(<Splash hasData hasError={false} />)
    expect(splashEl()).not.toBeInTheDocument()
  })
})
