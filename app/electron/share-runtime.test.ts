// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

import { desktopShareRuntimeModulePath, loadDesktopShareRuntime, type DesktopShareStatus } from './share-runtime'

const status: DesktopShareStatus = {
  sharing: false,
  name: 'Metrora Desktop',
  port: 7777,
  host: null,
  addresses: [],
  connectPayload: null,
  always: false,
  peers: 0,
  pending: [],
}

describe('desktop share runtime loader', () => {
  it('resolves the staged runtime in development and packaged layouts', () => {
    expect(desktopShareRuntimeModulePath({ isPackaged: false, appPath: 'C:/metrora/app', resourcesPath: 'ignored' }))
      .toBe(join('C:/metrora/app', 'build', 'cli', 'dist', 'desktop-share-runtime.js'))
    expect(desktopShareRuntimeModulePath({ isPackaged: true, appPath: 'ignored', resourcesPath: 'C:/resources' }))
      .toBe(join('C:/resources', 'cli.asar', 'dist', 'desktop-share-runtime.js'))
  })

  it('loads one runtime instance through the shared entry point', async () => {
    const createDesktopShareRuntime = vi.fn(async (port?: number) => ({
      status: async () => status,
      start: async () => status,
      stop: async () => status,
      approve: async () => status,
      ...(port === 7777 ? {} : {}),
    }))
    const runtime = await loadDesktopShareRuntime(
      { isPackaged: false, appPath: 'C:/metrora/app', resourcesPath: 'ignored' },
      async () => ({ createDesktopShareRuntime }),
    )
    expect(createDesktopShareRuntime).toHaveBeenCalledWith(7777)
    expect(await runtime.status()).toEqual(status)
  })
})
