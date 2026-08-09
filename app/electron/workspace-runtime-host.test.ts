import { describe, expect, it, vi } from 'vitest'

import {
  desktopReviewedProductionModulePath,
  disposeDesktopWorkspaceRuntime,
  getDesktopWorkspaceRuntimeState,
  initializeDesktopWorkspaceRuntimeState,
  installDesktopWorkspaceRuntimePromise,
  retryDesktopWorkspaceRuntime,
  type DesktopLocalStateModule,
  type DesktopReviewedProductionModule,
  type DesktopWorkspaceRuntime,
  type DesktopWorkspaceRuntimeState,
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
      productionLifecycle: null,
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
    setProductionMode: vi.fn(),
    produceReviewedMeasurements: vi.fn(),
    createNextBatch: vi.fn(),
    exportEvidence: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('Electron private Workspace runtime host', () => {
  it('passes a lazy main-process scanner without loading parser code at startup', async () => {
    const privateRuntime = runtime()
    let scanCanonicalCandidates!: Parameters<DesktopLocalStateModule['initializeDesktopWorkspaceRuntimeV1']>[0]['scanCanonicalCandidates']
    const initialize = vi.fn<DesktopLocalStateModule['initializeDesktopWorkspaceRuntimeV1']>(async options => {
      expect(options.backend).toBe('windows-dpapi')
      expect(options.platform).toEqual({ os: 'windows', architecture: 'x64' })
      expect(options.metroraVersion).toBe('0.9.20')
      expect(options.collectorVersion).toBe('0.9.20')
      expect(options.capabilities).toEqual(['collect', 'normalize', 'aggregate', 'serve-local-api'])
      expect(await options.safeStorage.isAvailable()).toBe(true)
      scanCanonicalCandidates = options.scanCanonicalCandidates
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
    const scan = vi.fn(async () => ({ candidates: [], withheldCount: 3, failedCount: 1 }))
    const importReviewedProductionModule = vi.fn(async (_url: string) => ({
      scanCanonicalReviewedProductionCandidatesV1: scan,
    } satisfies DesktopReviewedProductionModule))

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
      importReviewedProductionModule,
    })

    expect(result).toMatchObject({
      status: 'ready',
      endpointId: 'endpoint_test',
      identityGeneration: 2,
      masterKeyState: 'loaded',
      backend: 'windows-dpapi',
    })
    expect(result.status === 'ready' && result.runtime).toBe(privateRuntime)
    expect(importReviewedProductionModule).not.toHaveBeenCalled()

    const input = {
      endpointId: 'endpoint_test',
      adapterVersion: '0.9.20',
      notBefore: '2026-08-02T00:00:00.000Z',
    }
    await expect(scanCanonicalCandidates(input)).resolves.toEqual({
      candidates: [],
      withheldCount: 3,
      failedCount: 1,
    })
    await scanCanonicalCandidates(input)

    expect(importReviewedProductionModule).toHaveBeenCalledTimes(1)
    expect(importReviewedProductionModule.mock.calls[0]?.[0]).toContain('desktop-reviewed-production.js')
    expect(scan).toHaveBeenCalledTimes(2)
    expect(scan).toHaveBeenNthCalledWith(1, input)
  })

  it('resolves packaged and development scanner paths independently', () => {
    expect(desktopReviewedProductionModulePath({
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      appPath: 'C:\\repo\\app',
    })).toContain('resources')
    expect(desktopReviewedProductionModulePath({
      isPackaged: false,
      resourcesPath: 'C:\\app\\resources',
      appPath: 'C:\\repo\\app',
    })).toContain('build')
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
    const importReviewedProductionModule = vi.fn()
    await expect(initializeDesktopWorkspaceRuntimeState({
      platform: 'win32',
      isPackaged: false,
      resourcesPath: 'C:\\app\\resources',
      appPath: 'C:\\repo\\app',
      userDataPath: 'C:\\Users\\test\\Metrora',
      safeStorage: safeStorage(false),
      importModule,
      importReviewedProductionModule,
    })).resolves.toEqual({ status: 'unavailable', reason: 'vault-unavailable' })
    expect(importReviewedProductionModule).not.toHaveBeenCalled()
  })

  it('does not load signing or parser code on unsupported platforms', async () => {
    const importModule = vi.fn()
    const importReviewedProductionModule = vi.fn()
    await expect(initializeDesktopWorkspaceRuntimeState({
      platform: 'linux',
      isPackaged: false,
      resourcesPath: '/resources',
      appPath: '/repo/app',
      userDataPath: '/home/test/.config/Metrora',
      safeStorage: safeStorage(),
      importModule,
      importReviewedProductionModule,
    })).resolves.toEqual({ status: 'unsupported-platform', platform: 'linux' })
    expect(importModule).not.toHaveBeenCalled()
    expect(importReviewedProductionModule).not.toHaveBeenCalled()
  })

  it('classifies packaged, local-state and generic initialization failures separately', async () => {
    const base = {
      platform: 'win32' as const,
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      appPath: 'C:\\app',
      userDataPath: 'C:\\Users\\test\\Metrora',
      safeStorage: safeStorage(),
    }

    await expect(initializeDesktopWorkspaceRuntimeState({
      ...base,
      importModule: vi.fn(async () => { throw new Error('Cannot find packaged module') }),
    })).resolves.toEqual({ status: 'unavailable', reason: 'packaged-runtime-unavailable' })

    for (const [name, reason] of [
      ['DesktopLocalStateCorruptError', 'local-state-unavailable'],
      ['DesktopEncryptedStateUnreadableError', 'local-state-unavailable'],
      ['EndpointIdentityRecoveryRequiredError', 'local-state-unavailable'],
      ['UnexpectedError', 'initialization-failed'],
    ] as const) {
      const error = new Error('private diagnostic detail')
      error.name = name
      await expect(initializeDesktopWorkspaceRuntimeState({
        ...base,
        importModule: vi.fn(async () => ({
          initializeDesktopLocalStateV1: vi.fn(),
          initializeDesktopWorkspaceRuntimeV1: vi.fn(async () => { throw error }),
        })),
      })).resolves.toEqual({ status: 'unavailable', reason })
    }
  })

  it('retries a failed initialization with one new runtime attempt and never duplicates a live runtime', async () => {
    const privateRuntime = runtime()
    const initializer = vi.fn<() => Promise<DesktopWorkspaceRuntimeState>>()
    initializer
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'initialization-failed' })
      .mockResolvedValueOnce({
        status: 'ready',
        endpointId: 'endpoint_retry',
        publicKeyFingerprintSha256: 'b'.repeat(64),
        identityGeneration: 3,
        masterKeyState: 'loaded',
        backend: 'windows-dpapi',
        runtime: privateRuntime,
      })

    installDesktopWorkspaceRuntimePromise(
      Promise.resolve({ status: 'unavailable', reason: 'initialization-failed' }),
      initializer,
    )

    const firstRetry = retryDesktopWorkspaceRuntime()
    expect(retryDesktopWorkspaceRuntime()).toBe(firstRetry)
    await expect(firstRetry).resolves.toEqual({ status: 'unavailable', reason: 'initialization-failed' })
    await Promise.resolve()

    const secondRetry = retryDesktopWorkspaceRuntime()
    await expect(secondRetry).resolves.toMatchObject({ status: 'ready', runtime: privateRuntime })
    expect(initializer).toHaveBeenCalledTimes(2)

    const readyRetry = await retryDesktopWorkspaceRuntime()
    expect(readyRetry).toMatchObject({ status: 'ready', runtime: privateRuntime })
    expect(initializer).toHaveBeenCalledTimes(2)

    await disposeDesktopWorkspaceRuntime()
    await disposeDesktopWorkspaceRuntime()
    expect(privateRuntime.dispose).toHaveBeenCalledTimes(1)
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
