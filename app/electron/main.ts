import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { resolveMetroraPath, shutdownCli, spawnCli, spawnCliAction } from './cli'
import { createApplicationMenuTemplate } from './menu'
import { getQuota } from './quota'
import { saveShareCardPng } from './share-card-export'
import { initializeDesktopShareRuntime, stopDesktopShareRuntime } from './share-runtime'
import { Telemetry } from './telemetry'
import { createUpdateChecker, type UpdateChecker, type UpdateStatus } from './updates'
import { createBridgeHandlers, NO_UPDATE_STATUS } from './bridge-handlers'
import { harnessProviderRoute, hostedProviderRoute } from './harness-runtime-types.js'
import type { HarnessHostedProvider, HarnessReasoningEffort, HarnessRuntimeId, MetroraHarnessRuntimeEvent } from './harness-runtime-types.js'
import { createHarnessActHandlers, type HarnessActionEvent } from './act-bridge'

export { createApplicationMenuTemplate } from './menu'
export { createBridgeHandlers, makeProgressReader } from './bridge-handlers'
export type { Envelope, TelemetryBridge } from './bridge-handlers'

// Initialized in bootstrap() once Electron paths exist; stays null under tests.
let telemetryInstance: Telemetry | null = null
// The once-per-launch + 24h update-availability checker. Null under tests.
let updateChecker: UpdateChecker | null = null

type QuitTelemetry = Pick<Telemetry, 'trackClose' | 'flush'>
type BeforeQuitEvent = { preventDefault: () => void }
type BeforeQuitDeps = {
  getTelemetry: () => QuitTelemetry | null
  killAll: () => void
  stopShare?: () => Promise<unknown>
  stopHarness?: () => Promise<unknown>
  quit: () => void
  timeoutMs?: number
}

const QUIT_FLUSH_TIMEOUT_MS = 1500

/** Intercept one quit pass, then allow the re-entrant pass after a bounded flush. */
export function createBeforeQuitHandler(deps: BeforeQuitDeps): (event: BeforeQuitEvent) => void {
  let flushStarted = false
  let allowQuit = false
  let closeTracked = false

  return event => {
    if (allowQuit) return
    try { event.preventDefault() } catch { /* keep the quit path moving */ }
    if (flushStarted) return
    flushStarted = true

    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        try { deps.killAll() } catch { /* child cleanup must not wedge quit */ }

        const stopShare = deps.stopShare ? Promise.resolve().then(deps.stopShare).catch(() => false) : Promise.resolve(false)
        const stopHarness = deps.stopHarness ? Promise.resolve().then(deps.stopHarness).catch(() => false) : Promise.resolve(false)

        let telemetry: QuitTelemetry | null = null
        try { telemetry = deps.getTelemetry() } catch { /* telemetry lookup is best-effort */ }

        let flush: Promise<unknown> = Promise.resolve(false)
        if (telemetry) {
          if (!closeTracked) {
            closeTracked = true
            try { telemetry.trackClose() } catch { /* flush the existing queue anyway */ }
          }
          try { flush = Promise.resolve(telemetry.flush()) } catch { /* use the resolved fallback */ }
        }

        const timeout = new Promise<void>(resolve => {
          timer = setTimeout(resolve, deps.timeoutMs ?? QUIT_FLUSH_TIMEOUT_MS)
        })
        await Promise.race([Promise.all([flush.catch(() => false), stopShare.catch(() => false), stopHarness.catch(() => false)]), timeout])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        allowQuit = true
        try { deps.quit() } catch { /* a throwing quit call must not reset the guard */ }
      }
    })()
  }
}

// IPC channel carrying cold-start scan-progress events to the splash.
export const PROGRESS_CHANNEL = 'metrora:progress'
// IPC channel pushing update-availability status to open windows (launch + 24h).
export const UPDATE_CHANNEL = 'metrora:update'
// Renderer-safe lifecycle projection for the single accepted Harness action.
export const HARNESS_ACTION_EVENT_CHANNEL = 'metrora:harnessActionEvent'
// Renderer-safe projection of DSH lifecycle state; raw event names, arguments,
// provider payloads, and private reasoning never cross this channel.
export const HARNESS_RUNTIME_EVENT_CHANNEL = 'metrora:harnessRuntimeEvent'

function broadcastProgress(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(PROGRESS_CHANNEL, event)
  }
}
function broadcastHarnessActionEvent(event: HarnessActionEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(HARNESS_ACTION_EVENT_CHANNEL, event)
  }
}

function broadcastHarnessRuntimeEvent(event: MetroraHarnessRuntimeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(HARNESS_RUNTIME_EVENT_CHANNEL, event)
  }
}

function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(UPDATE_CHANNEL, status)
  }
}

export function ipcChannelAliases(channel: string): string[] {
  return [channel]
}

export function shouldInstallApplicationMenu(_isDev: boolean, platform = process.platform): boolean {
  return platform === 'darwin'
}

type HarnessRuntimeHost = {
  shutdown(): Promise<void>
  handlers(): Record<string, (...args: any[]) => Promise<{ ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }>>
}
let harnessHostInstance: HarnessRuntimeHost | null = null

function throwIfHarnessAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Metrora Harness read cancelled.')
  error.name = 'AbortError'
  throw error
}

function harnessScopeArgs(scope: { period: string; range: { from: string; to: string } | null; provider: string; projectId: string }): string[] {
  return [
    '--period', scope.period,
    ...(scope.range ? ['--from', scope.range.from, '--to', scope.range.to] : []),
    ...(scope.provider !== 'all' ? ['--provider', scope.provider] : []),
    ...(scope.projectId !== 'all' ? ['--metrora-project', scope.projectId] : []),
  ]
}

async function registerHandlers(): Promise<void> {
  const [runtimeModule, toolsModule, credentialModule, profileModule, workspaceModule, localModule, hostedModule] = await Promise.all([
    import('./harness-runtime.mjs'),
    import('./canonical-metrora-tools.mjs'),
    import('./harness-credentials.mjs'),
    import('./harness-profile.mjs'),
    import('./harness-workspace.mjs'),
    import('./local-runtime.mjs'),
    import('./harness-hosted-adapter.mjs'),
  ])
  const { MetroraHarnessHost } = runtimeModule
  const { loadMetroraHarnessToolRegistry } = toolsModule
  const { HarnessCredentialStore } = credentialModule
  const { HarnessRuntimeProfileStore } = profileModule
  const { canonicalizeWorkspaceRoot, HarnessWorkspaceAuthority, HarnessWorkspaceStateStore } = workspaceModule
  const { llamaServerEndpointFromPort, probeLMStudioMain, probeLlamaServerMain, probeOllamaMain } = localModule
  const { MetroraHostedLlmAdapter, probeHostedProvider } = hostedModule
  const canonicalToolsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'cli.asar', 'dist', 'metrora-tools.js')
    : path.join(app.getAppPath(), '..', 'dist', 'metrora-tools.js')
  const toolRegistry = await loadMetroraHarnessToolRegistry(canonicalToolsPath)
  const share = initializeDesktopShareRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  }, {
    // Android receives only the same sanitized ProviderQuotaSnapshot array
    // already used by Desktop. It never receives provider credentials or
    // invokes provider endpoints itself.
    getCapacity: () => getQuota(),
  })
  const harnessCredentials = new HarnessCredentialStore({
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => safeStorage.isEncryptionAvailable(),
      encryptStringAsync: plaintext => safeStorage.encryptStringAsync(plaintext),
      decryptStringAsync: ciphertext => safeStorage.decryptStringAsync(ciphertext),
    },
  })
  const harnessProfile = new HarnessRuntimeProfileStore(path.join(app.getPath('userData'), 'harness', 'profile'))
  await harnessProfile.load()
  const harnessWorkspace = new HarnessWorkspaceAuthority()
  const harnessWorkspaceState = new HarnessWorkspaceStateStore(path.join(app.getPath('userData'), 'harness', 'workspace'))
  await harnessWorkspaceState.recover(harnessWorkspace)
  const harnessHostedAdapter = new MetroraHostedLlmAdapter({
    readCredential: provider => harnessCredentials.readSecret(provider),
  })
  const probeFlights = new Map<HarnessRuntimeId, AbortController>()
  const hostedProbeFlights = new Map<HarnessHostedProvider, AbortController>()
  const reasoningByRouteModel = new Map<string, readonly HarnessReasoningEffort[]>()
  const reasoningKey = (route: string, model: string): string => `${route}\u0000${model}`
  const clearReasoningRoute = (route: string): void => {
    for (const key of reasoningByRouteModel.keys()) if (key.startsWith(`${route}\u0000`)) reasoningByRouteModel.delete(key)
  }
  const rememberReasoning = (route: string, rows: ReadonlyArray<{ modelId?: string; id?: string; reasoningEfforts?: HarnessReasoningEffort[] }>): void => {
    clearReasoningRoute(route)
    for (const row of rows) {
      const model = row.modelId ?? row.id
      if (model && row.reasoningEfforts?.length) reasoningByRouteModel.set(reasoningKey(route, model), Object.freeze([...row.reasoningEfforts]))
    }
  }
  const harnessProviderHandlers: Record<string, (...args: any[]) => Promise<any>> = {
    'metrora:harnessProbeLocal': async (runtime: unknown, requestedPort?: unknown) => {
      if (runtime !== 'ollama' && runtime !== 'lmstudio' && runtime !== 'llama-server') return { ok: false, error: { kind: 'bad-args', message: 'Invalid local Harness runtime.' } }
      const port = requestedPort === undefined ? harnessProfile.read().llamaServerPort : requestedPort
      if (runtime === 'llama-server') {
        if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65_535) return { ok: false, error: { kind: 'bad-args', message: 'llama.cpp port must be between 1 and 65535.' } }
        await harnessProfile.setPort(port)
      }
      const route = harnessProviderRoute(runtime as HarnessRuntimeId)
      clearReasoningRoute(route)
      probeFlights.get(runtime)?.abort()
      const controller = new AbortController()
      probeFlights.set(runtime, controller)
      try {
        const result = runtime === 'ollama'
          ? await probeOllamaMain(fetch, controller.signal)
          : runtime === 'lmstudio'
            ? await probeLMStudioMain(fetch, controller.signal)
            : await probeLlamaServerMain(fetch, controller.signal, llamaServerEndpointFromPort(port))
        rememberReasoning(route, result.capabilities)
        return { ok: true, value: result }
      } catch (error) {
        if (controller.signal.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Local Harness discovery was cancelled.' } }
        return { ok: false, error: { kind: 'unavailable', message: error instanceof Error ? error.message.slice(0, 240) : 'Local Harness discovery failed.' } }
      } finally {
        if (probeFlights.get(runtime) === controller) probeFlights.delete(runtime)
      }
    },
    'metrora:harnessCancelProbeLocal': async (runtime: unknown) => {
      if (runtime === 'ollama' || runtime === 'lmstudio' || runtime === 'llama-server') probeFlights.get(runtime)?.abort()
      return { ok: true, value: true }
    },
    'metrora:harnessProbeHosted': async (provider: unknown) => {
      if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini' && provider !== 'openrouter' && provider !== 'opencode-zen') return { ok: false, error: { kind: 'bad-args', message: 'Invalid hosted Harness provider.' } }
      const selectedProvider = provider as HarnessHostedProvider
      const route = hostedProviderRoute(selectedProvider)
      hostedProbeFlights.get(selectedProvider)?.abort()
      const controller = new AbortController()
      hostedProbeFlights.set(selectedProvider, controller)
      try {
        const result = await probeHostedProvider(selectedProvider, value => harnessCredentials.readSecret(value), fetch, controller.signal)
        rememberReasoning(route, result.models)
        return { ok: true, value: result }
      } catch (error) {
        clearReasoningRoute(route)
        if (controller.signal.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Hosted Harness discovery was cancelled.' } }
        throw error
      } finally {
        if (hostedProbeFlights.get(selectedProvider) === controller) hostedProbeFlights.delete(selectedProvider)
      }
    },
  }
  const harnessProfileHandlers: Record<string, (...args: any[]) => Promise<any>> = {
    'metrora:harnessProfileGet': async () => ({ ok: true, value: harnessProfile.read() }),
    'metrora:harnessProfileSetRuntime': async (runtime: unknown) => {
      if (runtime !== 'hosted' && runtime !== 'ollama' && runtime !== 'lmstudio' && runtime !== 'llama-server') return { ok: false, error: { kind: 'bad-args', message: 'Invalid Harness runtime.' } }
      return { ok: true, value: await harnessProfile.setRuntime(runtime) }
    },
    'metrora:harnessProfileSetPort': async (port: unknown) => {
      if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65_535) return { ok: false, error: { kind: 'bad-args', message: 'llama.cpp port must be between 1 and 65535.' } }
      return { ok: true, value: await harnessProfile.setPort(port) }
    },
    'metrora:harnessProfileSetLocalModel': async (runtime: unknown, model: unknown) => {
      if (runtime !== 'ollama' && runtime !== 'lmstudio' && runtime !== 'llama-server' || typeof model !== 'string') return { ok: false, error: { kind: 'bad-args', message: 'Invalid local Harness model selection.' } }
      return { ok: true, value: await harnessProfile.setLocalModel(runtime as HarnessRuntimeId, model) }
    },
    'metrora:harnessProfileSetHostedModel': async (provider: unknown, model: unknown) => {
      if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini' && provider !== 'openrouter' && provider !== 'opencode-zen' || typeof model !== 'string') return { ok: false, error: { kind: 'bad-args', message: 'Invalid hosted Harness model selection.' } }
      return { ok: true, value: await harnessProfile.setHostedModel(provider as HarnessHostedProvider, model) }
    },
    'metrora:harnessProfileSetReasoning': async (runtime: unknown, provider: unknown, model: unknown, effort: unknown) => {
      if (runtime !== 'hosted' && runtime !== 'ollama' && runtime !== 'lmstudio' && runtime !== 'llama-server' || provider !== null && provider !== undefined && provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini' && provider !== 'openrouter' && provider !== 'opencode-zen' || typeof model !== 'string' || effort !== 'min' && effort !== 'low' && effort !== 'medium' && effort !== 'high' && effort !== 'max') return { ok: false, error: { kind: 'bad-args', message: 'Invalid Harness reasoning selection.' } }
      const exactProvider = runtime === 'hosted' ? provider as HarnessHostedProvider : null
      return { ok: true, value: await harnessProfile.setReasoning(runtime as 'hosted' | HarnessRuntimeId, exactProvider, model, effort) }
    },
    'metrora:harnessProfileSetConsent': async (provider: unknown, state: unknown) => {
      if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini' && provider !== 'openrouter' && provider !== 'opencode-zen' || state !== 'unknown' && state !== 'accepted' && state !== 'declined') return { ok: false, error: { kind: 'bad-args', message: 'Invalid hosted consent state.' } }
      const current = harnessProfile.read()
      return { ok: true, value: await harnessProfile.update({ hostedConsentByProvider: { ...current.hostedConsentByProvider, [provider as HarnessHostedProvider]: state } }) }
    },
  }
  const harnessWorkspaceHandlers: Record<string, (...args: any[]) => Promise<any>> = {
    'metrora:harnessWorkspaceGet': async () => ({ ok: true, value: harnessWorkspace.current() }),
    'metrora:harnessWorkspaceOpen': async (root: unknown) => {
      try {
        const workspace = await harnessWorkspace.setRoot(root)
        await harnessWorkspaceState.save(await canonicalizeWorkspaceRoot(root), workspace.displayName)
        return { ok: true, value: workspace }
      } catch (error) { return { ok: false, error: { kind: 'bad-args', message: error instanceof Error ? error.message : 'Workspace could not be opened.' } } }
    },
    'metrora:harnessWorkspaceClear': async () => {
      harnessWorkspace.clear()
      await harnessWorkspaceState.save(null)
      return { ok: true, value: null }
    },
  }
  const harnessActHandlers = createHarnessActHandlers({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    emit: broadcastHarnessActionEvent,
  })
  harnessHostInstance = new MetroraHarnessHost({
    sessionRoot: path.join(app.getPath('userData'), 'harness', 'sessions'),
    profile: harnessProfile,
    hostedAdapter: harnessHostedAdapter,
    getWorkspaceRoot: () => harnessWorkspace.rootPath(),
    getReasoningEfforts: (route, model) => reasoningByRouteModel.get(reasoningKey(route, model)),
    toolSource: {
      getOverview: async (scope, signal) => {
        throwIfHarnessAborted(signal)
        const value = await spawnCli(['status', '--format', 'menubar-json', '--no-timeline', ...harnessScopeArgs(scope)], { extraEnv: { METRORA_READ_MODE: 'snapshot' } })
        throwIfHarnessAborted(signal)
        return value
      },
      getModels: async (scope, signal) => {
        throwIfHarnessAborted(signal)
        const value = await spawnCli(['models', '--format', 'json', ...harnessScopeArgs(scope)], { extraEnv: { METRORA_READ_MODE: 'snapshot' } })
        throwIfHarnessAborted(signal)
        return value
      },
      getQuota: async signal => {
        throwIfHarnessAborted(signal)
        const value = await getQuota()
        throwIfHarnessAborted(signal)
        return value
      },
      getBenchEvidence: async (scope, signal) => {
        throwIfHarnessAborted(signal)
        const value = await spawnCli(['bench', 'evidence', '--format', 'json', ...harnessScopeArgs(scope)], { extraEnv: { METRORA_READ_MODE: 'snapshot' } })
        throwIfHarnessAborted(signal)
        return value
      },
    },
    toolRegistry,
    onEvent: broadcastHarnessRuntimeEvent,
  })
  const handlers = createBridgeHandlers({
    spawnCli,
    spawnCliAction,
    resolveMetroraPath,
    getQuota,
    emitProgress: broadcastProgress,
    telemetry: telemetryInstance,
    getUpdateStatus: () => updateChecker ? updateChecker.getStatus() : Promise.resolve(NO_UPDATE_STATUS),
    share,
    harnessCredentials,
    harnessProviderHandlers,
    harnessProfileHandlers,
    harnessWorkspaceHandlers,
    harnessActHandlers,
    harnessHandlers: harnessHostInstance.handlers(),
  })
  const trustedRendererIpcChannels = new Set([
    'metrora:harnessProbeLocal',
    'metrora:harnessCancelProbeLocal',
    'metrora:harnessProbeHosted',
    'metrora:harnessCredentialStatus',
    'metrora:harnessCredentialSet',
    'metrora:harnessCredentialClear',
    'metrora:harnessProfileGet',
    'metrora:harnessProfileSetRuntime',
    'metrora:harnessProfileSetPort',
    'metrora:harnessProfileSetLocalModel',
    'metrora:harnessProfileSetHostedModel',
    'metrora:harnessProfileSetReasoning',
    'metrora:harnessProfileSetConsent',
    'metrora:harnessWorkspaceGet',
    'metrora:harnessWorkspaceOpen',
    'metrora:harnessWorkspaceClear',
    'metrora:harnessProposeCoreCompatibility',
    'metrora:harnessApproveCoreCompatibility',
    'metrora:harnessCancelCoreCompatibility',
    'metrora:harnessReadCoreCompatibility',
    'metrora:harnessListConversations',
    'metrora:harnessGetConversation',
    'metrora:harnessCreateConversation',
    'metrora:harnessSendMessage',
    'metrora:harnessCancel',
    'metrora:harnessApprove',
    'metrora:harnessDeny',
    'metrora:harnessCheckConformance',
    'metrora:runPerformanceBench',
    'metrora:cancelPerformanceBench',
    'metrora:chooseFile',
  ])
  function isTrustedRendererSender(event: { senderFrame?: { url?: string } | null }): boolean {
    const frameUrl = event.senderFrame?.url
    if (!frameUrl) return false
    try {
      const parsed = new URL(frameUrl)
      if (parsed.protocol === 'file:') return true
      const devUrl = process.env.VITE_DEV_SERVER_URL
      return Boolean(devUrl && new URL(devUrl).origin === parsed.origin)
    } catch {
      return false
    }
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    for (const alias of ipcChannelAliases(channel)) {
      ipcMain.handle(alias, (event, ...args) => {
        if (trustedRendererIpcChannels.has(channel) && !isTrustedRendererSender(event)) {
          return { ok: false, error: { kind: 'unauthorized', message: 'Trusted Metrora renderer required.' } }
        }
        return handler(...args)
      })
    }
  }
  ipcMain.handle('metrora:saveShareCardPng', async (event, suggestedName: string, pngDataUrl: string) => {
    if (!isTrustedRendererSender(event)) {
      return { ok: false, error: { kind: 'unauthorized', message: 'Share card export request is not from the trusted renderer.' } }
    }
    try {
      const value = await saveShareCardPng(suggestedName, pngDataUrl, {
        showSaveDialog: options => dialog.showSaveDialog(options),
        writeFile: (filePath, data) => writeFile(filePath, data),
      })
      return { ok: true, value }
    } catch {
      return { ok: false, error: { kind: 'bad-args', message: 'Share card PNG could not be saved.' } }
    }
  })
  const chooseDirectory = async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return { ok: true, value: res.canceled ? null : (res.filePaths[0] ?? null) }
  }
  ipcMain.handle('metrora:chooseDirectory', chooseDirectory)
  ipcMain.handle('metrora:chooseFile', async (event, kind: unknown) => {
    if (!isTrustedRendererSender(event)) return { ok: false, error: { kind: 'unauthorized', message: 'Trusted Metrora renderer required.' } }
    if (kind !== 'llama-bench' && kind !== 'gguf') return { ok: false, error: { kind: 'bad-args', message: 'invalid file picker kind' } }
    const filters = kind === 'gguf'
      ? [{ name: 'GGUF model', extensions: ['gguf'] }]
      : process.platform === 'win32'
        ? [{ name: 'llama-bench executable', extensions: ['exe'] }]
        : []
    const res = await dialog.showOpenDialog({ properties: ['openFile'], filters })
    return { ok: true, value: res.canceled ? null : (res.filePaths[0] ?? null) }
  })
  ipcMain.handle('open-external', (_event, url: string) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'https:' || protocol === 'http:') return shell.openExternal(url)
    } catch { /* malformed URL — refuse to open */ }
    return
  })
}

function installApplicationMenu(): void {
  const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL)
  Menu.setApplicationMenu(shouldInstallApplicationMenu(isDev)
    ? Menu.buildFromTemplate(createApplicationMenuTemplate(isDev))
    : null)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1013' : '#f5f6f8',
    // macOS: integrated title bar (traffic lights float over the sidebar), like
    // Linear/Hermes. Windows/Linux keep their native frame + window controls.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's default (kept explicit): when the window is minimized or fully
      // occluded the renderer's document.visibilityState flips to 'hidden' and a
      // visibilitychange fires. usePolled and the flame animation gate on that to
      // stop background CLI polls and compositor wakeups while hidden. A merely
      // unfocused-but-visible window stays 'visible' and keeps polling.
      backgroundThrottling: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // This window only ever renders the bundled renderer; block in-page navigation
  // and popups so a hijacked link can't turn it into a browser.
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl).catch(err => console.error('Failed to load dev server URL:', err))
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch(err => console.error('Failed to load renderer:', err))
  }

  return win
}

function bootstrap(): void {
  process.on('unhandledRejection', reason => {
    console.error('Unhandled promise rejection in main process:', reason)
  })

  // Packaged builds ship their own version-matched CLI under resources/cli (the
  // afterPack hook copies it in). Point the resolver at the launch shim before
  // any handler spawns; cli.ts runs it with Electron-as-node. The shim, not
  // cli.js, is the entry — it corrects argv for commander under Electron. Unset
  // in dev, where the repo build is used instead.
  if (app.isPackaged) {
    const bundledCli = path.join(process.resourcesPath, 'cli', 'dist', 'launch.js')
    process.env.METRORA_BUNDLED_CLI = bundledCli
    if (process.env.METRORA_BUNDLED_CLI === undefined) process.env.METRORA_BUNDLED_CLI = bundledCli
  }

  // A second launch focuses the running window instead of opening a rival one.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.on('before-quit', createBeforeQuitHandler({
    getTelemetry: () => telemetryInstance,
    killAll: shutdownCli,
    stopShare: stopDesktopShareRuntime,
    stopHarness: () => harnessHostInstance?.shutdown() ?? Promise.resolve(false),
    quit: () => app.quit(),
  }))

  void app.whenReady().then(async () => {
    // Consent-gated anonymous telemetry (desktop only). Nothing transmits until
    // the onboarding consent screen is completed and the toggle is on; EU/EEA/
    // UK/CH installs default the toggle off. Dev builds never send.
    try {
      telemetryInstance = new Telemetry({
        stateDir: app.getPath('userData'),
        country: app.getLocaleCountryCode() || null,
        isPackaged: app.isPackaged,
        appVersion: app.getVersion(),
      })
      // completeOnboarding tracks the first app_open itself; only already-
      // onboarded installs record subsequent opens here.
      if (telemetryInstance.status().onboarded) telemetryInstance.track('app_open', {})
      setInterval(() => { void telemetryInstance?.flush() }, 5 * 60_000)
    } catch (err) {
      console.error('telemetry init failed (continuing without):', err)
    }
    await registerHandlers()
    installApplicationMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // Update availability: check once at launch, then every 24h, pushing each
    // result to any open window. Never downloads/installs (unsigned builds);
    // errors are swallowed inside the checker as a silent no-op.
    updateChecker = createUpdateChecker({ currentVersion: app.getVersion() })
    const runUpdateCheck = () => { void updateChecker?.check().then(broadcastUpdateStatus) }
    runUpdateCheck()
    setInterval(runUpdateCheck, 24 * 60 * 60 * 1000)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

if (!process.env.VITEST) bootstrap()
