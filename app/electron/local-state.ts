import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type ElectronSafeStorageLike = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plaintext: string): Promise<Buffer>
  decryptStringAsync(ciphertext: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export type DesktopLocalStateResult =
  | {
      status: 'ready'
      endpointId: string
      publicKeyFingerprintSha256: string
      identityGeneration: number
      masterKeyState: 'created' | 'loaded' | 'rewrapped'
      backend: 'windows-dpapi' | 'macos-keychain'
    }
  | { status: 'unsupported-platform'; platform: NodeJS.Platform }

export type DesktopLocalStateModule = {
  initializeDesktopLocalStateV1(options: {
    safeStorage: {
      isAvailable(): Promise<boolean>
      encryptString(plaintext: string): Promise<Uint8Array>
      decryptString(ciphertext: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }>
    }
    backend: 'windows-dpapi' | 'macos-keychain'
    dataDir: string
  }): Promise<{
    endpoint: {
      endpointId: string
      generation: number
      publicKeyFingerprintSha256: string
    }
    masterKeyState: 'created' | 'loaded' | 'rewrapped'
    backend: 'windows-dpapi' | 'macos-keychain'
  }>
}

export type InitializeDesktopEndpointStateDeps = {
  platform: NodeJS.Platform
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  userDataPath: string
  safeStorage: ElectronSafeStorageLike
  importModule?: (url: string) => Promise<DesktopLocalStateModule>
}

export function desktopVaultBackend(platform: NodeJS.Platform): 'windows-dpapi' | 'macos-keychain' | undefined {
  if (platform === 'win32') return 'windows-dpapi'
  if (platform === 'darwin') return 'macos-keychain'
  return undefined
}

export function desktopLocalStateModulePath(
  deps: Pick<InitializeDesktopEndpointStateDeps, 'isPackaged' | 'resourcesPath' | 'appPath'>,
): string {
  return deps.isPackaged
    ? join(deps.resourcesPath, 'cli', 'dist', 'desktop-local-state.js')
    : join(deps.appPath, 'build', 'cli', 'dist', 'desktop-local-state.js')
}

export async function initializeDesktopEndpointState(
  deps: InitializeDesktopEndpointStateDeps,
): Promise<DesktopLocalStateResult> {
  const backend = desktopVaultBackend(deps.platform)
  if (!backend) return { status: 'unsupported-platform', platform: deps.platform }

  const importModule = deps.importModule ?? (async url => import(url) as Promise<DesktopLocalStateModule>)
  const modulePath = desktopLocalStateModulePath(deps)
  const runtime = await importModule(pathToFileURL(modulePath).href)
  if (typeof runtime.initializeDesktopLocalStateV1 !== 'function') {
    throw new Error('bundled desktop local-state runtime is invalid')
  }

  const initialized = await runtime.initializeDesktopLocalStateV1({
    backend,
    dataDir: join(deps.userDataPath, 'qovrion-local-state'),
    safeStorage: {
      isAvailable: () => deps.safeStorage.isAsyncEncryptionAvailable(),
      encryptString: plaintext => deps.safeStorage.encryptStringAsync(plaintext),
      decryptString: ciphertext => deps.safeStorage.decryptStringAsync(Buffer.from(ciphertext)),
    },
  })

  return {
    status: 'ready',
    endpointId: initialized.endpoint.endpointId,
    publicKeyFingerprintSha256: initialized.endpoint.publicKeyFingerprintSha256,
    identityGeneration: initialized.endpoint.generation,
    masterKeyState: initialized.masterKeyState,
    backend: initialized.backend,
  }
}
