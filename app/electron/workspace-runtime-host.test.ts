import { describe, expect, it, vi } from 'vitest'

import {
  disposeDesktopWorkspaceRuntime,
  getDesktopWorkspaceRuntimeState,
  initializeDesktopWorkspaceRuntimeState,
  installDesktopWorkspaceRuntimePromise,
  type DesktopLocalStateModule,
  type DesktopWorkspaceRuntime,
  type ElectronSafeStorageLike,
} from './local-state'

function safeStorage(available = true): ElectronSafeStorageLike {
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => available),
    encryptStringAsync: vi.fn(async plaintext => Buffer.from(`sealed:${plaintext}`)),
    decryptStringAsync: vi.fn(async ciphertext => ({
      result: Buffer.from(ciphertext).toString('utf-8').replace(/^sealed:/, ''),
      shouldReEncrypt: false,
    })),
  }
}

function runtime(): DesktopWorkspaceRuntime {
  return {
    getSnapshot: vi.fn<DesktopWorkspaceRuntime['getSnapshot']>(async () => ({
      kind: 'metrora.desktop-workspace-snapshot',
      version: 1,
      localOnly: true,
      identity: {
        endpointId: 'endpoint_test',
        generation: 2,
        publicKeyFingerprintSha256: 'a'.repeat(64),
      },
      workspace: null,
      evidence: {
        state: 'workspace-required',
        pendingEventCount: 0,
        unbatchedEventCount: 0,
        acknowledgedEventCount: 0,
        invalidEventCount: 0,
        quarantinedEventCount: 0,
        pendingBatchCount: 0,
        acknowledgedBatchCount: 0,
        blockers: [],
      },
      privacy: {
        networkRequired: false,
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        secretsIncluded: false,
        unrestrictedLocalPathsIncluded: false,
      },
    })),
    createWorkspace: vi.fn(),
    createNextBatch: vi.fn(),
    exportEvidence: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('Electron private Workspace runtime host', () => {
  it('passes platform, version and safeStorage only to the staged main-process runtime', async () => {
    const privateRuntime = runtime()
    const initialize = vi.fn<DesktopLocalStateModule['initializeDesktopWorkspaceRuntimeV1']>(async options => {
      expect(options.backend).toBe('windows-dpapi')
      expect(options.platform).toEqual({ os: 'windows', architecture: 'x64' })
      expect(options.metroraVersion).toBe('0.9.20')
      expect(options.collectorVersion).toBe('0.9.20')
      expect(options.capabilities).toEqual(['collect', 'normalize', 'aggregate', 'serve-local-api'])
      expect(await options.safeStorage.isAvailable()).toBe(true)
      return {
        endpoint: {
          endpointId: 'endpoint_test',
          generation: 2,
          publicKeyFingerprintSha256: 'a'.repeat(64),
        },
        masterKeyState: 'loaded',
        backend: 'windows-dpapi',
        runtime: privateRuntime,
      }
    })
    const importModule = vi.fn(async () => ({
      initializeDesktopLocalStateV1: vi.fn(),
      initializeDesktopWorkspaceRuntimeV1: initialize,
    }))

    const result = await initializeDesktopWorkspaceRuntimeState({
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.9.20',
      isPackaged: false,
      resourcesPath: 'C:\\app\\resources',
      appPath: 'C:\\repo\\app',
      userDataPath: 'C:\\Users\\test\\Metrora',
      safeStorage: safeStorage(),
      importModule,
    })

    expect(result).toMatchObject({
      status: 'ready',
      endpointId: 'endpoint_test',
      identityGeneration: 2,
      masterKeyState: 'loaded',
      backend: 'windows-dpapi',
    })
    expect(result.status === 'ready' && result.runtime).toBe(privateRuntime)
  })

  it('returns bounded unavailable states instead of leaking initialization errors', async () => {
    const importModule = vi.fn(async () => ({
      initializeDesktopLocalStateV1: vi.fn(),
      initializeDesktopWorkspaceRuntimeV1: vi.fn(async () => {
        const error = new Error('secret path C:\\Users\\test\\vault failed')
        error.name = 'DesktopVaultUnavailableError'
        throw error
      }),
    }))
    await expect(initializeDesktopWorkspaceRuntimeState({
      platform: 'win32',
      isPackaged: false,
      resourcesPath: 'C:\\app\\resources',
      appPath: 'C:\\repo\\app',
      userDataPath: 'C:\\Users\\test\\Metrora',
      safeStorage: safeStorage(false),
      importModule,
    })).resolves.toEqual({ status: 'unavailable', reason: 'vault-unavailable' })
  })

  it('does not load signing code on unsupported platforms', async () => {
    const importModule = vi.fn()
    await expect(initializeDesktopWorkspaceRuntimeState({
      platform: 'linux',
      isPackaged: false,
      resourcesPath: '/resources',
      appPath: '/repo/app',
      userDataPath: '/home/test/.config/Metrora',
      safeStorage: safeStorage(),
      importModule,
    })).resolves.toEqual({ status: 'unsupported-platform', platform: 'linux' })
    expect(importModule).not.toHaveBeenCalled()
  })

  it('shares one initialization promise and disposes the private runtime once', async () => {
    const privateRuntime = runtime()
    const state = {
      status: 'ready' as const,
      endpointId: 'endpoint_test',
      publicKeyFingerprintSha256: 'a'.repeat(64),
      identityGeneration: 1,
      masterKeyState: 'loaded' as const,
      backend: 'windows-dpapi' as const,
      runtime: privateRuntime,
    }
    const promise = Promise.resolve(state)
    installDesktopWorkspaceRuntimePromise(promise)
    expect(await getDesktopWorkspaceRuntimeState()).toBe(state)
    await disposeDesktopWorkspaceRuntime()
    expect(privateRuntime.dispose).toHaveBeenCalledTimes(1)
  })
})