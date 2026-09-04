import {
  mergeOpenCodeWebProjects,
  OPENCODE_WEB_SERVER_STORAGE_KEY,
  type OpenCodeDesktopProjectSnapshot,
} from './project-import'
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
type WebContentsListener = (...args: any[]) => void
type OpenCodeWebContentsEvent = 'will-navigate' | 'will-frame-navigate' | 'will-redirect' | 'did-finish-load' | 'did-fail-load'

export type OpenCodeWebContents = {
  on: (event: OpenCodeWebContentsEvent, listener: WebContentsListener) => unknown
  removeListener?: (event: OpenCodeWebContentsEvent, listener: WebContentsListener) => unknown
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => unknown
  loadURL: (url: string) => Promise<unknown>
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>
  getURL?: () => string
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
    addChildView: (view: OpenCodeView) => void
    removeChildView: (view: OpenCodeView) => void
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
  ready: boolean
  preparation: Promise<void> | null
  navigationListeners: Array<{ event: 'will-navigate' | 'will-frame-navigate' | 'will-redirect'; listener: WebContentsListener }>
}

export type OpenCodeViewManagerOptions = {
  app: OpenCodeApp
  createView: () => OpenCodeView
  readDesktopProjects?: () => Promise<OpenCodeDesktopProjectSnapshot>
  platform?: NodeJS.Platform
}

function unavailableStatus(runtime: Pick<OpenCodeRuntime, 'status'>, detail: string): OpenCodeRuntimeStatus {
  return { ...runtime.status(), state: 'unavailable', detail }
}

function waitForExpectedOpenCodeLoad(webContents: OpenCodeWebContents, url: string): Promise<void> {
  const expectedOrigin = new URL(url).origin
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      webContents.removeListener?.('did-finish-load', onFinish)
      webContents.removeListener?.('did-fail-load', onFail)
    }
    const finish = (error?: Error) => {
      if (settled) return
      if (!error) {
        const currentUrl = webContents.getURL?.() ?? ''
        if (currentUrl && !isAllowedOpenCodeUrl(currentUrl, expectedOrigin)) {
          error = new Error('OpenCode navigation reached an unexpected origin.')
        }
      }
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const onFinish = () => finish()
    const onFail = () => finish(new Error('OpenCode Web UI failed to load.'))
    webContents.on('did-finish-load', onFinish)
    webContents.on('did-fail-load', onFail)
    try {
      void webContents.loadURL(url).then(() => finish()).catch(() => finish(new Error('OpenCode Web UI failed to load.')))
    } catch {
      finish(new Error('OpenCode Web UI failed to load.'))
    }
  })
}

/** Owns the main-process WebContentsView while the runtime owns the sidecar. */
export class OpenCodeViewManager {
  private readonly records = new Set<ViewRecord>()
  private readonly preparationPromises = new Map<OpenCodeWindow, Promise<OpenCodeRuntimeStatus>>()
  private readonly desiredVisibility = new WeakMap<OpenCodeWindow, boolean>()
  private readonly disposedWindows = new WeakSet<OpenCodeWindow>()
  private readonly loginListener: (event: LoginEvent, webContents: OpenCodeWebContents, details: unknown, authInfo: LoginAuthInfo, callback: LoginCallback) => void
  private shuttingDown = false

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

  /** Start and prepare the hidden upstream surface without stealing focus. */
  async prewarm(window: OpenCodeWindow): Promise<OpenCodeRuntimeStatus> {
    if (this.shuttingDown) return unavailableStatus(this.runtime, 'OpenCode is shutting down.')
    return this.prepare(window)
  }

  async activate(window: OpenCodeWindow, bounds: OpenCodeBounds): Promise<OpenCodeRuntimeStatus> {
    this.disposedWindows.delete(window)
    this.desiredVisibility.set(window, true)
    const status = await this.prepare(window)
    if (status.state !== 'ready') return status

    const record = [...this.records].find(candidate => candidate.window === window)
    if (!record || !record.ready) return unavailableStatus(this.runtime, 'OpenCode Web UI could not be loaded.')
    if (this.desiredVisibility.get(window) !== true) return status

    record.view.setBounds(bounds)
    record.view.setVisible(true)
    record.view.webContents.focus?.()
    return this.runtime.status()
  }

  updateBounds(window: OpenCodeWindow, bounds: OpenCodeBounds): boolean {
    const record = [...this.records].find(candidate => candidate.window === window)
    if (!record) return false
    record.view.setBounds(bounds)
    return true
  }

  deactivate(window: OpenCodeWindow): boolean {
    this.desiredVisibility.set(window, false)
    const record = [...this.records].find(candidate => candidate.window === window)
    if (!record) return false
    record.view.setVisible(false)
    return true
  }

  disposeWindow(window: OpenCodeWindow): void {
    this.disposedWindows.add(window)
    this.desiredVisibility.delete(window)
    const record = [...this.records].find(candidate => candidate.window === window)
    if (record) this.disposeRecord(record)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    for (const record of [...this.records]) this.disposeRecord(record)
    this.options.app.removeListener?.('login', this.loginListener)
    await this.runtime.stop()
  }

  private async prepare(window: OpenCodeWindow): Promise<OpenCodeRuntimeStatus> {
    const existing = this.preparationPromises.get(window)
    if (existing) return existing
    const promise = this.prepareInternal(window)
    this.preparationPromises.set(window, promise)
    try {
      return await promise
    } finally {
      if (this.preparationPromises.get(window) === promise) this.preparationPromises.delete(window)
    }
  }

  private async prepareInternal(window: OpenCodeWindow): Promise<OpenCodeRuntimeStatus> {
    const status = await this.runtime.start()
    if (status.state !== 'ready') return status
    if (this.shuttingDown || this.disposedWindows.has(window)) return unavailableStatus(this.runtime, 'OpenCode window is unavailable.')

    const connection = this.runtime.getConnection()
    if (!connection) return unavailableStatus(this.runtime, 'OpenCode authentication is unavailable.')
    let record = [...this.records].find(candidate => candidate.window === window)
    if (record && record.origin !== connection.origin) {
      this.disposeRecord(record)
      record = undefined
    }

    let desktopProjects: OpenCodeDesktopProjectSnapshot = { projects: [] }
    try { desktopProjects = await this.options.readDesktopProjects?.() ?? desktopProjects } catch { /* import is best-effort */ }
    if (this.shuttingDown || this.disposedWindows.has(window)) return unavailableStatus(this.runtime, 'OpenCode window is unavailable.')

    if (!record) {
      record = this.createAndAttachRecord(window, connection)
    }
    try {
      await this.prepareRecord(record, connection, desktopProjects)
      return this.runtime.status()
    } catch {
      this.disposeRecord(record)
      return unavailableStatus(this.runtime, 'OpenCode Web UI could not be loaded.')
    }
  }

  private createAndAttachRecord(window: OpenCodeWindow, connection: OpenCodeConnection): ViewRecord {
    const record = this.createRecord(window, connection)
    record.view.setVisible(false)
    this.records.add(record)
    try {
      window.contentView.addChildView(record.view)
    } catch {
      this.disposeRecord(record)
      throw new Error('OpenCode Web UI could not be attached.')
    }
    return record
  }

  private async prepareRecord(record: ViewRecord, connection: OpenCodeConnection, desktopProjects: OpenCodeDesktopProjectSnapshot): Promise<void> {
    if (record.ready) return
    if (record.preparation) return record.preparation
    const preparation = (async () => {
      const url = `${connection.origin}/`
      await waitForExpectedOpenCodeLoad(record.view.webContents, url)
      const seeded = await this.seedWebProjectRegistry(record, desktopProjects, connection.origin)
      if (seeded) await waitForExpectedOpenCodeLoad(record.view.webContents, url)
    })()
    record.preparation = preparation
    try {
      await preparation
      record.ready = true
    } finally {
      if (record.preparation === preparation) record.preparation = null
    }
  }

  private async seedWebProjectRegistry(record: ViewRecord, desktopProjects: OpenCodeDesktopProjectSnapshot, expectedOrigin: string): Promise<boolean> {
    const executeJavaScript = record.view.webContents.executeJavaScript?.bind(record.view.webContents)
    if (!executeJavaScript || desktopProjects.projects.length === 0) return false
    const before = record.view.webContents.getURL?.() ?? ''
    if (before && !isAllowedOpenCodeUrl(before, expectedOrigin)) return false

    let currentRaw: unknown
    try {
      currentRaw = await executeJavaScript(`localStorage.getItem(${JSON.stringify(OPENCODE_WEB_SERVER_STORAGE_KEY)})`, true)
    } catch {
      return false
    }
    if (currentRaw !== null && typeof currentRaw !== 'string') return false
    const merged = mergeOpenCodeWebProjects(currentRaw, desktopProjects, this.options.platform ?? process.platform)
    if (!merged.changed || merged.serialized === null) return false

    const current = record.view.webContents.getURL?.() ?? ''
    if (current && !isAllowedOpenCodeUrl(current, expectedOrigin)) return false
    try {
      await executeJavaScript(`localStorage.setItem(${JSON.stringify(OPENCODE_WEB_SERVER_STORAGE_KEY)}, ${JSON.stringify(merged.serialized)}); true`, true)
      return true
    } catch {
      return false
    }
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
    return { view, window, origin: connection.origin, ready: false, preparation: null, navigationListeners }
  }

  private disposeRecord(record: ViewRecord): void {
    this.records.delete(record)
    record.view.setVisible(false)
    try { record.window.contentView.removeChildView(record.view) } catch { /* already detached */ }
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
