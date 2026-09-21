// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub electron so importing main.ts does not require an Electron runtime.
vi.mock('electron', () => ({
  app: { name: 'Metrora', whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: () => {} },
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}))

import { nativeTheme } from 'electron'

import {
  applyMetroraNativeTheme,
  createWindowChromeThemeHandler,
  DEFAULT_METRORA_THEME_SOURCE,
  resolveMetroraThemeSource,
} from './main'

const trustedEvent = { sender: { id: 1 }, senderFrame: { url: 'file:///renderer/index.html' } }
const untrustedEvent = { sender: { id: 2 }, senderFrame: { url: 'http://127.0.0.1:9999/' } }

function handlerDeps() {
  return {
    isTrustedRenderer: (event: { senderFrame?: { url?: string } | null }) =>
      event.senderFrame?.url?.startsWith('file:') ?? false,
    applyNativeTheme: vi.fn(),
    updateWindowChrome: vi.fn(() => true),
  }
}

describe('Metrora theme authority', () => {
  beforeEach(() => {
    ;(nativeTheme as unknown as { themeSource: string }).themeSource = 'system'
  })

  it('defaults to Dark', () => {
    expect(DEFAULT_METRORA_THEME_SOURCE).toBe('dark')
  })

  it('accepts only Dark and Light theme sources', () => {
    expect(resolveMetroraThemeSource('dark')).toBe('dark')
    expect(resolveMetroraThemeSource('light')).toBe('light')
    expect(resolveMetroraThemeSource('system')).toBeNull()
    expect(resolveMetroraThemeSource('')).toBeNull()
    expect(resolveMetroraThemeSource(null)).toBeNull()
    expect(resolveMetroraThemeSource(undefined)).toBeNull()
    expect(resolveMetroraThemeSource({ theme: 'dark' })).toBeNull()
    expect(resolveMetroraThemeSource(0)).toBeNull()
    expect(resolveMetroraThemeSource(['dark'])).toBeNull()
  })

  it('mirrors the selection into the native theme source', () => {
    const target = { themeSource: 'system' }
    applyMetroraNativeTheme('dark', target)
    expect(target.themeSource).toBe('dark')
    applyMetroraNativeTheme('light', target)
    expect(target.themeSource).toBe('light')
  })

  it('tolerates a missing native theme store', () => {
    expect(() => applyMetroraNativeTheme('dark', undefined)).not.toThrow()
    expect(() => applyMetroraNativeTheme('dark', null)).not.toThrow()
  })

  it('starts the process from Dark before renderer authority arrives', async () => {
    vi.resetModules()
    try {
      const electron = await import('electron')
      const store = electron.nativeTheme as unknown as { themeSource: string }
      store.themeSource = 'system'
      await import('./main')
      expect(store.themeSource).toBe('dark')
    } finally {
      vi.resetModules()
    }
  })
})

describe('trusted window chrome theme operation', () => {
  it('applies Dark to the native theme and the window chrome', () => {
    const deps = handlerDeps()
    const handle = createWindowChromeThemeHandler(deps)
    expect(handle(trustedEvent, 'dark')).toEqual({ ok: true, value: true })
    expect(deps.applyNativeTheme).toHaveBeenCalledWith('dark')
    expect(deps.updateWindowChrome).toHaveBeenCalledWith(trustedEvent.sender, 'dark')
  })

  it('applies Light to the native theme and the window chrome', () => {
    const deps = handlerDeps()
    const handle = createWindowChromeThemeHandler(deps)
    expect(handle(trustedEvent, 'light')).toEqual({ ok: true, value: true })
    expect(deps.applyNativeTheme).toHaveBeenCalledWith('light')
    expect(deps.updateWindowChrome).toHaveBeenCalledWith(trustedEvent.sender, 'light')
  })

  it('rejects the legacy system value without touching theme state', () => {
    const deps = handlerDeps()
    const handle = createWindowChromeThemeHandler(deps)
    expect(handle(trustedEvent, 'system')).toEqual({
      ok: false,
      error: { kind: 'bad-args', message: 'Invalid window chrome theme.' },
    })
    expect(deps.applyNativeTheme).not.toHaveBeenCalled()
    expect(deps.updateWindowChrome).not.toHaveBeenCalled()
  })

  it('rejects arbitrary input without touching theme state', () => {
    const deps = handlerDeps()
    const handle = createWindowChromeThemeHandler(deps)
    for (const invalid of [null, undefined, 0, { theme: 'dark' }, ['dark']]) {
      expect(handle(trustedEvent, invalid)).toEqual({
        ok: false,
        error: { kind: 'bad-args', message: 'Invalid window chrome theme.' },
      })
    }
    expect(deps.applyNativeTheme).not.toHaveBeenCalled()
    expect(deps.updateWindowChrome).not.toHaveBeenCalled()
  })

  it('rejects untrusted senders before any theme mutation', () => {
    const deps = handlerDeps()
    const handle = createWindowChromeThemeHandler(deps)
    expect(handle(untrustedEvent, 'dark')).toEqual({
      ok: false,
      error: { kind: 'unauthorized', message: 'Trusted Metrora renderer required.' },
    })
    expect(deps.applyNativeTheme).not.toHaveBeenCalled()
    expect(deps.updateWindowChrome).not.toHaveBeenCalled()
  })
})
