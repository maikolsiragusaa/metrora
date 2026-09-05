import {
  cancelAllBoundedProcesses,
  DEFAULT_MAX_OUTPUT_BYTES,
  runBoundedProcess,
  type TrustedProgressEvent,
} from './cli-watchdog'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

import {
  cliExecutableNames,
  METRORA_ENV,
  readPersistedCliPath,
} from './identity'

// This module runs entirely in Electron's main process and intentionally does
// not import Electron so it remains testable in plain Node.

export type CliErrorKind = 'not-found' | 'nonzero' | 'bad-json' | 'timeout' | 'too-large' | 'bad-args'
export type ActionResult = { ok: boolean; stdout: string; stderr: string; code: number | null; indeterminate?: boolean }
export type SpawnPriority = 'interactive' | 'background'
export type CliTarget = { kind: 'external'; bin: string } | { kind: 'bundled'; entry: string }
type SpawnSpec = { bin: string; args: string[]; env: NodeJS.ProcessEnv }

/** The only data the OpenCode custom-tool transport is allowed to inherit. */
export type MetroraToolBridgeSpec = {
  command: string[]
  environment: Record<string, string>
}

export type NotFoundStage =
  | 'bin-not-absolute'
  | 'bin-not-executable'
  | 'bundled-not-absolute'
  | 'bundled-missing'
  | 'spawn-error'
  | 'no-path-match'

export class CliError extends Error {
  readonly kind: CliErrorKind
  readonly detail?: NotFoundStage

  constructor(kind: CliErrorKind, message: string, detail?: NotFoundStage) {
    super(message)
    this.name = 'CliError'
    this.kind = kind
    this.detail = detail
  }
}

const DEFAULT_TIMEOUT_MS = 45_000
const MAX_OUTPUT_BYTES = DEFAULT_MAX_OUTPUT_BYTES
const COALESCE_TTL_MS = 5_000
const MAX_CONCURRENT_CLI = 2

const readInflight = new Map<string, Promise<unknown>>()
const readCache = new Map<string, { at: number; value: unknown }>()

type SlotWaiter = { resolve: (epoch: number) => void; reject: (err: unknown) => void; epoch: number }
let running = 0
let cancellationEpoch = 0
const interactiveQueue: SlotWaiter[] = []
const backgroundQueue: SlotWaiter[] = []
let shutdownRequested = false

function pumpSlots(): void {
  while (running < MAX_CONCURRENT_CLI) {
    const waiter = interactiveQueue.shift() ?? backgroundQueue.shift()
    if (!waiter) return
    running += 1
    waiter.resolve(waiter.epoch)
  }
}

function acquireSlot(priority: SpawnPriority): Promise<number> {
  if (shutdownRequested) return Promise.reject(new CliError('nonzero', 'Metrora is shutting down'))
  const epoch = cancellationEpoch
  return new Promise<number>((resolve, reject) => {
    ;(priority === 'background' ? backgroundQueue : interactiveQueue).push({ resolve, reject, epoch })
    pumpSlots()
  })
}

function releaseSlot(): void {
  running = Math.max(0, running - 1)
  pumpSlots()
}

/** Reap owned children and reject queued work during desktop shutdown. */
export function killAll(): void {
  cancellationEpoch += 1
  cancelAllBoundedProcesses()

  const waiting = [...interactiveQueue, ...backgroundQueue]
  interactiveQueue.length = 0
  backgroundQueue.length = 0
  running = 0
  for (const waiter of waiting) waiter.reject(new CliError('nonzero', 'Metrora cancelled'))
}

/** Production before-quit entry point: cancellation is terminal for this app process. */
export function shutdownCli(): void {
  shutdownRequested = true
  killAll()
}

/** Test-only reset for isolated renderer/main-process fixtures. */
export function resetCliShutdownForTests(): void {
  shutdownRequested = false
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function findExecutableInDir(dir: string): string | null {
  for (const name of cliExecutableNames()) {
    const candidate = join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/** Common Node installation directories used by GUI-launched desktop apps. */
export function nodeManagerDirs(): string[] {
  const home = homedir()
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.volta', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.asdf', 'shims'),
  ]

  const nvmDir = process.env.NVM_DIR || join(home, '.nvm')
  const nvmVersions = join(nvmDir, 'versions', 'node')
  try {
    const entries = readdirSync(nvmVersions).sort().reverse()
    for (const entry of entries) {
      const bin = join(nvmVersions, entry, 'bin')
      if (findExecutableInDir(bin)) {
        dirs.push(bin)
        break
      }
    }
  } catch {
    // nvm is optional.
  }
  return dirs
}

function searchDirs(): string[] {
  const override = process.env[METRORA_ENV.pathDirs]
  if (override !== undefined) return override.split(delimiter).filter(Boolean)
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  return [...pathDirs, ...nodeManagerDirs()]
}

/** Build a PATH that lets npm/nvm shims find the Node binary beside them. */
export function spawnEnvFor(bin: string): NodeJS.ProcessEnv {
  const parts = [dirname(bin), ...searchDirs(), ...(process.env.PATH || '').split(delimiter)]
  const seen = new Set<string>()
  const path = parts.filter(part => part && !seen.has(part) && (seen.add(part), true)).join(delimiter)
  return { ...process.env, PATH: path }
}

function isJavaScriptEntry(path: string): boolean {
  return /\.[cm]?js$/i.test(path)
}

/** Convert a resolved target into the exact child-process invocation. */
export function spawnSpecFor(target: CliTarget, args: string[]): SpawnSpec {
  const entry = target.kind === 'bundled' ? target.entry : target.bin
  if (target.kind === 'bundled' || isJavaScriptEntry(entry)) {
    // Electron's process.execPath can execute JavaScript portably when switched
    // into Node mode. This also covers the Vite dev CLI (`dist/cli.js`): spawning
    // that .js file directly works through a POSIX shebang but fails with EFTYPE
    // on Windows, where .js is not a native executable.
    return {
      bin: process.execPath,
      args: [entry, ...args],
      env: { ...spawnEnvFor(entry), ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  return { bin: target.bin, args, env: spawnEnvFor(target.bin) }
}

/**
 * Resolve the read-only Tools bridge once in Electron's main process. The
 * custom tool receives an argv vector, never a shell command, plus the one
 * runtime flag needed when the packaged CLI is launched by Electron.
 */
export function resolveMetroraToolBridgeSpec(): string | null {
  const target = resolveTarget()
  if (!target) return null
  const spec = spawnSpecFor(target, ['tools', 'call'])
  const command = [spec.bin, ...spec.args]
  if (command.length === 3) {
    if (!isAbsolute(command[0]!) || command[1] !== 'tools' || command[2] !== 'call') return null
  } else if (command.length === 4) {
    if (!isAbsolute(command[0]!) || !isAbsolute(command[1]!) || command[2] !== 'tools' || command[3] !== 'call') return null
  } else {
    return null
  }
  const environment: Record<string, string> = {}
  if (spec.env.ELECTRON_RUN_AS_NODE === '1') environment.ELECTRON_RUN_AS_NODE = '1'
  const bridge: MetroraToolBridgeSpec = { command, environment }
  const serialized = JSON.stringify(bridge)
  return Buffer.byteLength(serialized, 'utf8') <= 8 * 1024 ? serialized : null
}

function readPersistedPath(): string | null {
  return readPersistedCliPath({ isUsable: isExecutableFile })
}

/**
 * Resolution order:
 * METRORA_BIN → dev repository → packaged bundle → persisted canonical pointer → PATH.
 */
export function resolveTarget(): CliTarget | null {
  const override = process.env[METRORA_ENV.bin]
  if (override && isAbsolute(override) && isExecutableFile(override)) {
    return { kind: 'external', bin: override }
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    const devRepoRoot = process.env[METRORA_ENV.devRepoRoot]
    if (devRepoRoot) {
      const devBin = join(devRepoRoot, 'dist', 'cli.js')
      if (isExecutableFile(devBin)) return { kind: 'external', bin: devBin }
    } else {
      const emittedDevBin = join(__dirname, '..', '..', '..', 'dist', 'cli.js')
      if (isExecutableFile(emittedDevBin)) return { kind: 'external', bin: emittedDevBin }

      const sourceDevBin = join(__dirname, '..', '..', 'dist', 'cli.js')
      if (isExecutableFile(sourceDevBin)) return { kind: 'external', bin: sourceDevBin }
    }
  }

  const bundled = process.env[METRORA_ENV.bundledCli]
  if (bundled && isAbsolute(bundled) && isFile(bundled)) {
    return { kind: 'bundled', entry: bundled }
  }

  const persisted = readPersistedPath()
  if (persisted) return { kind: 'external', bin: persisted }

  for (const dir of searchDirs()) {
    const bin = findExecutableInDir(dir)
    if (bin) return { kind: 'external', bin }
  }
  return null
}

/** Canonical display/status resolver. */
export function resolveMetroraPath(): string | null {
  const target = resolveTarget()
  if (!target) return null
  return target.kind === 'bundled' ? target.entry : target.bin
}

/** Return a bounded, non-sensitive reason for a resolution failure. */
export function notFoundStage(): NotFoundStage {
  const override = process.env[METRORA_ENV.bin]
  if (override) {
    if (!isAbsolute(override)) return 'bin-not-absolute'
    if (!isExecutableFile(override)) return 'bin-not-executable'
  }

  const bundled = process.env[METRORA_ENV.bundledCli]
  if (bundled) {
    if (!isAbsolute(bundled)) return 'bundled-not-absolute'
    if (!isFile(bundled)) return 'bundled-missing'
  }
  return 'no-path-match'
}

function runCli(
  spec: SpawnSpec,
  cmdLabel: string,
  timeoutMs: number,
  onStderr?: (chunk: string) => void,
  idleTimeoutMs?: number,
  onProgress?: (event: TrustedProgressEvent) => void,
): Promise<unknown> {
  return runBoundedProcess(spec, {
    absoluteTimeoutMs: timeoutMs,
    idleTimeoutMs,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    onStderr,
    onProgress,
  }).then(result => {
    if (result.reason === 'timeout') {
      throw new CliError('timeout', `Metrora ${cmdLabel} timed out after ${timeoutMs}ms`)
    }
    if (result.reason === 'too-large') {
      throw new CliError('too-large', `Metrora ${cmdLabel} produced more than ${MAX_OUTPUT_BYTES} bytes`)
    }
    if (result.reason === 'cancelled') {
      throw new CliError('nonzero', 'Metrora cancelled')
    }
    if (result.error) {
      throw new CliError('not-found', result.error.message, 'spawn-error')
    }
    if (result.code !== 0) {
      throw new CliError('nonzero', result.stderr.trim() || `Metrora exited with code ${result.code ?? 'unknown'}`)
    }
    try {
      return JSON.parse(result.stdout)
    } catch {
      throw new CliError('bad-json', 'Metrora produced output that was not valid JSON')
    }
  })
}

/** Spawn a read-only CLI command with coalescing, bounded output and priority. */
export function spawnCli(
  args: string[],
  opts: {
    timeoutMs?: number
    idleTimeoutMs?: number
    onStderr?: (chunk: string) => void
    onProgress?: (event: TrustedProgressEvent) => void
    extraEnv?: NodeJS.ProcessEnv
    priority?: SpawnPriority
  } = {},
): Promise<unknown> {
  if (shutdownRequested) {
    return Promise.reject(new CliError('nonzero', 'Metrora is shutting down'))
  }
  const target = resolveTarget()
  if (!target) {
    return Promise.reject(new CliError('not-found', 'Metrora CLI not found', notFoundStage()))
  }

  const spec = spawnSpecFor(target, args)
  if (opts.extraEnv) spec.env = { ...spec.env, ...opts.extraEnv }

  // Environment overrides can change read semantics even when argv is equal
  // (notably canonical snapshot vs explicit fresh reconciliation). Keep those
  // lifecycles in separate in-flight/result-cache lanes while retaining stable
  // coalescing for truly identical requests.
  const envKey = Object.entries(opts.extraEnv ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  const key = JSON.stringify([spec.bin, ...spec.args, envKey, opts.timeoutMs ?? null, opts.idleTimeoutMs ?? null, Boolean(opts.onStderr), Boolean(opts.onProgress)])
  const cached = readCache.get(key)
  if (cached && Date.now() - cached.at < COALESCE_TTL_MS) return Promise.resolve(cached.value)

  const existing = readInflight.get(key)
  if (existing) return existing

  const priority = opts.priority ?? 'interactive'
  const flight = (async () => {
    const reservation = await acquireSlot(priority)
    try {
      if (shutdownRequested) throw new CliError('nonzero', 'Metrora is shutting down')
      if (reservation !== cancellationEpoch) throw new CliError('nonzero', 'Metrora cancelled')
      return await runCli(spec, args[0] ?? '', opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.onStderr, opts.idleTimeoutMs, opts.onProgress)
    } finally {
      releaseSlot()
    }
  })()
    .then(value => {
      readCache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => {
      readInflight.delete(key)
    })

  readInflight.set(key, flight)
  return flight
}

/** Spawn a mutating CLI command without read coalescing. */
export function spawnCliAction(
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (shutdownRequested) {
    return Promise.resolve({ ok: false, stdout: '', stderr: 'Metrora is shutting down', code: null })
  }
  const target = resolveTarget()
  if (!target) {
    return Promise.resolve({ ok: false, stdout: '', stderr: 'Metrora CLI not found', code: null })
  }

  const spec = spawnSpecFor(target, args)
  return (async () => {
    let reservation: number
    try {
      reservation = await acquireSlot('interactive')
    } catch {
      return { ok: false, stdout: '', stderr: 'Metrora cancelled', code: null }
    }

    try {
      if (shutdownRequested || reservation !== cancellationEpoch) {
        return { ok: false, stdout: '', stderr: shutdownRequested ? 'Metrora is shutting down' : 'Metrora cancelled', code: null }
      }
      return await runAction(spec, args, timeoutMs, opts.signal)
    } finally {
      releaseSlot()
    }
  })()
}

function runAction(spec: SpawnSpec, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<ActionResult> {
  return runBoundedProcess(spec, {
    absoluteTimeoutMs: timeoutMs,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    signal,
  }).then(result => {
    readCache.clear()

    if (result.reason === 'timeout') {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: `Metrora ${args[0] ?? ''} timed out after ${timeoutMs}ms`,
        code: null,
        indeterminate: true,
      }
    }
    if (result.reason === 'too-large') {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: `Metrora ${args[0] ?? ''} exceeded the bounded output limit`,
        code: null,
        indeterminate: true,
      }
    }
    if (result.reason === 'cancelled') {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: `Metrora ${args[0] ?? ''} was cancelled; completion is indeterminate`,
        code: null,
        indeterminate: true,
      }
    }
    if (result.error) {
      return { ok: false, stdout: result.stdout, stderr: result.error.message, code: null }
    }
    return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr, code: result.code }
  })
}
