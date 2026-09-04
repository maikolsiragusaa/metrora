// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { OpenCodeViewManager, isAllowedOpenCodeUrl, normalizeOpenCodeBounds, type OpenCodeApp, type OpenCodeView, type OpenCodeWebContents, type OpenCodeWindow } from './view'
import type { OpenCodeRuntimeStatus } from './types'

const status: OpenCodeRuntimeStatus = { state: 'ready', version: '1.18.27', commit: 'b04697366f05419e9bd7a92f841813dd976161c9', customToolRegistered: true, detail: null }

type FakeWebContents = OpenCodeWebContents & { opened: string[]; scripts: string[]; storage: string | null; url: string; popupHandler?: () => { action: 'deny' }; destroyed: boolean; focused: boolean }
type FakeView = OpenCodeView & { webContents: FakeWebContents; visible: boolean; bounds: { x: number; y: number; width: number; height: number }; emit: (event: string, ...args: any[]) => void }

function fakeView(reportedUrl?: string): FakeView {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const webContents: FakeWebContents = {
    opened: [],
    scripts: [],
    storage: null,
    url: '',
    destroyed: false,
    focused: false,
    on(event, listener) {
      const current = listeners.get(event) ?? new Set()
      current.add(listener)
      listeners.set(event, current)
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener)
    },
    setWindowOpenHandler(handler) { webContents.popupHandler = handler },
    loadURL: async url => { webContents.opened.push(url); webContents.url = reportedUrl ?? url },
    executeJavaScript: async code => {
      webContents.scripts.push(code)
      if (code.includes('localStorage.getItem')) return webContents.storage
      return true
    },
    getURL: () => webContents.url,
    focus: () => { webContents.focused = true },
    destroy: () => { webContents.destroyed = true },
  }
  const view: FakeView = {
    webContents,
    visible: false,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    setBounds: bounds => { view.bounds = bounds },
    setVisible: visible => { view.visible = visible },
    emit: (event, ...args) => { for (const listener of listeners.get(event) ?? []) listener(...args) },
  }
  return view
}

function fakeWindow() {
  const window: OpenCodeWindow & { added: OpenCodeView[]; removed: OpenCodeView[]; attached: Set<OpenCodeView> } = {
    added: [],
    removed: [],
    attached: new Set(),
    contentView: {
      addChildView: view => { window.added.push(view); window.attached.add(view) },
      removeChildView: view => { window.removed.push(view); window.attached.delete(view) },
    },
  }
  return window
}

describe('OpenCode WebContentsView boundary', () => {
  it('normalizes bounds and blocks non-loopback origins', () => {
    expect(normalizeOpenCodeBounds({ x: 1.2, y: 2.8, width: 900, height: 600 })).toEqual({ x: 1, y: 3, width: 900, height: 600 })
    expect(normalizeOpenCodeBounds({ x: -1, y: 0, width: 900, height: 600 })).toBeNull()
    expect(isAllowedOpenCodeUrl('http://127.0.0.1:43127/', 'http://127.0.0.1:43127')).toBe(true)
    expect(isAllowedOpenCodeUrl('https://127.0.0.1:43127/', 'http://127.0.0.1:43127')).toBe(false)
    expect(isAllowedOpenCodeUrl('http://127.0.0.1:43127.evil.example/', 'http://127.0.0.1:43127')).toBe(false)
    expect(isAllowedOpenCodeUrl('http://app.opencode.ai/', 'http://127.0.0.1:43127')).toBe(false)
  })

  it('activates/deactivates one upstream view, authenticates only its origin, blocks popup/navigation, and cleans it up', async () => {
    const appListeners = new Map<string, (...args: any[]) => void>()
    const app: OpenCodeApp = {
      on: vi.fn((event, listener) => { appListeners.set(event, listener) }),
      removeListener: vi.fn((event, listener) => { if (appListeners.get(event) === listener) appListeners.delete(event) }),
    }
    const connection = { origin: 'http://127.0.0.1:43127', username: 'metrora', password: 'secret-password' }
    let processStarts = 0
    let runtimeReady = false
    const runtime = {
      start: vi.fn(async () => {
        if (!runtimeReady) {
          processStarts += 1
          runtimeReady = true
        }
        return status
      }),
      stop: vi.fn(async () => undefined),
      status: vi.fn(() => status),
      getConnection: vi.fn(() => connection),
    }
    const view = fakeView()
    const firstWebContents = view.webContents
    const window = fakeWindow()
    const createView = vi.fn(() => view)
    const manager = new OpenCodeViewManager(runtime, { app, createView })

    await expect(manager.activate(window, { x: 4, y: 5, width: 900, height: 600 })).resolves.toEqual(status)
    expect(runtime.start).toHaveBeenCalledOnce()
    expect(createView).toHaveBeenCalledOnce()
    expect(window.added).toEqual([view])
    expect(window.attached).toEqual(new Set([view]))
    expect(view.visible).toBe(true)
    expect(view.webContents.focused).toBe(true)
    expect(view.webContents.opened).toEqual(['http://127.0.0.1:43127/'])
    expect(view.webContents.popupHandler?.()).toEqual({ action: 'deny' })

    let prevented = false
    view.emit('will-navigate', { preventDefault: () => { prevented = true } }, 'https://example.com/')
    expect(prevented).toBe(true)
    prevented = false
    view.emit('will-frame-navigate', { preventDefault: () => { prevented = true } }, { url: 'http://127.0.0.1:43127/ok' })
    expect(prevented).toBe(false)
    prevented = false
    view.emit('will-redirect', { preventDefault: () => { prevented = true } }, 'http://127.0.0.1:43128/')
    expect(prevented).toBe(true)

    let loginPrevented = false
    let credentials: string[] | undefined
    appListeners.get('login')?.({ preventDefault: () => { loginPrevented = true } }, view.webContents, {}, { isProxy: false, host: '127.0.0.1', port: 43127, scheme: 'basic' }, (username?: string, password?: string) => { credentials = [username ?? '', password ?? ''] })
    expect(loginPrevented).toBe(true)
    expect(credentials).toEqual(['metrora', 'secret-password'])

    let wrongAuthCallback = false
    appListeners.get('login')?.({ preventDefault: () => { throw new Error('wrong-origin auth must not be accepted') } }, view.webContents, {}, { isProxy: false, host: '127.0.0.1', port: 43128, scheme: 'basic' }, () => { wrongAuthCallback = true })
    expect(wrongAuthCallback).toBe(true)

    manager.deactivate(window)
    expect(view.visible).toBe(false)
    expect(window.attached).toEqual(new Set([view]))
    expect(window.removed).toEqual([])

    await manager.activate(window, { x: 4, y: 5, width: 800, height: 500 })
    expect(createView).toHaveBeenCalledOnce()
    expect(window.added).toHaveLength(1)
    expect(window.attached).toEqual(new Set([view]))
    expect(view.webContents).toBe(firstWebContents)
    expect(view.visible).toBe(true)
    expect(view.webContents.opened).toHaveLength(1)
    expect(view.bounds).toEqual({ x: 4, y: 5, width: 800, height: 500 })
    expect(processStarts).toBe(1)

    await manager.shutdown()
    expect(window.removed).toEqual([view])
    expect(window.attached).toEqual(new Set())
    expect(view.webContents.destroyed).toBe(true)
    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(app.removeListener).toHaveBeenCalledOnce()
    expect(appListeners.has('login')).toBe(false)
  })

  it('prewarms a hidden view, seeds upstream project storage, reveals only after load, and keeps the runtime alive on navigation', async () => {
    const app: OpenCodeApp = { on: vi.fn(), removeListener: vi.fn() }
    const connection = { origin: 'http://127.0.0.1:43127', username: 'metrora', password: 'secret-password' }
    const runtime = {
      start: vi.fn(async () => status),
      stop: vi.fn(async () => undefined),
      status: vi.fn(() => status),
      getConnection: vi.fn(() => connection),
    }
    const view = fakeView()
    const window = fakeWindow()
    const manager = new OpenCodeViewManager(runtime, {
      app,
      createView: () => view,
      platform: 'win32',
      readDesktopProjects: async () => ({ projects: [{ worktree: 'C:/Repo/DesktopOnly', expanded: true }] }),
    })

    const prewarm = manager.prewarm(window)
    const activate = manager.activate(window, { x: 4, y: 5, width: 900, height: 600 })
    expect(view.visible).toBe(false)
    await expect(Promise.all([prewarm, activate])).resolves.toEqual([status, status])

    expect(runtime.start).toHaveBeenCalledOnce()
    expect(window.added).toHaveLength(1)
    expect(window.attached).toEqual(new Set([view]))
    expect(view.webContents.opened).toHaveLength(2)
    expect(view.webContents.scripts.some(script => script.includes('localStorage.setItem'))).toBe(true)
    expect(view.webContents.scripts.some(script => script.includes('C:/Repo/DesktopOnly'))).toBe(true)
    expect(view.visible).toBe(true)
    expect(view.webContents.focused).toBe(true)

    manager.deactivate(window)
    expect(window.attached).toEqual(new Set([view]))
    expect(view.visible).toBe(false)
    await manager.activate(window, { x: 8, y: 9, width: 700, height: 500 })
    expect(window.added).toHaveLength(1)
    expect(view.webContents.opened).toHaveLength(2)
    expect(view.visible).toBe(true)

    manager.disposeWindow(window)
    expect(window.removed).toEqual([view])
    expect(window.attached).toEqual(new Set())
    expect(view.webContents.destroyed).toBe(true)
    expect(runtime.stop).not.toHaveBeenCalled()
    await manager.shutdown()
    expect(runtime.stop).toHaveBeenCalledOnce()
  })

  it('fails closed before seeding when the loaded URL is not the expected loopback origin', async () => {
    const app: OpenCodeApp = { on: vi.fn(), removeListener: vi.fn() }
    const connection = { origin: 'http://127.0.0.1:43127', username: 'metrora', password: 'secret-password' }
    const runtime = {
      start: vi.fn(async () => status),
      stop: vi.fn(async () => undefined),
      status: vi.fn(() => status),
      getConnection: vi.fn(() => connection),
    }
    const view = fakeView('https://example.com/')
    const window = fakeWindow()
    const manager = new OpenCodeViewManager(runtime, {
      app,
      createView: () => view,
      readDesktopProjects: async () => ({ projects: [{ worktree: 'C:/Repo/DesktopOnly', expanded: true }] }),
      platform: 'win32',
    })

    await expect(manager.activate(window, { x: 0, y: 0, width: 900, height: 600 })).resolves.toMatchObject({ state: 'unavailable' })
    expect(view.webContents.scripts).toEqual([])
    expect(view.visible).toBe(false)
    expect(window.attached).toEqual(new Set())
  })
})
