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
import { AdvisorCredentialStore } from './advisor-credentials'
import { createAdvisorHostedHandlers, type AdvisorHostedEvent } from './advisor-provider'
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
        await Promise.race([Promise.all([flush.catch(() => false), stopShare.catch(() => false)]), timeout])
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
// Local conversational text only. Planning JSON, tool output, provider text,
// and evidence payloads never use this channel.
export const ADVISOR_DELTA_CHANNEL = 'metrora:advisorDelta'
// Renderer-safe lifecycle projection for the single accepted Harness action.
export const HARNESS_ACTION_EVENT_CHANNEL = 'metrora:harnessActionEvent'

function broadcastProgress(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(PROGRESS_CHANNEL, event)
  }
}
function projectAdvisorDelta(event: { requestId: string; text: string }): { requestId: string; text: string } {
  const requestId = event.requestId.replace(/[^A-Za-z0-9._:-]/gu, '').slice(0, 128)
  const text = event.text
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|\b(?:file|vscode-file):\/\/[^\s"'<>|]+)/giu, '[redacted]')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|password|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu, '[redacted]')
    .replace(/\bbearer\s+[^\s,;]+/giu, '[redacted]')
    .replace(/(?<![\p{L}\p{N}])(?:raw[_ -]?(?:prompt|response|source)|source[_ -]?(?:code|snippet|content))(?![\p{L}\p{N}])/giu, '[redacted]')
    .slice(0, 4_000)
  return { requestId, text }
}
function broadcastAdvisorDelta(event: { requestId: string; text: string }): void {
  const projected = projectAdvisorDelta(event)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(ADVISOR_DELTA_CHANNEL, projected)
  }
}

function broadcastHarnessActionEvent(event: HarnessActionEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(HARNESS_ACTION_EVENT_CHANNEL, event)
  }
}

function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(UPDATE_CHANNEL, status)
  }
}

export const ADVISOR_HOSTED_EVENT_CHANNEL = 'metrora:advisorHostedEvent'
type AdvisorHostedRendererEvent = Pick<AdvisorHostedEvent, 'requestId' | 'provider' | 'model' | 'kind' | 'usage' | 'streamed' | 'code'>
export function projectAdvisorHostedEvent(event: AdvisorHostedEvent): AdvisorHostedRendererEvent {
  return {
    requestId: event.requestId.slice(0, 120),
    provider: event.provider,
    model: event.model.replace(/[^A-Za-z0-9._:/-]/gu, '').slice(0, 160),
    kind: event.kind,
    ...(event.usage ? { usage: { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, totalTokens: event.usage.totalTokens } } : {}),
    ...(event.streamed !== undefined ? { streamed: event.streamed } : {}),
    ...(event.code ? { code: event.code.replace(/[^A-Za-z0-9._:-]/gu, '').slice(0, 80) } : {}),
  }
}
function broadcastAdvisorHostedEvent(event: AdvisorHostedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(ADVISOR_HOSTED_EVENT_CHANNEL, projectAdvisorHostedEvent(event))
  }
}

export function ipcChannelAliases(channel: string): string[] {
  return [channel]
}

export function shouldInstallApplicationMenu(_isDev: boolean, platform = process.platform): boolean {
  return platform === 'darwin'
}

function registerHandlers(): void {
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
  const advisorCredentials = new AdvisorCredentialStore({
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => safeStorage.isEncryptionAvailable(),
      encryptStringAsync: plaintext => safeStorage.encryptStringAsync(plaintext),
      decryptStringAsync: ciphertext => safeStorage.decryptStringAsync(ciphertext),
      getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend(),
    },
  })
  const advisorHostedHandlers = createAdvisorHostedHandlers({
    credentialStatus: provider => advisorCredentials.status(provider),
    readCredential: provider => advisorCredentials.readSecret(provider),
    emitEvent: broadcastAdvisorHostedEvent,
  })
  const harnessActHandlers = createHarnessActHandlers({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    emit: broadcastHarnessActionEvent,
  })
  const handlers = createBridgeHandlers({
    spawnCli,
    spawnCliAction,
    resolveMetroraPath,
    getQuota,
    emitProgress: broadcastProgress,
    emitAdvisorDelta: broadcastAdvisorDelta,
    telemetry: telemetryInstance,
    getUpdateStatus: () => updateChecker ? updateChecker.getStatus() : Promise.resolve(NO_UPDATE_STATUS),
    share,
    advisorCredentials,
    advisorHostedHandlers,
    harnessActHandlers,
  })
  const trustedRendererIpcChannels = new Set([
    'metrora:advisorHostedProbe',
    'metrora:advisorHostedChat',
    'metrora:advisorHostedCancel',
    'metrora:advisorCredentialStatus',
    'metrora:advisorCredentialSet',
    'metrora:advisorCredentialClear',
    'metrora:harnessProposeCoreCompatibility',
    'metrora:harnessApproveCoreCompatibility',
    'metrora:harnessCancelCoreCompatibility',
    'metrora:harnessReadCoreCompatibility',
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
    quit: () => app.quit(),
  }))

  void app.whenReady().then(() => {
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
    registerHandlers()
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
