import { describe, expect, it, vi } from 'vitest'

const { initializeBase, reconcile } = vi.hoisted(() => ({
  initializeBase: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('./local-state/desktop-host.js', () => ({
  DesktopEncryptedStateUnreadableError: class DesktopEncryptedStateUnreadableError extends Error {},
  DesktopLocalStateCorruptError: class DesktopLocalStateCorruptError extends Error {},
  DesktopVaultUnavailableError: class DesktopVaultUnavailableError extends Error {},
  initializeDesktopLocalStateV1: vi.fn(),
  initializeDesktopWorkspaceRuntimeV1: initializeBase,
}))

vi.mock('./local-state/workspace-software-reconciliation.js', () => ({
  reconcileLocalWorkspaceSoftwareV1: reconcile,
}))

import { initializeDesktopWorkspaceRuntimeV1 } from './desktop-local-state-entry.js'

describe('packaged desktop local-state entry', () => {
  it('disposes the runtime when post-initialization reconciliation fails', async () => {
    const runtime = { dispose: vi.fn() }
    initializeBase.mockResolvedValue({
      endpoint: {
        endpointId: 'ep_test',
        generation: 1,
        publicKeyFingerprintSha256: 'a'.repeat(64),
      },
      masterKeyState: 'loaded',
      backend: 'windows-dpapi',
      runtime,
    })
    const failure = new Error('workspace reconciliation failed')
    reconcile.mockRejectedValue(failure)

    await expect(initializeDesktopWorkspaceRuntimeV1({
      backend: 'windows-dpapi',
      safeStorage: {
        isAvailable: vi.fn(async () => true),
        encryptString: vi.fn(async () => Buffer.from('sealed')),
        decryptString: vi.fn(async () => ({ result: 'plain', shouldReEncrypt: false })),
      },
      dataDir: 'C:\\state',
      platform: { os: 'windows', architecture: 'x64' },
      metroraVersion: '1.0.0',
      collectorVersion: '1.0.0',
    })).rejects.toBe(failure)

    expect(runtime.dispose).toHaveBeenCalledOnce()
  })
})
