import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type HarnessActionEvent = {
  actionId: string
  kind: 'run-core-compatibility'
  status: 'proposed' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unavailable'
  model: string
  originatingSurface: 'desktop'
  runtime: { id: string }
  proposalDigest: string
  pack: { selector: string; packId: string; version: string; checks: number; digest: string }
  checks: { planned: number; completed: number }
  progress: { planned: number; completed: number }
  cancellation: { requested: boolean }
  timeout: { perRequestMs: number; operationMs: number; triggered: boolean }
  result: { history: 'saved' | 'duplicate'; counts: { planned: number; attempted: number; passed: number; failed: number; unavailable: number; timedOut: number; cancelled: number } } | null
  evidence: { available: boolean; history: 'saved' | 'duplicate' } | null
  failure: { category: string; message: string } | null
  updatedAt: string
}

type HarnessActBridge = {
  proposeCoreCompatibility(model: string, target?: 'ollama-local' | 'llama-server'): Promise<HarnessActionEvent>
  approveAndExecuteCoreCompatibility(input: { actionId: string; proposalDigest: string; signal?: AbortSignal }): Promise<HarnessActionEvent>
  cancelCoreCompatibility(actionId: string): Promise<HarnessActionEvent | null>
  readCoreCompatibility(actionId: string): Promise<HarnessActionEvent | null>
}

type DesktopActBridgeModule = {
  createMetroraHarnessActBridge(options?: {
    actionsDir?: string
    dataDir?: string
    emit?: (event: HarnessActionEvent) => void
  }): HarnessActBridge
}

type ImportModule = (url: string) => Promise<DesktopActBridgeModule>
type ModulePathDeps = { isPackaged: boolean; resourcesPath: string; appPath: string }

export type HarnessActHandlerOptions = ModulePathDeps & {
  actionsDir?: string
  dataDir?: string
  emit?: (event: HarnessActionEvent) => void
  importModule?: ImportModule
}

type HandlerEnvelope<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } }

export function harnessActBridgeModulePath(deps: ModulePathDeps): string {
  return deps.isPackaged
    ? join(deps.resourcesPath, 'cli.asar', 'dist', 'act-desktop-bridge.js')
    : join(deps.appPath, 'build', 'cli', 'dist', 'act-desktop-bridge.js')
}

export async function loadHarnessActBridge(
  deps: ModulePathDeps,
  options: { actionsDir?: string; dataDir?: string; emit?: (event: HarnessActionEvent) => void } = {},
  importModule: ImportModule = async url => import(url) as Promise<DesktopActBridgeModule>,
): Promise<HarnessActBridge> {
  const module = await importModule(pathToFileURL(harnessActBridgeModulePath(deps)).href)
  if (typeof module.createMetroraHarnessActBridge !== 'function') throw new Error('bundled Harness ACT bridge is invalid')
  return module.createMetroraHarnessActBridge(options)
}

function safeError(error: unknown): { kind: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|\b(?:file|vscode-file):\/\/[^\s"'<>|]+)/giu, '[redacted]')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|password|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu, '[redacted]')
    .replace(/[\r\n]+/gu, ' ')
    .trim()
    .slice(0, 240)
  return { kind: 'harness-action', message: message || 'Harness action could not be completed.' }
}

export function createHarnessActHandlers(options: HarnessActHandlerOptions): Record<string, (...args: any[]) => Promise<HandlerEnvelope<unknown>>> {
  let bridgePromise: Promise<HarnessActBridge> | null = null
  const getBridge = (): Promise<HarnessActBridge> => {
    bridgePromise ??= loadHarnessActBridge(
      options,
      { actionsDir: options.actionsDir, dataDir: options.dataDir, emit: options.emit },
      options.importModule,
    )
    return bridgePromise
  }
  const call = async <T>(work: (bridge: HarnessActBridge) => Promise<T>): Promise<HandlerEnvelope<T>> => {
    try {
      return { ok: true, value: await work(await getBridge()) }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  }
  return {
    'metrora:harnessProposeCoreCompatibility': async (model: unknown, target: unknown) => {
      if (target !== undefined && target !== 'ollama-local' && target !== 'llama-server') {
        return { ok: false, error: { kind: 'validation', message: 'Unsupported Harness action target.' } }
      }
      const selectedTarget: 'ollama-local' | 'llama-server' = target === 'llama-server' ? 'llama-server' : 'ollama-local'
      return call(bridge => bridge.proposeCoreCompatibility(typeof model === 'string' ? model : '', selectedTarget))
    },
    'metrora:harnessApproveCoreCompatibility': async (actionId: unknown, proposalDigest: unknown) => call(bridge => bridge.approveAndExecuteCoreCompatibility({
      actionId: typeof actionId === 'string' ? actionId : '',
      proposalDigest: typeof proposalDigest === 'string' ? proposalDigest : '',
    })),
    'metrora:harnessCancelCoreCompatibility': async (actionId: unknown) => call(bridge => bridge.cancelCoreCompatibility(typeof actionId === 'string' ? actionId : '')),
    'metrora:harnessReadCoreCompatibility': async (actionId: unknown) => call(async bridge => {
      const record = await bridge.readCoreCompatibility(typeof actionId === 'string' ? actionId : '')
      return record
    }),
  }
}
