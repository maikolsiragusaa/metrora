import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { runtimePaths, writeRuntimeFiles, writeUsageSnapshot, type OpenCodeRuntimePaths } from './config'
import { sanitizeUsageSnapshot } from './snapshot'
import {
  OPENCODE_COMMIT,
  OPENCODE_CUSTOM_TOOL_ID,
  OPENCODE_LOOPBACK_HOST,
  OPENCODE_VERSION,
  OpenCodeError,
  type OpenCodeConnection,
  type OpenCodeRuntimeState,
  type OpenCodeRuntimeStatus,
} from './types'

const DEFAULT_HEALTH_TIMEOUT_MS = 12_000
const DEFAULT_POLL_INTERVAL_MS = 100
const REQUEST_TIMEOUT_MS = 1_000
const STOP_TIMEOUT_MS = 1_500
const SNAPSHOT_INTERVAL_MS = 30_000
const SERVER_USERNAME = 'metrora'

export type SpawnedOpenCodeProcess = {
  exitCode: number | null
  once: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => unknown
  removeListener?: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => unknown
  kill: (signal?: NodeJS.Signals | number) => boolean
}

export type OpenCodeSpawnOptions = {
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: ['ignore', 'ignore', 'ignore']
  windowsHide: boolean
}

export type OpenCodeFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

export type OpenCodeRuntimeOptions = {
  appPath: string
  resourcesPath: string
  userDataPath: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  arch?: string
  executableOverride?: string
  workingDirectory?: string
  spawnProcess?: (file: string, args: string[], options: OpenCodeSpawnOptions) => SpawnedOpenCodeProcess
  fetchImpl?: OpenCodeFetch
  acquirePort?: () => Promise<number>
  readUsageSnapshot?: () => Promise<unknown>
  now?: () => number
  randomPassword?: () => string
  healthTimeoutMs?: number
  pollIntervalMs?: number
}

export type OpenCodeExecutableResolution = Pick<OpenCodeRuntimeOptions, 'appPath' | 'resourcesPath' | 'isPackaged'> & {
  platform?: NodeJS.Platform
  arch?: string
  executableOverride?: string
}

/** Resolve only the deterministic staged binary; never search PATH. */
export function resolveOpenCodeExecutable(options: OpenCodeExecutableResolution): string | null {
  if (options.executableOverride && !path.isAbsolute(options.executableOverride)) return null
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const binary = platform === 'win32' ? 'opencode.exe' : 'opencode'
  const target = `${platform}-${arch}`
  const root = options.isPackaged
    ? path.join(options.resourcesPath, 'opencode')
    : path.join(options.appPath, 'build', 'opencode')
  const candidate = options.executableOverride ?? path.join(root, OPENCODE_VERSION, target, binary)
  try {
    return statSync(candidate).isFile() ? path.resolve(candidate) : null
  } catch {
    return null
  }
}

export function buildOpenCodeServerArgs(port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new OpenCodeError('bad-port', 'OpenCode loopback port is invalid.')
  return ['serve', '--hostname', OPENCODE_LOOPBACK_HOST, '--port', String(port)]
}

export function createLaunchEnvironment(options: {
  baseEnv?: NodeJS.ProcessEnv
  paths: OpenCodeRuntimePaths
  username: string
  password: string
}): NodeJS.ProcessEnv {
  return {
    ...(options.baseEnv ?? process.env),
    OPENCODE_SERVER_USERNAME: options.username,
    OPENCODE_SERVER_PASSWORD: options.password,
    OPENCODE_CONFIG_DIR: options.paths.runtimeDir,
    OPENCODE_CONFIG: options.paths.configPath,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    METRORA_USAGE_SNAPSHOT_FILE: options.paths.snapshotPath,
  }
}

export async function freeLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, OPENCODE_LOOPBACK_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function abortAfter(parent: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)])
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ensureInitialSnapshot(paths: OpenCodeRuntimePaths): Promise<void> {
  try {
    await access(paths.snapshotPath)
  } catch {
    try { await writeUsageSnapshot(paths, sanitizeUsageSnapshot(undefined, new Date())) } catch { /* best effort; the tool reports unavailable */ }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function responseJson(response: Response, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await response.text()
  if (text.length > maxBytes) throw new OpenCodeError('protocol', 'OpenCode response exceeded the bounded verification size.')
  try { return JSON.parse(text) as unknown } catch { throw new OpenCodeError('protocol', 'OpenCode returned invalid verification JSON.') }
}

async function waitForExit(child: SpawnedOpenCodeProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      if (child.removeListener) {
        child.removeListener('exit', finish)
        child.removeListener('error', finish)
      }
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    child.once('exit', finish)
    child.once('error', finish)
  })
}

export class OpenCodeRuntime {
  private state: OpenCodeRuntimeState = 'idle'
  private detail: string | null = null
  private customToolRegistered: boolean | null = null
  private child: SpawnedOpenCodeProcess | null = null
  private connection: OpenCodeConnection | null = null
  private startupAbort: AbortController | null = null
  private startPromise: Promise<OpenCodeRuntimeStatus> | null = null
  private stopPromise: Promise<void> | null = null
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  private snapshotPromise: Promise<void> | null = null

  constructor(private readonly options: OpenCodeRuntimeOptions) {}

  status(): OpenCodeRuntimeStatus {
    return {
      state: this.state,
      version: OPENCODE_VERSION,
      commit: OPENCODE_COMMIT,
      customToolRegistered: this.customToolRegistered,
      detail: this.detail,
    }
  }

  /** Main-process-only access to the current Basic Auth material. */
  getConnection(): OpenCodeConnection | null {
    return this.connection ? { ...this.connection } : null
  }

  async start(): Promise<OpenCodeRuntimeStatus> {
    if (this.state === 'ready') return this.status()
    if (this.startPromise) return this.startPromise
    if (this.stopPromise) await this.stopPromise

    const promise = this.startInternal()
    this.startPromise = promise
    try {
      return await promise
    } finally {
      if (this.startPromise === promise) this.startPromise = null
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    const promise = this.stopInternal()
    this.stopPromise = promise
    try {
      await promise
    } finally {
      if (this.stopPromise === promise) this.stopPromise = null
    }
  }

  private async startInternal(): Promise<OpenCodeRuntimeStatus> {
    if (this.state === 'ready') return this.status()
    this.state = 'starting'
    this.detail = null
    this.customToolRegistered = null
    const abort = new AbortController()
    this.startupAbort = abort
    const paths = runtimePaths(this.options.userDataPath)

    try {
      const executable = resolveOpenCodeExecutable(this.options)
      if (!executable) throw new OpenCodeError('not-staged', `OpenCode ${OPENCODE_VERSION} is not staged for this platform.`)

      await writeRuntimeFiles(paths)
      await ensureInitialSnapshot(paths)
      // Usage reconciliation can be slow and is not needed to launch the
      // bundled OpenCode UI. Keep it off the activation critical path.
      void this.refreshSnapshot(paths).catch(() => {})
      const port = this.options.acquirePort ? await this.options.acquirePort() : await freeLoopbackPort()
      const args = buildOpenCodeServerArgs(port)
      const password = this.options.randomPassword?.() ?? randomBytes(32).toString('hex')
      if (!password || password.length < 32) throw new OpenCodeError('auth', 'OpenCode launch credentials could not be generated.')
      const origin = `http://${OPENCODE_LOOPBACK_HOST}:${port}`
      const auth = basicAuth(SERVER_USERNAME, password)
      const child = (this.options.spawnProcess ?? ((file, childArgs, spawnOptions) => spawn(file, childArgs, spawnOptions) as unknown as SpawnedOpenCodeProcess))(
        executable,
        args,
        {
          cwd: this.options.workingDirectory ?? this.options.appPath,
          env: createLaunchEnvironment({ paths, username: SERVER_USERNAME, password }),
          stdio: ['ignore', 'ignore', 'ignore'],
          windowsHide: true,
        },
      )
      this.child = child
      const onExit = () => {
        if (this.child !== child || this.state === 'stopping' || this.state === 'idle') return
        this.child = null
        this.connection = null
        this.stopSnapshotTimer()
        this.state = 'unavailable'
        this.customToolRegistered = null
        this.detail = 'The bundled OpenCode server stopped.'
      }
      child.once('exit', onExit)
      child.once('error', onExit)

      const reportedVersion = await this.waitForHealth(origin, auth, abort.signal)
      if (reportedVersion !== OPENCODE_VERSION) {
        throw new OpenCodeError('version-mismatch', `OpenCode version verification failed; expected ${OPENCODE_VERSION}.`)
      }
      const registered = await this.verifyCustomTool(origin, auth, abort.signal)
      this.customToolRegistered = registered
      if (!registered) throw new OpenCodeError('custom-tool', `OpenCode did not register ${OPENCODE_CUSTOM_TOOL_ID}.`)
      if (abort.signal.aborted) throw new OpenCodeError('cancelled', 'OpenCode startup cancelled.')

      this.connection = { origin, username: SERVER_USERNAME, password }
      this.state = 'ready'
      this.detail = null
      this.startSnapshotTimer(paths)
      return this.status()
    } catch (error) {
      this.connection = null
      this.stopSnapshotTimer()
      const child = this.child
      this.child = null
      try { child?.kill() } catch { /* best effort */ }
      if (child) await waitForExit(child, STOP_TIMEOUT_MS)
      this.state = 'unavailable'
      this.customToolRegistered = error instanceof OpenCodeError && error.kind === 'custom-tool' ? false : this.customToolRegistered
      this.detail = error instanceof OpenCodeError && error.kind !== 'protocol'
        ? error.message
        : 'OpenCode could not be started.'
      return this.status()
    } finally {
      if (this.startupAbort === abort) this.startupAbort = null
    }
  }

  private async waitForHealth(origin: string, authorization: string, signal: AbortSignal): Promise<string> {
    const fetchImpl = this.options.fetchImpl ?? ((url, init) => fetch(url, init))
    const now = this.options.now ?? Date.now
    const deadline = now() + (this.options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS)
    while (now() < deadline) {
      if (signal.aborted) throw new OpenCodeError('cancelled', 'OpenCode startup cancelled.')
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) throw new OpenCodeError('runtime', 'OpenCode server exited during startup.')
      try {
        const response = await fetchImpl(`${origin}/global/health`, { headers: { Authorization: authorization }, signal: abortAfter(signal, REQUEST_TIMEOUT_MS) })
        if (response.ok) {
          const value = await responseJson(response)
          if (isRecord(value) && value.healthy === true) {
            if (typeof value.version !== 'string') throw new OpenCodeError('version-mismatch', `OpenCode version verification failed; expected ${OPENCODE_VERSION}.`)
            return value.version
          }
        }
      } catch (error) {
        if (error instanceof OpenCodeError && error.kind === 'version-mismatch') throw error
        if (signal.aborted) throw new OpenCodeError('cancelled', 'OpenCode startup cancelled.')
      }
      await sleep(this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    }
    throw new OpenCodeError('timeout', 'OpenCode server did not become healthy.')
  }

  private async verifyCustomTool(origin: string, authorization: string, signal: AbortSignal): Promise<boolean> {
    const fetchImpl = this.options.fetchImpl ?? ((url, init) => fetch(url, init))
    const response = await fetchImpl(`${origin}/experimental/tool/ids`, { headers: { Authorization: authorization }, signal: abortAfter(signal, REQUEST_TIMEOUT_MS) })
    if (!response.ok) throw new OpenCodeError('custom-tool', 'OpenCode tool discovery was unavailable.')
    const value = await responseJson(response)
    if (!Array.isArray(value)) throw new OpenCodeError('custom-tool', 'OpenCode tool discovery returned an invalid response.')
    return value.slice(0, 1_000).every(item => typeof item === 'string') && value.includes(OPENCODE_CUSTOM_TOOL_ID)
  }

  private async refreshSnapshot(paths: OpenCodeRuntimePaths): Promise<void> {
    if (this.snapshotPromise) return this.snapshotPromise
    const promise = (async () => {
      let raw: unknown = undefined
      try { raw = await this.options.readUsageSnapshot?.() } catch { /* unavailable becomes a clean bounded snapshot */ }
      await writeUsageSnapshot(paths, sanitizeUsageSnapshot(raw, new Date()))
    })()
    this.snapshotPromise = promise
    try {
      await promise
    } finally {
      if (this.snapshotPromise === promise) this.snapshotPromise = null
    }
  }

  private startSnapshotTimer(paths: OpenCodeRuntimePaths): void {
    this.stopSnapshotTimer()
    this.snapshotTimer = setInterval(() => {
      if (this.state === 'ready') void this.refreshSnapshot(paths).catch(() => {})
    }, SNAPSHOT_INTERVAL_MS)
    this.snapshotTimer.unref?.()
  }

  private stopSnapshotTimer(): void {
    if (!this.snapshotTimer) return
    clearInterval(this.snapshotTimer)
    this.snapshotTimer = null
  }

  private async stopInternal(): Promise<void> {
    this.state = this.state === 'idle' ? 'idle' : 'stopping'
    this.startupAbort?.abort()
    const startup = this.startPromise
    if (startup) await startup.catch(() => undefined)
    this.stopSnapshotTimer()
    const child = this.child
    this.child = null
    this.connection = null
    if (child) {
      try { child.kill() } catch { /* best effort */ }
      await waitForExit(child, STOP_TIMEOUT_MS)
    }
    this.customToolRegistered = null
    this.detail = null
    this.state = 'idle'
  }
}
