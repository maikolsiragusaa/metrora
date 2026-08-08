import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

import {
  cliExecutableNames,
  compatEnv,
  LEGACY_COMPAT_ENV,
  METRORA_ENV,
  readPersistedCliPath,
} from './identity'

// This module runs entirely in Electron's main process and intentionally does
// not import Electron so it remains testable in plain Node.

export type CliErrorKind = 'not-found' | 'nonzero' | 'bad-json' | 'timeout' | 'too-large' | 'bad-args'
export type ActionResult = { ok: boolean; stdout: string; stderr: string; code: number | null }
export type SpawnPriority = 'interactive' | 'background'
export type CliTarget = { kind: 'external'; bin: string } | { kind: 'bundled'; entry: string }
type SpawnSpec = { bin: string; args: string[]; env: NodeJS.ProcessEnv }

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
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const COALESCE_TTL_MS = 5_000
const MAX_CONCURRENT_CLI = 2

const activeChildren = new Set<ChildProcess>()
const readInflight = new Map<string, Promise<unknown>>()
const readCache = new Map<string, { at: number; value: unknown }>()

type SlotWaiter = { resolve: () => void; reject: (err: unknown) => void }
let running = 0
const interactiveQueue: SlotWaiter[] = []
const backgroundQueue: SlotWaiter[] = []

function pumpSlots(): void {
  while (running < MAX_CONCURRENT_CLI) {
    const waiter = interactiveQueue.shift() ?? backgroundQueue.shift()
    if (!waiter) return
    running += 1
    waiter.resolve()
  }
}

function acquireSlot(priority: SpawnPriority): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ;(priority === 'background' ? backgroundQueue : interactiveQueue).push({ resolve, reject })
    pumpSlots()
  })
}

function releaseSlot(): void {
  running = Math.max(0, running - 1)
  pumpSlots()
}

/** Reap running children and reject queued work during desktop shutdown. */
export function killAll(): void {
  for (const child of activeChildren) child.kill('SIGKILL')
  activeChildren.clear()

  const waiting = [...interactiveQueue, ...backgroundQueue]
  interactiveQueue.length = 0
  backgroundQueue.length = 0
  running = 0
  for (const waiter of waiting) waiter.reject(new CliError('nonzero', 'Metrora cancelled'))
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
  const override = compatEnv(process.env, METRORA_ENV.pathDirs, LEGACY_COMPAT_ENV.pathDirs)
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

function readPersistedPath(): string | null {
  return readPersistedCliPath({ isUsable: isExecutableFile })?.value ?? null
}

/**
 * Resolution order:
 * METRORA_BIN plus compatibility fallback → dev repository → packaged bundle → persisted
 * canonical/legacy pointer → PATH. Canonical values always take precedence.
 */
export function resolveTarget(): CliTarget | null {
  const override = compatEnv(process.env, METRORA_ENV.bin, LEGACY_COMPAT_ENV.bin)
  if (override && isAbsolute(override) && isExecutableFile(override)) {
    return { kind: 'external', bin: override }
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    const devRepoRoot = compatEnv(process.env, METRORA_ENV.devRepoRoot, LEGACY_COMPAT_ENV.devRepoRoot)
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

  const bundled = compatEnv(process.env, METRORA_ENV.bundledCli, LEGACY_COMPAT_ENV.bundledCli)
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
  const override = compatEnv(process.env, METRORA_ENV.bin, LEGACY_COMPAT_ENV.bin)
  if (override) {
    if (!isAbsolute(override)) return 'bin-not-absolute'
    if (!isExecutableFile(override)) return 'bin-not-executable'
  }

  const bundled = compatEnv(process.env, METRORA_ENV.bundledCli, LEGACY_COMPAT_ENV.bundledCli)
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
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(spec.bin, spec.args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spec.env,
    })
    activeChildren.add(child)

    let stdout = ''
    let stderr = ''
    let total = 0
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeChildren.delete(child)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL')
        reject(new CliError('timeout', `Metrora ${cmdLabel} timed out after ${timeoutMs}ms`))
      })
    }, timeoutMs)

    const bump = (bytes: number): void => {
      total += bytes
      if (total > MAX_OUTPUT_BYTES) {
        finish(() => {
          child.kill('SIGKILL')
          reject(new CliError('too-large', `Metrora ${cmdLabel} produced more than ${MAX_OUTPUT_BYTES} bytes`))
        })
      }
    }

    child.stdout.on('data', chunk => {
      stdout += chunk
      bump(chunk.length)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      bump(chunk.length)
      if (onStderr) {
        try {
          onStderr(chunk.toString())
        } catch {
          // A progress listener must never terminate the read.
        }
      }
    })

    child.on('error', error => {
      finish(() => reject(new CliError('not-found', error.message, 'spawn-error')))
    })

    child.on('close', code => {
      finish(() => {
        if (code !== 0) {
          reject(new CliError('nonzero', stderr.trim() || `Metrora exited with code ${code}`))
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new CliError('bad-json', 'Metrora produced output that was not valid JSON'))
        }
      })
    })
  })
}

/** Spawn a read-only CLI command with coalescing, bounded output and priority. */
export function spawnCli(
  args: string[],
  opts: {
    timeoutMs?: number
    onStderr?: (chunk: string) => void
    extraEnv?: NodeJS.ProcessEnv
    priority?: SpawnPriority
  } = {},
): Promise<unknown> {
  const target = resolveTarget()
  if (!target) {
    return Promise.reject(new CliError('not-found', 'Metrora CLI not found', notFoundStage()))
  }

  const spec = spawnSpecFor(target, args)
  if (opts.extraEnv) spec.env = { ...spec.env, ...opts.extraEnv }

  const key = JSON.stringify([spec.bin, ...spec.args])
  const cached = readCache.get(key)
  if (cached && Date.now() - cached.at < COALESCE_TTL_MS) return Promise.resolve(cached.value)

  const existing = readInflight.get(key)
  if (existing) return existing

  const priority = opts.priority ?? 'interactive'
  const flight = (async () => {
    await acquireSlot(priority)
    try {
      return await runCli(spec, args[0] ?? '', opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.onStderr)
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
  opts: { timeoutMs?: number } = {},
): Promise<ActionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const target = resolveTarget()
  if (!target) {
    return Promise.resolve({ ok: false, stdout: '', stderr: 'Metrora CLI not found', code: null })
  }

  const spec = spawnSpecFor(target, args)
  return (async () => {
    try {
      await acquireSlot('interactive')
    } catch {
      return { ok: false, stdout: '', stderr: 'Metrora cancelled', code: null }
    }

    try {
      return await runAction(spec, args, timeoutMs)
    } finally {
      releaseSlot()
    }
  })()
}

function runAction(spec: SpawnSpec, args: string[], timeoutMs: number): Promise<ActionResult> {
  return new Promise<ActionResult>(resolve => {
    const child = spawn(spec.bin, spec.args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spec.env,
    })
    activeChildren.add(child)

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: ActionResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeChildren.delete(child)
      readCache.clear()
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({
        ok: false,
        stdout,
        stderr: `Metrora ${args[0] ?? ''} timed out after ${timeoutMs}ms`,
        code: null,
      })
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', error => finish({ ok: false, stdout, stderr: error.message, code: null }))
    child.on('close', code => finish({ ok: code === 0, stdout, stderr, code }))
  })
}
