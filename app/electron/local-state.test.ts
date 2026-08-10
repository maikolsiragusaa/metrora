import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  desktopLocalStateModulePath,
  desktopReviewedProductionModulePath,
  desktopVaultBackend,
  initializeDesktopEndpointState,
  type DesktopLocalStateModule,
  type ElectronSafeStorageLike,
} from './local-state'

function safeStorage(): ElectronSafeStorageLike {
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async plaintext => Buffer.from(`sealed:${plaintext}`)),
    decryptStringAsync: vi.fn(async ciphertext => ({
      result: Buffer.from(ciphertext).toString('utf-8').replace(/^sealed:/, ''),
      shouldReEncrypt: false,
    })),
  }
}

describe('desktop local-state Electron host', () => {
  it('maps only the initially supported OS vault backends', () => {
    expect(desktopVaultBackend('win32')).toBe('windows-dpapi')
    expect(desktopVaultBackend('darwin')).toBe('macos-keychain')
    expect(desktopVaultBackend('linux')).toBeUndefined()
  })

  it('resolves staged modules in dev and the sealed ASAR in the packaged layout', () => {
    expect(desktopLocalStateModulePath({
      isPackaged: false,
      appPath: '/repo/app',
      resourcesPath: '/unused',
    })).toBe(join('/repo/app', 'build', 'cli', 'dist', 'desktop-local-state.js'))
    expect(desktopLocalStateModulePath({
      isPackaged: true,
      appPath: '/unused',
      resourcesPath: '/app/resources',
    })).toBe(join('/app/resources', 'cli.asar', 'dist', 'desktop-local-state.js'))
    expect(desktopReviewedProductionModulePath({
      isPackaged: false,
      appPath: '/repo/app',
      resourcesPath: '/unused',
    })).toBe(join('/repo/app', 'build', 'cli', 'dist', 'desktop-reviewed-production.js'))
    expect(desktopReviewedProductionModulePath({
      isPackaged: true,
      appPath: '/unused',
      resourcesPath: '/app/resources',
    })).toBe(join('/app/resources', 'cli.asar', 'dist', 'desktop-reviewed-production.js'))
  })

  it('passes a narrow async safeStorage adapter to the shared runtime', async () => {
    const storage = safeStorage()
    const userDataPath = 'C:\\Users\\test\\Metrora'
    const initialize = vi.fn<DesktopLocalStateModule['initializeDesktopLocalStateV1']>(async options => {
      expect(options.backend).toBe('windows-dpapi')
      expect(options.dataDir).toBe(join(userDataPath, 'metrora-local-state'))
      expect(await options.safeStorage.isAvailable()).toBe(true)
      const sealed = await options.safeStorage.encryptString('secret')
      expect(Buffer.from(sealed).toString()).toBe('sealed:secret')
      expect(await options.safeStorage.decryptString(sealed)).toEqual({ result: 'secret', shouldReEncrypt: false })
      return {
        endpoint: {
          endpointId: 'ep_test',
          generation: 2,
          publicKeyFingerprintSha256: 'a'.repeat(64),
        },
        masterKeyState: 'loaded',
        backend: 'windows-dpapi',
      }
    })
    const initializeWorkspace = vi.fn<DesktopLocalStateModule['initializeDesktopWorkspaceRuntimeV1']>(async () => {
      throw new Error('not used by endpoint-only initialization')
    })
    const importModule = vi.fn(async () => ({
      initializeDesktopLocalStateV1: initialize,
      initializeDesktopWorkspaceRuntimeV1: initializeWorkspace,
    }))

    const result = await initializeDesktopEndpointState({
      platform: 'win32',
      isPackaged: false,
      resourcesPath: 'C:\\app\\resources',
      appPath: 'C:\\repo\\app',
      userDataPath,
      safeStorage: storage,
      importModule,
    })

    expect(result).toEqual({
      status: 'ready',
      endpointId: 'ep_test',
      publicKeyFingerprintSha256: 'a'.repeat(64),
      identityGeneration: 2,
      masterKeyState: 'loaded',
      backend: 'windows-dpapi',
    })
    expect(importModule).toHaveBeenCalledOnce()
    expect(initialize).toHaveBeenCalledOnce()
    expect(initializeWorkspace).not.toHaveBeenCalled()
  })

  it('fails closed without loading the runtime on unsupported platforms', async () => {
    const importModule = vi.fn()
    const result = await initializeDesktopEndpointState({
      platform: 'linux',
      isPackaged: false,
      resourcesPath: '/resources',
      appPath: '/repo/app',
      userDataPath: '/home/test/.config/Metrora',
      safeStorage: safeStorage(),
      importModule,
    })
    expect(result).toEqual({ status: 'unsupported-platform', platform: 'linux' })
    expect(importModule).not.toHaveBeenCalled()
  })
})
