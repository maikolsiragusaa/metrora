import type { OpenCodeRuntime } from './runtime'
import type { OpenCodeConnection, OpenCodeRuntimeStatus } from './types'

export type OpenCodeBounds = { x: number; y: number; width: number; height: number }

export function normalizeOpenCodeBounds(value: unknown): OpenCodeBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const numbers = ['x', 'y', 'width', 'height'].map(key => input[key])
  if (numbers.some(item => typeof item !== 'number' || !Number.isFinite(item))) return null
  const [x, y, width, height] = numbers as number[]
  if (x < 0 || y < 0 || width < 1 || height < 1 || x > 10_000 || y > 10_000 || width > 10_000 || height > 10_000) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export function isAllowedOpenCodeUrl(value: string, expectedOrigin: string): boolean {
  try {
    const url = new URL(value)
    const expected = new URL(expectedOrigin)
    return url.protocol === 'http:' && url.origin === expected.origin && url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

type NavigationEvent = { preventDefault: () => void }
type LoginEvent = { preventDefault: () => void }
type LoginAuthInfo = { isProxy: boolean; host: string; port: number; scheme: string }
type LoginCallback = (username?: string, password?: string) => void

export type OpenCodeWebContents = {
  on: (event: 'will-navigate' | 'will-frame-navigate' | 'will-redirect', listener: (...args: any[]) => void) => unknown
  removeListener?: (event: 'will-navigate' | 'will-frame-navigate' | 'will-redirect', listener: (...args: any[]) => void) => unknown
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => unknown
  loadURL: (url: string) => Promise<unknown>
  focus?: () => void
  destroy?: () => void
  close?: () => void
}

export type OpenCodeView = {
  webContents: OpenCodeWebContents
  setBounds: (bounds: OpenCodeBounds) => void
  setVisible: (visible: boolean) => void
}

export type OpenCodeWindow = {
  contentView: {
    addView: (view: OpenCodeView) => void
    removeView: (view: OpenCodeView) => void
  }
}

export type OpenCodeApp = {
  on: (event: 'login', listener: (event: LoginEvent, webContents: OpenCodeWebContents, details: unknown, authInfo: LoginAuthInfo, callback: LoginCallback) => void) => unknown
  removeListener?: (event: 'login', listener: (event: LoginEvent, webContents: OpenCodeWebContents, details: unknown, authInfo: LoginAuthInfo, callback: LoginCallback) => void) => unknown
}

type ViewRecord = {
  view: OpenCodeView
  window: OpenCodeWindow
  origin: string
  loaded: boolean
  navigationListeners: Array<{ event: 'will-navigate' | 'will-frame-navigate' | 'will-redirect'; listener: (...args: any[]) => void }>
}

export type OpenCodeViewManagerOptions = {
  app: OpenCodeApp
  createView: () => OpenCodeView
}

/** Owns the main-process WebContentsView while the runtime owns the sidecar. */
export class OpenCodeViewManager {
  private readonly records = new Set<ViewRecord>()
  private readonly loginListener: (event: LoginEvent, webContents: OpenCodeWebContents, details: unknown, authInfo: LoginAuthInfo, callback: LoginCallback) => void

  constructor(private readonly runtime: Pick<OpenCodeRuntime, 'start' | 'stop' | 'status' | 'getConnection'>, private readonly options: OpenCodeViewManagerOptions) {
    this.loginListener = (_event, webContents, _details, authInfo, callback) => {
      const record = [...this.records].find(candidate => candidate.view.webContents === webContents)
      const connection = record ? this.runtime.getConnection() : null
      if (!record || !connection || authInfo.isProxy || authInfo.scheme.toLowerCase() !== 'basic' || !this.matchesConnection(authInfo, connection)) {
        callback()
        return
      }
      _event.preventDefault()
      callback(connection.username, connection.password)
    }
    this.options.app.on('login', this.loginListener)
  }

  async activate(window: OpenCodeWindow, bounds: OpenCodeBounds): Promise<OpenCodeRuntimeStatus> {
    const status = await this.runtime.start()
    if (status.state !== 'ready') return status
    const connection = this.runtime.getConnection()
    if (!connection) return { ...status, state: 'unavailable', detail: 'OpenCode authentication is unavailable.' }

    let record = [...this.records].find(candidate => candidate.window === window)
    if (record && record.origin !== connection.origin) {
      this.disposeRecord(record)
      record = undefined
    }
    if (!record) {
      record = this.createRecord(window, connection)
      this.records.add(record)
      window.contentView.addView(record.view)
    }

    record.view.setBounds(bounds)
    record.view.setVisible(true)
    record.view.webContents.focus?.()
    if (!record.loaded) {
      record.loaded = true
      void record.view.webContents.loadURL(`${connection.origin}/`).catch(() => { record!.loaded = false })
    }
    return this.runtime.status()
  }

  updateBounds(window: OpenCodeWindow, bounds: OpenCodeBounds): boolean {
    const record = [...this.records].find(candidate => candidate.window === window)
    if (!record) return false
    record.view.setBounds(bounds)
    return true
  }

  deactivate(window: OpenCodeWindow): boolean {
    const record = [...this.records].find(candidate => candidate.window === window)
    if (!record) return false
    record.view.setVisible(false)
    return true
  }

  disposeWindow(window: OpenCodeWindow): void {
    const record = [...this.records].find(candidate => candidate.window === window)
    if (record) this.disposeRecord(record)
    if (this.records.size === 0) void this.runtime.stop().catch(() => {})
  }

  async shutdown(): Promise<void> {
    for (const record of [...this.records]) this.disposeRecord(record)
    this.options.app.removeListener?.('login', this.loginListener)
    await this.runtime.stop()
  }

  private createRecord(window: OpenCodeWindow, connection: OpenCodeConnection): ViewRecord {
    const view = this.options.createView()
    const navigationListeners: ViewRecord['navigationListeners'] = []
    const guard = (event: NavigationEvent, details?: unknown) => {
      const candidate = typeof details === 'string'
        ? details
        : details && typeof details === 'object' && typeof (details as { url?: unknown }).url === 'string'
          ? (details as { url: string }).url
          : (event as NavigationEvent & { url?: string }).url ?? ''
      if (!isAllowedOpenCodeUrl(candidate, connection.origin)) event.preventDefault()
    }
    for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect'] as const) {
      view.webContents.on(event, guard)
      navigationListeners.push({ event, listener: guard })
    }
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    return { view, window, origin: connection.origin, loaded: false, navigationListeners }
  }

  private disposeRecord(record: ViewRecord): void {
    this.records.delete(record)
    record.view.setVisible(false)
    try { record.window.contentView.removeView(record.view) } catch { /* already detached */ }
    for (const item of record.navigationListeners) record.view.webContents.removeListener?.(item.event, item.listener)
    if (record.view.webContents.destroy) record.view.webContents.destroy()
    else record.view.webContents.close?.()
  }

  private matchesConnection(authInfo: LoginAuthInfo, connection: OpenCodeConnection): boolean {
    try {
      const url = new URL(connection.origin)
      return authInfo.host === url.hostname && authInfo.port === Number(url.port)
    } catch {
      return false
    }
  }
}
