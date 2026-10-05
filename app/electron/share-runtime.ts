import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type PendingPairing = { id: string; name: string; code: string }
/** Renderer-safe mirror of src/sharing/share-controller.ts PairedPeerSummary. */
export type PairedPeerSummary = { name: string; pairedAt: number }
export type DesktopShareStatus = {
  sharing: boolean
  name: string
  port: number
  host: string | null
  addresses: string[]
  connectPayload: string | null
  networkWarning?: string
  always: boolean
  peers: number
  peerList?: PairedPeerSummary[]
  pending: PendingPairing[]
}

export type DesktopShareRuntime = {
  status(): Promise<DesktopShareStatus>
  start(always: boolean): Promise<DesktopShareStatus>
  stop(): Promise<DesktopShareStatus>
  approve(id: string, approve: boolean): Promise<DesktopShareStatus>
  /** Read-only canonical Companion capability matrix (no secrets, no peer required). */
  capabilities(): Promise<DesktopCompanionCapabilities>
}

/** Renderer-safe mirror of CompanionCapabilitiesV1 (src/sharing/capability-contract.ts). */
export type DesktopCompanionCapability = {
  id: string
  versions: number[]
  availability: 'available' | 'unavailable'
  freshness: 'live' | 'cached' | 'unknown'
  scopes: { period: boolean; project: boolean; workspace: boolean }
  reason?: 'not-implemented' | 'no-authority' | 'unsupported'
}

export type DesktopCompanionCapabilities = {
  kind: 'metrora.companion.capabilities'
  version: 1
  generatedAt: string
  capabilities: DesktopCompanionCapability[]
}

export type DesktopShareRuntimeModule = {
  createDesktopShareRuntime(port?: number, options?: { getCapacity?: () => Promise<unknown> }): Promise<DesktopShareRuntime>
}

export type DesktopShareRuntimePathDeps = {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
}

let desktopShareRuntimePromise: Promise<DesktopShareRuntime> | null = null

export function desktopShareRuntimeModulePath(deps: DesktopShareRuntimePathDeps): string {
  return deps.isPackaged
    ? join(deps.resourcesPath, 'cli.asar', 'dist', 'desktop-share-runtime.js')
    : join(deps.appPath, 'build', 'cli', 'dist', 'desktop-share-runtime.js')
}

export async function loadDesktopShareRuntime(
  deps: DesktopShareRuntimePathDeps,
  options: { getCapacity?: () => Promise<unknown> } = {},
  importModule: (url: string) => Promise<DesktopShareRuntimeModule> = async url => import(url) as Promise<DesktopShareRuntimeModule>,
): Promise<DesktopShareRuntime> {
  const module = await importModule(pathToFileURL(desktopShareRuntimeModulePath(deps)).href)
  if (typeof module.createDesktopShareRuntime !== 'function') {
    throw new Error('bundled desktop share runtime is invalid')
  }
  return module.createDesktopShareRuntime(7777, options)
}

export function initializeDesktopShareRuntime(
  deps: DesktopShareRuntimePathDeps,
  options: { getCapacity?: () => Promise<unknown> } = {},
): DesktopShareRuntime {
  desktopShareRuntimePromise = loadDesktopShareRuntime(deps, options)
  return {
    status: () => desktopShareRuntimePromise!.then(runtime => runtime.status()),
    start: always => desktopShareRuntimePromise!.then(runtime => runtime.start(always)),
    stop: () => desktopShareRuntimePromise!.then(runtime => runtime.stop()),
    approve: (id, approve) => desktopShareRuntimePromise!.then(runtime => runtime.approve(id, approve)),
    capabilities: () => desktopShareRuntimePromise!.then(runtime => runtime.capabilities()),
  }
}

export function stopDesktopShareRuntime(): Promise<unknown> {
  return desktopShareRuntimePromise
    ? desktopShareRuntimePromise.then(runtime => runtime.stop())
    : Promise.resolve()
}
