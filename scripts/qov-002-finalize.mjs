import { readFileSync, writeFileSync } from 'node:fs'

function read(path) { return readFileSync(path, 'utf8') }
function write(path, value) { writeFileSync(path, value) }
function once(source, from, to, label) {
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`)
  return source.replace(from, to)
}

// Renderer persistence: canonical reads and rollback-safe dual writes.
{
  const path = 'app/renderer/App.tsx'
  let s = read(path)
  s = once(s,
    "import { persistRefreshValue, readRefreshValue, refreshValueToMs, RefreshCadenceContext, type RefreshCadence } from './lib/refreshCadence'",
    "import { persistRefreshValue, readRefreshValue, refreshValueToMs, RefreshCadenceContext, type RefreshCadence } from './lib/refreshCadence'\nimport { readCompatStorage, removeCompatStorage, writeCompatStorage } from './lib/storage'",
    'App storage import')
  s = once(s,
`function initialPeriod(): Period {
  let saved: string | null = null
  try { saved = globalThis.localStorage?.getItem('codeburn.defaultPeriod') ?? null } catch { /* storage can be unavailable */ }
  return saved && isPeriod(saved) ? saved : 'today'
}`,
`function initialPeriod(): Period {
  const saved = readCompatStorage('defaultPeriod')
  return saved && isPeriod(saved) ? saved : 'today'
}`,
    'App initialPeriod')
  s = once(s,
`function initialConfigSource(): string | null {
  try { return globalThis.localStorage?.getItem('codeburn.claudeConfigSource') || null } catch { return null }
}

function persistConfigSource(id: string | null): void {
  try {
    if (id) globalThis.localStorage?.setItem('codeburn.claudeConfigSource', id)
    else globalThis.localStorage?.removeItem('codeburn.claudeConfigSource')
  } catch { /* storage can be unavailable */ }
}`,
`function initialConfigSource(): string | null {
  return readCompatStorage('claudeConfigSource') || null
}

function persistConfigSource(id: string | null): void {
  if (id) writeCompatStorage('claudeConfigSource', id)
  else removeCompatStorage('claudeConfigSource')
}`,
    'App config storage')
  s = once(s,
`  useEffect(() => {
    let saved: string | null = null
    try { saved = globalThis.localStorage?.getItem('codeburn.theme') ?? null } catch { /* storage can be unavailable */ }
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved)
    else document.documentElement.removeAttribute('data-theme')
  }, [])`,
`  useEffect(() => {
    const saved = readCompatStorage('theme')
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved)
    else document.documentElement.removeAttribute('data-theme')
  }, [])`,
    'App theme storage')
  s = once(s,
`  let dismissed: string | null = null
  try { dismissed = globalThis.localStorage?.getItem('codeburn.dailyBudget.dismissed') ?? null } catch { /* storage can be unavailable */ }`,
`  const dismissed = readCompatStorage('dailyBudget.dismissed')`,
    'App dismissed read')
  s = once(s,
`  const dismiss = () => {
    try { globalThis.localStorage?.setItem('codeburn.dailyBudget.dismissed', todayKey) } catch { /* storage can be unavailable */ }
    bumpDismiss(tick => tick + 1)
  }`,
`  const dismiss = () => {
    writeCompatStorage('dailyBudget.dismissed', todayKey)
    bumpDismiss(tick => tick + 1)
  }`,
    'App dismissed write')
  write(path, s)
}

{
  const path = 'app/renderer/sections/Settings.tsx'
  let s = read(path)
  s = once(s,
    "import { REFRESH_OPTIONS, useRefreshCadence } from '../lib/refreshCadence'",
    "import { REFRESH_OPTIONS, useRefreshCadence } from '../lib/refreshCadence'\nimport { readCompatStorage, writeCompatStorage } from '../lib/storage'",
    'Settings storage import')
  s = once(s,
`function readSetting(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}

function writeSetting(key: string, value: string): void {
  try { globalThis.localStorage?.setItem(key, value) } catch { /* storage can be unavailable in hardened contexts */ }
}`,
`function storageSuffix(key: string): string {
  if (key.startsWith('codeburn.')) return key.slice('codeburn.'.length)
  if (key.startsWith('qovrion.')) return key.slice('qovrion.'.length)
  return key
}

function readSetting(key: string): string | null {
  return readCompatStorage(storageSuffix(key))
}

function writeSetting(key: string, value: string): void {
  writeCompatStorage(storageSuffix(key), value)
}`,
    'Settings storage helpers')
  write(path, s)
}

// Canonical IPC requests and bidirectional main-process aliases.
{
  const path = 'app/electron/preload.ts'
  let s = read(path)
  s = s.replaceAll("invoke('codeburn:", "invoke('qovrion:")
  s = s.replaceAll("ipcRenderer.on('codeburn:", "ipcRenderer.on('qovrion:")
  s = s.replaceAll("ipcRenderer.removeListener('codeburn:", "ipcRenderer.removeListener('qovrion:")
  if (!s.includes("invoke('qovrion:getOverview'")) throw new Error('preload canonical IPC was not applied')
  write(path, s)
}

{
  const path = 'app/electron/main.ts'
  let s = read(path)
  s = once(s,
`export const PROGRESS_CHANNEL = 'codeburn:progress'
// IPC channel pushing update-availability status to open windows (launch + 24h).
export const UPDATE_CHANNEL = 'codeburn:update'`,
`export const PROGRESS_CHANNEL = 'qovrion:progress'
export const LEGACY_PROGRESS_CHANNEL = 'codeburn:progress'
// IPC channel pushing update-availability status to open windows (launch + 24h).
export const UPDATE_CHANNEL = 'qovrion:update'
export const LEGACY_UPDATE_CHANNEL = 'codeburn:update'`,
    'main event channels')
  s = once(s,
`function broadcastProgress(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PROGRESS_CHANNEL, event)
  }
}`,
`function broadcastProgress(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(PROGRESS_CHANNEL, event)
    win.webContents.send(LEGACY_PROGRESS_CHANNEL, event)
  }
}`,
    'main progress broadcast')
  s = once(s,
`function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(UPDATE_CHANNEL, status)
  }
}`,
`function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(UPDATE_CHANNEL, status)
    win.webContents.send(LEGACY_UPDATE_CHANNEL, status)
  }
}`,
    'main update broadcast')
  s = once(s,
    "extraEnv: { CODEBURN_PROGRESS: '1' },",
    "extraEnv: { QOVRION_PROGRESS: '1', CODEBURN_PROGRESS: '1' },",
    'main progress env')
  s = once(s,
`function registerHandlers(): void {
  const handlers = createBridgeHandlers()
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args))
  }
  ipcMain.handle('codeburn:chooseDirectory', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return { ok: true, value: res.canceled ? null : (res.filePaths[0] ?? null) }
  })`,
`export function ipcChannelAliases(channel: string): string[] {
  if (!channel.startsWith('codeburn:')) return [channel]
  return [channel.replace(/^codeburn:/, 'qovrion:'), channel]
}

function registerHandlers(): void {
  const handlers = createBridgeHandlers()
  for (const [channel, handler] of Object.entries(handlers)) {
    for (const alias of ipcChannelAliases(channel)) {
      ipcMain.handle(alias, (_event, ...args) => handler(...args))
    }
  }
  const chooseDirectory = async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return { ok: true, value: res.canceled ? null : (res.filePaths[0] ?? null) }
  }
  for (const channel of ipcChannelAliases('codeburn:chooseDirectory')) ipcMain.handle(channel, chooseDirectory)`,
    'main handler aliases')
  s = once(s,
`  if (app.isPackaged) {
    process.env.CODEBURN_BUNDLED_CLI = path.join(process.resourcesPath, 'cli', 'dist', 'launch.js')
  }`,
`  if (app.isPackaged) {
    const bundledCli = path.join(process.resourcesPath, 'cli', 'dist', 'launch.js')
    process.env.QOVRION_BUNDLED_CLI = bundledCli
    if (process.env.CODEBURN_BUNDLED_CLI === undefined) process.env.CODEBURN_BUNDLED_CLI = bundledCli
  }`,
    'main packaged CLI env')
  write(path, s)
}

// Commander help is Qovrion-first; the npm codeburn bin remains an alias.
{
  const path = 'src/main.ts'
  let s = read(path)
  s = once(s, ".name('codeburn')", ".name('qovrion')", 'Commander name')
  write(path, s)
}
