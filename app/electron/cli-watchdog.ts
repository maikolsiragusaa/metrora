import { spawn, type ChildProcess } from 'node:child_process'

/**
 * The CLI is launched as a direct child with shell:false. Windows process-tree
 * ownership is intentionally not claimed here; a follow-up must make that
 * contract explicit before any tree-wide termination is considered.
 */
export const WINDOWS_PROCESS_TREE_STATUS = 'WINDOWS_PROCESS_TREE_V1_1' as const

export const DEFAULT_TERMINATION_GRACE_MS = 250
export const DEFAULT_HARD_KILL_FALLBACK_MS = 500
export const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_PROGRESS_LINE_BYTES = 64 * 1024
const MAX_PROGRESS_PROVIDERS = 128
const MAX_PROGRESS_FILES = 1_000_000

export type SpawnSpec = {
  bin: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export type TrustedProgressEvent =
  | { kind: 'providers'; providers: string[]; cold?: boolean }
  | { kind: 'provider'; provider: string; state: 'start' | 'done' | 'skipped'; files?: number }
  | { kind: 'tick'; provider: string; done: number; total: number }

export type TerminationReason = 'timeout' | 'too-large' | 'cancelled'

export type BoundedProcessResult = {
  stdout: string
  stderr: string
  code: number | null
  signal?: NodeJS.Signals | null
  error?: Error
  reason?: TerminationReason
}

export type BoundedProcessOptions = {
  absoluteTimeoutMs: number
  idleTimeoutMs?: number
  graceMs?: number
  maxOutputBytes?: number
  onStderr?: (chunk: string) => void
  onProgress?: (event: TrustedProgressEvent) => void
}

const activeProcesses = new Map<number, (reason?: TerminationReason) => void>()
let nextProcessId = 1

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed)
  return Object.keys(value).every(key => keys.has(key))
}

function boundedName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
}

function boundedInteger(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

/**
 * Validate the CLI's progress protocol as a state machine. A line with the
 * marker is not itself a heartbeat: only a well-formed event in the expected
 * sequence can reset the idle timer. Repeated zero/decreasing ticks, duplicate
 * provider transitions, unknown providers, malformed JSON, and oversized lines
 * are ignored.
 */
function createProgressGate(onAccepted?: (event: TrustedProgressEvent) => void): (chunk: Buffer) => void {
  let lineBuffer = ''
  let lineBytes = 0
  let discardingLongLine = false
  let providersDeclared = false
  const providers = new Set<string>()
  const providerStates = new Map<string, 'start' | 'done' | 'skipped'>()
  const ticks = new Map<string, { done: number; total: number }>()

  const accept = (raw: unknown): TrustedProgressEvent | null => {
    if (!isRecord(raw) || typeof raw.kind !== 'string') return null

    if (raw.kind === 'providers') {
      if (providersDeclared || !hasOnlyKeys(raw, ['kind', 'providers', 'cold'])) return null
      if (!Array.isArray(raw.providers) || raw.providers.length > MAX_PROGRESS_PROVIDERS) return null
      if (raw.cold !== undefined && typeof raw.cold !== 'boolean') return null
      const names = raw.providers
      if (!names.every(boundedName)) return null
      const unique = new Set(names)
      if (unique.size !== names.length) return null
      providersDeclared = true
      for (const name of names) providers.add(name)
      return raw.cold === undefined
        ? { kind: 'providers', providers: [...names] }
        : { kind: 'providers', providers: [...names], cold: raw.cold }
    }

    if (!providersDeclared || typeof raw.provider !== 'string' || !providers.has(raw.provider)) return null

    if (raw.kind === 'provider') {
      if (!hasOnlyKeys(raw, ['kind', 'provider', 'state', 'files'])) return null
      if (raw.state !== 'start' && raw.state !== 'done' && raw.state !== 'skipped') return null
      const previousState = providerStates.get(raw.provider)
      if (raw.state === 'start') {
        if (previousState !== undefined) return null
      } else if (previousState !== 'start') {
        return null
      }
      if (raw.state === 'start' && raw.files !== undefined) return null
      if (raw.state !== 'done' && raw.files !== undefined) return null
      if (raw.files !== undefined && !boundedInteger(raw.files, MAX_PROGRESS_FILES)) return null
      providerStates.set(raw.provider, raw.state)
      return raw.files === undefined
        ? { kind: 'provider', provider: raw.provider, state: raw.state }
        : { kind: 'provider', provider: raw.provider, state: raw.state, files: raw.files }
    }

    if (raw.kind === 'tick') {
      if (!hasOnlyKeys(raw, ['kind', 'provider', 'done', 'total'])) return null
      if (!boundedInteger(raw.done, MAX_PROGRESS_FILES) || !boundedInteger(raw.total, MAX_PROGRESS_FILES)) return null
      if (raw.done > raw.total) return null
      if (providerStates.get(raw.provider) !== 'start') return null
      const previous = ticks.get(raw.provider)
      if (previous && (raw.done <= previous.done || raw.total < previous.total)) return null
      ticks.set(raw.provider, { done: raw.done, total: raw.total })
      // The initial zero tick establishes a baseline but cannot keep a stalled
      // process alive. A later strictly increasing tick can.
      if (raw.done === 0) return null
      return { kind: 'tick', provider: raw.provider, done: raw.done, total: raw.total }
    }

    return null
  }

  const consumeLine = (line: string): void => {
    if (!line.startsWith('METRORA_PROGRESS ')) return
    try {
      const event = accept(JSON.parse(line.slice('METRORA_PROGRESS '.length)))
      if (!event) return
      try { onAccepted?.(event) } catch { /* observers cannot break process control */ }
    } catch {
      // Malformed progress is ordinary child output, never a heartbeat.
    }
  }

  return chunk => {
    let rest = chunk.toString('utf8')
    while (rest.length > 0) {
      const newline = rest.indexOf('\n')
      if (discardingLongLine) {
        if (newline < 0) return
        rest = rest.slice(newline + 1)
        discardingLongLine = false
        lineBytes = 0
        continue
      }

      if (newline < 0) {
        const bytes = Buffer.byteLength(rest, 'utf8')
        if (lineBytes + bytes > MAX_PROGRESS_LINE_BYTES) {
          lineBuffer = ''
          lineBytes = 0
          discardingLongLine = true
        } else {
          lineBuffer += rest
          lineBytes += bytes
        }
        return
      }

      const part = rest.slice(0, newline)
      const partBytes = Buffer.byteLength(part, 'utf8')
      const completeBytes = lineBytes + partBytes
      rest = rest.slice(newline + 1)
      if (completeBytes <= MAX_PROGRESS_LINE_BYTES) {
        const completeLine = lineBuffer + part
        const line = completeLine.endsWith('\r') ? completeLine.slice(0, -1) : completeLine
        consumeLine(line)
      }
      lineBuffer = ''
      lineBytes = 0
    }
  }
}

function normalizeTimeout(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback
}

function chunkBuffer(value: unknown): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value))
}

/**
 * Run one child with bounded stdout/stderr, a fixed absolute deadline, and an
 * independent idle deadline. Termination is SIGTERM, bounded grace, then
 * SIGKILL. No process-name or broad process-tree kill is attempted.
 */
export function runBoundedProcess(
  spec: SpawnSpec,
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  const absoluteTimeoutMs = normalizeTimeout(options.absoluteTimeoutMs, 45_000)
  const idleTimeoutMs = options.idleTimeoutMs === undefined
    ? undefined
    : normalizeTimeout(options.idleTimeoutMs, 45_000)
  const graceMs = normalizeTimeout(options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS, DEFAULT_TERMINATION_GRACE_MS)
  const maxOutputBytes = normalizeTimeout(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES)

  return new Promise<BoundedProcessResult>(resolve => {
    let child: ChildProcess
    try {
      child = spawn(spec.bin, spec.args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spec.env,
      })
    } catch (error) {
      resolve({ stdout: '', stderr: '', code: null, error: asError(error) })
      return
    }

    const processId = nextProcessId++
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    let termination: TerminationReason | undefined
    let absoluteTimer: ReturnType<typeof setTimeout> | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (code: number | null, signal: NodeJS.Signals | null, error?: Error): void => {
      if (settled) return
      settled = true
      if (absoluteTimer !== undefined) clearTimeout(absoluteTimer)
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
      activeProcesses.delete(processId)
      resolve({
        stdout,
        stderr,
        code,
        ...(signal !== null ? { signal } : {}),
        ...(error ? { error } : {}),
        ...(termination ? { reason: termination } : {}),
      })
    }

    const requestTermination = (reason: TerminationReason = 'cancelled'): void => {
      if (settled || termination) return
      termination = reason
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      try { child.kill('SIGTERM') } catch { /* proceed to bounded hard kill */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* close/fallback still settles */ }
        fallbackTimer = setTimeout(() => finish(null, null), DEFAULT_HARD_KILL_FALLBACK_MS)
      }, graceMs)
    }

    const resetIdleTimer = (): void => {
      if (idleTimeoutMs === undefined || settled || termination) return
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => requestTermination('timeout'), idleTimeoutMs)
    }

    const progressGate = createProgressGate(event => {
      if (settled || termination) return
      resetIdleTimer()
      try { options.onProgress?.(event) } catch { /* UI observers are best effort */ }
    })

    const append = (target: 'stdout' | 'stderr', rawChunk: unknown): Buffer | null => {
      if (settled || termination) return null
      const bytes = chunkBuffer(rawChunk)
      const remaining = maxOutputBytes - outputBytes
      if (remaining <= 0 || bytes.length > remaining) {
        if (remaining > 0) {
          const accepted = bytes.subarray(0, remaining)
          outputBytes += accepted.length
          if (target === 'stdout') stdout += accepted.toString('utf8')
          else stderr += accepted.toString('utf8')
        }
        requestTermination('too-large')
        return null
      }
      outputBytes += bytes.length
      if (target === 'stdout') stdout += bytes.toString('utf8')
      else stderr += bytes.toString('utf8')
      return bytes
    }

    const handleStderr = (rawChunk: unknown): void => {
      const accepted = append('stderr', rawChunk)
      if (!accepted || settled || termination) return
      try { options.onStderr?.(accepted.toString('utf8')) } catch { /* observers are best effort */ }
      progressGate(accepted)
    }

    activeProcesses.set(processId, requestTermination)
    child.stdout?.on('data', (chunk: unknown) => { append('stdout', chunk) })
    child.stderr?.on('data', handleStderr)
    child.on('error', error => finish(null, null, asError(error)))
    child.on('close', (code, signal) => finish(code, signal))

    absoluteTimer = setTimeout(() => requestTermination('timeout'), absoluteTimeoutMs)
    resetIdleTimer()
  })
}

/** Ask every owned child to terminate gracefully, without broad process kills. */
export function cancelAllBoundedProcesses(): void {
  for (const cancel of activeProcesses.values()) cancel('cancelled')
}
