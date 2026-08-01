import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type ElectronSafeStorageLike = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plaintext: string): Promise<Buffer>
  decryptStringAsync(ciphertext: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export type DesktopWorkspaceSnapshot = {
  kind: 'metrora.desktop-workspace-snapshot'
  version: 1
  localOnly: true
  identity: {
    endpointId: string
    generation: number
    publicKeyFingerprintSha256: string
  }
  workspace: null | {
    workspaceId: string
    displayName: string
    slug: string
    ownership: 'personal'
    status: 'active'
    ownerRole: 'owner'
    endpoint: {
      endpointId: string
      displayName: string
      os: 'windows' | 'macos' | 'linux' | 'android' | 'other'
      architecture: 'x64' | 'arm64' | 'arm' | 'other'
      identityGeneration: number
      publicKeyFingerprintSha256: string
      metroraVersion: string
      collectorVersion: string
      capabilities: Array<'collect' | 'normalize' | 'aggregate' | 'serve-local-api' | 'read-companion-api'>
      enrollmentState: 'active'
    }
  }
  productionLifecycle: null | {
    mode: 'active' | 'paused'
    revision: number
    persisted: boolean
    updatedAt: string | null
  }
  evidence: {
    state: 'workspace-required' | 'empty' | 'ready' | 'acknowledged' | 'quarantined' | 'blocked'
    pendingEventCount: number
    unbatchedEventCount: number
    acknowledgedEventCount: number
    invalidEventCount: number
    quarantinedEventCount: number
    pendingBatchCount: number
    acknowledgedBatchCount: number
    blockers: string[]
  }
  privacy: {
    networkRequired: false
    promptsIncluded: false
    responsesIncluded: false
    sourceCodeIncluded: false
    secretsIncluded: false
    unrestrictedLocalPathsIncluded: false
  }
}

export type DesktopWorkspaceRuntime = {
  getSnapshot(): Promise<DesktopWorkspaceSnapshot>
  createWorkspace(input: {
    displayName: string
    slug?: string
    endpointDisplayName: string
  }): Promise<{ outcome: 'created' | 'existing'; snapshot: DesktopWorkspaceSnapshot }>
  setProductionMode(mode: 'active' | 'paused'): Promise<{
    outcome: 'changed' | 'unchanged'
    snapshot: DesktopWorkspaceSnapshot
  }>
  createNextBatch(): Promise<{
    outcome: 'created' | 'empty'
    batch?: {
      batchId: string
      batchSha256: string
      firstSequence: number
      lastSequence: number
      eventCount: number
      identityGeneration: number
    }
    snapshot: DesktopWorkspaceSnapshot
  }>
  exportEvidence(outputPath: string): Promise<{
    outputPath: string
    verification: {
      workspaceId: string
      endpointId: string
      endpointIdentityGeneration: number
      exportedAt: string
      batchCount: number
      eventCount: number
      pendingBatchCount: number
      acknowledgedBatchCount: number
      latestBatchSha256?: string
    }
    snapshot: DesktopWorkspaceSnapshot
  }>
  dispose(): void
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

export type DesktopWorkspaceRuntimeState =
  | {
      status: 'ready'
      endpointId: string
      publicKeyFingerprintSha256: string
      identityGeneration: number
      masterKeyState: 'created' | 'loaded' | 'rewrapped'
      backend: 'windows-dpapi' | 'macos-keychain'
      runtime: DesktopWorkspaceRuntime
    }
  | { status: 'unsupported-platform'; platform: NodeJS.Platform }
  | { status: 'unavailable'; reason: 'vault-unavailable' | 'initialization-failed' }

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
  initializeDesktopWorkspaceRuntimeV1(options: {
    safeStorage: {
      isAvailable(): Promise<boolean>
      encryptString(plaintext: string): Promise<Uint8Array>
      decryptString(ciphertext: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }>
    }
    backend: 'windows-dpapi' | 'macos-keychain'
    dataDir: string
    platform: {
      os: 'windows' | 'macos' | 'linux' | 'android' | 'other'
      architecture: 'x64' | 'arm64' | 'arm' | 'other'
    }
    metroraVersion: string
    collectorVersion: string
    capabilities: Array<'collect' | 'normalize' | 'aggregate' | 'serve-local-api'>
  }): Promise<{
    endpoint: {
      endpointId: string
      generation: number
      publicKeyFingerprintSha256: string
    }
    masterKeyState: 'created' | 'loaded' | 'rewrapped'
    backend: 'windows-dpapi' | 'macos-keychain'
    runtime: DesktopWorkspaceRuntime
  }>
}

export type InitializeDesktopEndpointStateDeps = {
  platform: NodeJS.Platform
  arch?: string
  appVersion?: string
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  userDataPath: string
  legacyUserDataPath?: string
  safeStorage: ElectronSafeStorageLike
  importModule?: (url: string) => Promise<DesktopLocalStateModule>
}

let workspaceRuntimePromise: Promise<DesktopWorkspaceRuntimeState> = Promise.resolve({
  status: 'unavailable',
  reason: 'initialization-failed',
})

export function installDesktopWorkspaceRuntimePromise(
  promise: Promise<DesktopWorkspaceRuntimeState>,
): void {
  workspaceRuntimePromise = promise
}

export function getDesktopWorkspaceRuntimeState(): Promise<DesktopWorkspaceRuntimeState> {
  return workspaceRuntimePromise
}

export async function disposeDesktopWorkspaceRuntime(): Promise<void> {
  const state = await workspaceRuntimePromise.catch(() => undefined)
  if (state?.status === 'ready') state.runtime.dispose()
}

export function desktopVaultBackend(platform: NodeJS.Platform): 'windows-dpapi' | 'macos-keychain' | undefined {
  if (platform === 'win32') return 'windows-dpapi'
  if (platform === 'darwin') return 'macos-keychain'
  return undefined
}

function endpointOs(platform: NodeJS.Platform): 'windows' | 'macos' | 'linux' | 'other' {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  return 'other'
}

function endpointArchitecture(arch: string): 'x64' | 'arm64' | 'arm' | 'other' {
  if (arch === 'x64' || arch === 'arm64' || arch === 'arm') return arch
  return 'other'
}

export function desktopLocalStateModulePath(
  deps: Pick<InitializeDesktopEndpointStateDeps, 'isPackaged' | 'resourcesPath' | 'appPath'>,
): string {
  return deps.isPackaged
    ? join(deps.resourcesPath, 'cli', 'dist', 'desktop-local-state.js')
    : join(deps.appPath, 'build', 'cli', 'dist', 'desktop-local-state.js')
}

/**
 * Copy old Qovrion desktop state into Metrora once. The source is never moved,
 * modified or deleted. A failed readable-state migration is surfaced instead
 * of silently creating a fresh identity.
 */
export function adoptLegacyDesktopLocalState(options: {
  userDataPath: string
  legacyUserDataPath?: string
}): { dataDir: string; adoptedFrom: string | null } {
  const canonical = join(options.userDataPath, 'metrora-local-state')
  if (existsSync(canonical)) return { dataDir: canonical, adoptedFrom: null }

  const legacyRoot = options.legacyUserDataPath ?? join(dirname(options.userDataPath), 'Qovrion')
  const candidates = [
    join(legacyRoot, 'qovrion-local-state'),
    join(options.userDataPath, 'qovrion-local-state'),
  ]
  for (const legacy of candidates) {
    if (!existsSync(legacy)) continue
    try {
      mkdirSync(dirname(canonical), { recursive: true })
      cpSync(legacy, canonical, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
      return { dataDir: canonical, adoptedFrom: legacy }
    } catch (error) {
      if (existsSync(canonical)) return { dataDir: canonical, adoptedFrom: legacy }
      throw new Error(`failed to adopt legacy Qovrion desktop state: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { dataDir: canonical, adoptedFrom: null }
}

function safeStorageAdapter(deps: InitializeDesktopEndpointStateDeps) {
  return {
    isAvailable: () => deps.safeStorage.isAsyncEncryptionAvailable(),
    encryptString: (plaintext: string) => deps.safeStorage.encryptStringAsync(plaintext),
    decryptString: (ciphertext: Uint8Array) => deps.safeStorage.decryptStringAsync(Buffer.from(ciphertext)),
  }
}

async function loadRuntimeModule(deps: InitializeDesktopEndpointStateDeps): Promise<DesktopLocalStateModule> {
  const importModule = deps.importModule ?? (async url => import(url) as Promise<DesktopLocalStateModule>)
  const modulePath = desktopLocalStateModulePath(deps)
  return importModule(pathToFileURL(modulePath).href)
}

function localStateDataDir(deps: InitializeDesktopEndpointStateDeps): string {
  return adoptLegacyDesktopLocalState({
    userDataPath: deps.userDataPath,
    legacyUserDataPath: deps.legacyUserDataPath,
  }).dataDir
}

export async function initializeDesktopEndpointState(
  deps: InitializeDesktopEndpointStateDeps,
): Promise<DesktopLocalStateResult> {
  const backend = desktopVaultBackend(deps.platform)
  if (!backend) return { status: 'unsupported-platform', platform: deps.platform }

  const runtime = await loadRuntimeModule(deps)
  if (typeof runtime.initializeDesktopLocalStateV1 !== 'function') {
    throw new Error('bundled desktop local-state runtime is invalid')
  }
  const initialized = await runtime.initializeDesktopLocalStateV1({
    backend,
    dataDir: localStateDataDir(deps),
    safeStorage: safeStorageAdapter(deps),
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

export async function initializeDesktopWorkspaceRuntimeState(
  deps: InitializeDesktopEndpointStateDeps,
): Promise<DesktopWorkspaceRuntimeState> {
  const backend = desktopVaultBackend(deps.platform)
  if (!backend) return { status: 'unsupported-platform', platform: deps.platform }

  try {
    const module = await loadRuntimeModule(deps)
    if (typeof module.initializeDesktopWorkspaceRuntimeV1 !== 'function') {
      throw new Error('bundled desktop Workspace runtime is invalid')
    }
    const version = deps.appVersion?.trim() || '0.0.0'
    const initialized = await module.initializeDesktopWorkspaceRuntimeV1({
      backend,
      dataDir: localStateDataDir(deps),
      safeStorage: safeStorageAdapter(deps),
      platform: {
        os: endpointOs(deps.platform),
        architecture: endpointArchitecture(deps.arch ?? process.arch),
      },
      metroraVersion: version,
      collectorVersion: version,
      capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
    })
    return {
      status: 'ready',
      endpointId: initialized.endpoint.endpointId,
      publicKeyFingerprintSha256: initialized.endpoint.publicKeyFingerprintSha256,
      identityGeneration: initialized.endpoint.generation,
      masterKeyState: initialized.masterKeyState,
      backend: initialized.backend,
      runtime: initialized.runtime,
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return {
      status: 'unavailable',
      reason: name === 'DesktopVaultUnavailableError' ? 'vault-unavailable' : 'initialization-failed',
    }
  }
}