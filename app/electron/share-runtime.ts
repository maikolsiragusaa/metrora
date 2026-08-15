import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type PendingPairing = { id: string; name: string; code: string }
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
  pending: PendingPairing[]
}

export type DesktopShareRuntime = {
  status(): Promise<DesktopShareStatus>
  start(always: boolean): Promise<DesktopShareStatus>
  stop(): Promise<DesktopShareStatus>
  approve(id: string, approve: boolean): Promise<DesktopShareStatus>
}

export type DesktopShareRuntimeModule = {
  createDesktopShareRuntime(port?: number): Promise<DesktopShareRuntime>
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
  importModule: (url: string) => Promise<DesktopShareRuntimeModule> = async url => import(url) as Promise<DesktopShareRuntimeModule>,
): Promise<DesktopShareRuntime> {
  const module = await importModule(pathToFileURL(desktopShareRuntimeModulePath(deps)).href)
  if (typeof module.createDesktopShareRuntime !== 'function') {
    throw new Error('bundled desktop share runtime is invalid')
  }
  return module.createDesktopShareRuntime(7777)
}

export function initializeDesktopShareRuntime(deps: DesktopShareRuntimePathDeps): DesktopShareRuntime {
  desktopShareRuntimePromise = loadDesktopShareRuntime(deps)
  return {
    status: () => desktopShareRuntimePromise!.then(runtime => runtime.status()),
    start: always => desktopShareRuntimePromise!.then(runtime => runtime.start(always)),
    stop: () => desktopShareRuntimePromise!.then(runtime => runtime.stop()),
    approve: (id, approve) => desktopShareRuntimePromise!.then(runtime => runtime.approve(id, approve)),
  }
}

export function stopDesktopShareRuntime(): Promise<unknown> {
  return desktopShareRuntimePromise
    ? desktopShareRuntimePromise.then(runtime => runtime.stop())
    : Promise.resolve()
}
