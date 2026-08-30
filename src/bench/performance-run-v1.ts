import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { arch, platform, release } from 'node:os'
import { basename, extname, isAbsolute, normalize } from 'node:path'
import { statSync } from 'node:fs'
import {
  PERFORMANCE_BENCH_METHOD_ID,
  PERFORMANCE_BENCH_METHOD_VERSION,
  PERFORMANCE_BENCH_RUNNER_ID,
  PERFORMANCE_BENCH_RUNNER_VERSION,
  PERFORMANCE_BENCH_RUNTIME_ID,
  PERFORMANCE_BENCH_SCHEMA_VERSION,
  type PerformanceFlashAttentionV1,
  type PerformanceObservedConfigurationV1,
  type PerformanceObservedSplitModeV1,
  type PerformanceRunV1,
  type PerformanceStatusV1,
  type PerformanceSetupV1,
  type PerformanceSplitModeV1,
  type PerformanceTerminationStatusV1,
  type PerformanceWorkloadV1,
  performanceResultDigest,
} from './performance-contract-v1.js'
import { sha256Json } from './serialization.js'

export const DEFAULT_PERFORMANCE_REPETITIONS = 3
export const DEFAULT_PERFORMANCE_PROMPT_TOKENS = 512
export const DEFAULT_PERFORMANCE_GENERATION_TOKENS = 128
export const DEFAULT_PERFORMANCE_BATCH_SIZE = 2048
export const DEFAULT_PERFORMANCE_UBATCH_SIZE = 512
export const DEFAULT_PERFORMANCE_GPU_LAYERS = -1
export const DEFAULT_PERFORMANCE_FLASH_ATTENTION: PerformanceFlashAttentionV1 = 'auto'
export const DEFAULT_PERFORMANCE_SPLIT_MODE: PerformanceSplitModeV1 = 'none'
export const DEFAULT_PERFORMANCE_TIMEOUT_MS = 10 * 60_000
export const MAX_PERFORMANCE_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024

const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 20 * 60_000
const MAX_PATH_BYTES = 2_048
const MAX_METADATA_TEXT_BYTES = 512
const MAX_WORKLOADS = 16
const TERMINATION_GRACE_MS = 250
const HARD_KILL_FALLBACK_MS = 500

export const DEFAULT_PERFORMANCE_SETUP: PerformanceSetupV1 = Object.freeze({
  repetitions: DEFAULT_PERFORMANCE_REPETITIONS,
  promptTokens: DEFAULT_PERFORMANCE_PROMPT_TOKENS,
  generationTokens: DEFAULT_PERFORMANCE_GENERATION_TOKENS,
  batchSize: DEFAULT_PERFORMANCE_BATCH_SIZE,
  ubatchSize: DEFAULT_PERFORMANCE_UBATCH_SIZE,
  threads: null,
  gpuLayers: DEFAULT_PERFORMANCE_GPU_LAYERS,
  flashAttention: DEFAULT_PERFORMANCE_FLASH_ATTENTION,
  splitMode: DEFAULT_PERFORMANCE_SPLIT_MODE,
  mainGpu: null,
  warmup: true,
})

export type PerformanceRunOptions = {
  executablePath: string
  modelPath: string
  setup?: Partial<PerformanceSetupV1>
  signal?: AbortSignal
  timeoutMs?: number
  now?: () => Date
  runId?: string
  processRunner?: NativeProcessRunner
}

export type NativeProcessResult = {
  stdout: string
  stderr: string
  code: number | null
  reason?: 'timeout' | 'cancelled' | 'too-large' | 'spawn-error'
  error?: Error
}

export type NativeProcessRunner = (executablePath: string, args: readonly string[], signal: AbortSignal | undefined, timeoutMs: number) => Promise<NativeProcessResult>

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedText(value: unknown, maxBytes = MAX_METADATA_TEXT_BYTES): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim()
  if (!normalized || bytes(normalized) > maxBytes) return null
  return normalized
}

function boundedPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || bytes(value) > MAX_PATH_BYTES || value.startsWith('-') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('native Bench path is invalid or too large')
  }
  if (!isAbsolute(value)) throw new Error('native Bench path must be absolute')
  const normalized = normalize(value)
  if (!normalized || normalized.startsWith('-')) throw new Error('native Bench path is invalid')
  return normalized
}

function requireFile(value: string, kind: 'executable' | 'model'): string {
  try {
    if (!statSync(value).isFile()) throw new Error()
  } catch {
    throw new Error(`native Bench ${kind} file was not found`)
  }
  if (kind === 'model' && extname(value).toLowerCase() !== '.gguf') throw new Error('native Bench model must be a .gguf file')
  return value
}

export function validatePerformanceExecutablePath(value: unknown): string {
  return requireFile(boundedPath(value), 'executable')
}

export function validatePerformanceModelPath(value: unknown): string {
  return requireFile(boundedPath(value), 'model')
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label} must be an integer from ${min} to ${max}`)
  return value as number
}

function optionalInteger(value: unknown, label: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null
  return integer(value, label, min, max)
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

export function normalizePerformanceSetup(input: Partial<PerformanceSetupV1> = {}): PerformanceSetupV1 {
  const setup = {
    ...DEFAULT_PERFORMANCE_SETUP,
    ...input,
  }
  if (setup.flashAttention !== 'auto' && setup.flashAttention !== 'on' && setup.flashAttention !== 'off') throw new Error('flash attention must be auto, on, or off')
  if (setup.splitMode !== 'none' && setup.splitMode !== 'layer' && setup.splitMode !== 'row') throw new Error('split mode must be none, layer, or row')
  return {
    repetitions: integer(setup.repetitions, 'repetitions', 1, 5),
    promptTokens: integer(setup.promptTokens, 'prompt tokens', 1, 8192),
    generationTokens: integer(setup.generationTokens, 'generation tokens', 1, 8192),
    batchSize: integer(setup.batchSize, 'batch size', 1, 8192),
    ubatchSize: integer(setup.ubatchSize, 'ubatch size', 1, 8192),
    threads: optionalInteger(setup.threads, 'threads', 1, 256),
    gpuLayers: integer(setup.gpuLayers, 'GPU layers', -1, 512),
    flashAttention: setup.flashAttention,
    splitMode: setup.splitMode,
    mainGpu: optionalInteger(setup.mainGpu, 'main GPU', 0, 64),
    warmup: booleanValue(setup.warmup, 'warmup'),
  }
}

export function validatePerformanceTimeoutMs(value: number): number {
  return integer(value, 'timeout', MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

/** Build the only argv shape the native adapter is allowed to execute. */
export function buildLlamaBenchArgs(modelPath: string, setupInput: Partial<PerformanceSetupV1> = {}): string[] {
  const model = boundedPath(modelPath)
  if (extname(model).toLowerCase() !== '.gguf') throw new Error('native Bench model must be a .gguf file')
  const setup = normalizePerformanceSetup(setupInput)
  const args = [
    '-m', model,
    '-o', 'json',
    '-r', String(setup.repetitions),
    '-p', String(setup.promptTokens),
    '-n', String(setup.generationTokens),
    '-b', String(setup.batchSize),
    '-ub', String(setup.ubatchSize),
    '-ngl', String(setup.gpuLayers),
    '-fa', setup.flashAttention,
    '-sm', setup.splitMode,
  ]
  if (setup.threads !== null) args.push('-t', String(setup.threads))
  if (setup.mainGpu !== null) args.push('-mg', String(setup.mainGpu))
  if (!setup.warmup) args.push('--no-warmup')
  return args
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null
}

function nonNegativeNumber(value: unknown): number | null {
  const result = finiteNumber(value)
  return result !== null && result >= 0 ? result : null
}

function safeInteger(value: unknown, minimum = 0): number | null {
  const result = finiteNumber(value)
  return result !== null && Number.isSafeInteger(result) && result >= minimum ? result : null
}

function safeName(value: unknown, fallback: string): string {
  const raw = boundedText(value, 256)
  if (!raw) return fallback
  const normalized = raw.replaceAll('\\', '/')
  return boundedText(basename(normalized), 160) ?? fallback
}

function safeMetadata(value: unknown): string | null {
  return boundedText(value)
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  return [...new Set(values.map(item => boundedText(item, 160)).filter((item): item is string => item !== null))].slice(0, 32)
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function observedSplitMode(value: unknown): PerformanceObservedSplitModeV1 | null {
  return value === 'none' || value === 'layer' || value === 'row' || value === 'tensor' ? value : null
}

function observedFlashAttention(value: unknown): PerformanceFlashAttentionV1 | null {
  return value === 'auto' || value === 'on' || value === 'off' ? value : null
}

function workloadFromRow(row: Record<string, unknown>): PerformanceWorkloadV1['workload'] {
  const marker = [row.test, row.type, row.workload].filter(item => typeof item === 'string').join(' ').toLowerCase()
  if (/\bpp\b|^pp\d|prompt.?processing/u.test(marker)) return 'prefill'
  if (/\btg\b|^tg\d|token.?generation|decode/u.test(marker)) return 'decode'
  if (/\bpg\b|^pg\d|prompt.?generation|mixed/u.test(marker)) return 'mixed'
  const prompt = safeInteger(row.n_prompt)
  const generation = safeInteger(row.n_gen)
  if (prompt !== null && generation === 0) return 'prefill'
  if (generation !== null && prompt === 0) return 'decode'
  return 'unknown'
}

function normalizeWorkload(row: Record<string, unknown>, setup: PerformanceSetupV1): PerformanceWorkloadV1 {
  const averageTimeNs = nonNegativeNumber(row.avg_ns)
  const throughput = nonNegativeNumber(row.avg_ts)
  const standardDeviation = nonNegativeNumber(row.stddev_ts)
  const promptTokens = safeInteger(row.n_prompt)
  const generationTokens = safeInteger(row.n_gen)
  return {
    workload: workloadFromRow(row),
    promptTokens,
    generationTokens,
    depth: safeInteger(row.n_depth),
    repetitions: safeInteger(row.n_reps) ?? safeInteger(row.repetitions) ?? setup.repetitions,
    throughputTokensPerSecond: throughput,
    throughputStddevTokensPerSecond: standardDeviation,
    averageTimeNs,
    averageLatencyMs: averageTimeNs === null ? null : averageTimeNs / 1_000_000,
    testTime: timestamp(row.test_time),
  }
}

function commonObserved<T>(rows: Record<string, unknown>[], read: (row: Record<string, unknown>) => T | null): { value: T | null; conflict: boolean } {
  const values = rows.map(read).filter((value): value is T => value !== null)
  const unique = [...new Set(values.map(value => JSON.stringify(value)))]
  return { value: values[0] ?? null, conflict: unique.length > 1 }
}

function tokenObserved(rows: Record<string, unknown>[], read: (row: Record<string, unknown>) => number | null): { value: number | null; conflict: boolean } {
  const values = rows.map(read).filter((value): value is number => value !== null)
  const positive = values.filter(value => value > 0)
  const selected = positive.length ? positive : values
  const unique = [...new Set(selected)]
  return { value: selected.length ? Math.max(...selected) : null, conflict: unique.length > 1 }
}

function observedConfiguration(rows: Record<string, unknown>[], setup: PerformanceSetupV1): { value: PerformanceObservedConfigurationV1; mismatches: string[] } {
  const batchSize = commonObserved(rows, row => safeInteger(row.n_batch))
  const ubatchSize = commonObserved(rows, row => safeInteger(row.n_ubatch))
  const threads = commonObserved(rows, row => safeInteger(row.n_threads, 1))
  const gpuLayers = commonObserved(rows, row => safeInteger(row.n_gpu_layers, -1))
  const splitMode = commonObserved(rows, row => observedSplitMode(row.split_mode))
  const mainGpu = commonObserved(rows, row => safeInteger(row.main_gpu))
  const flashAttention = commonObserved(rows, row => observedFlashAttention(row.flash_attn))
  const promptTokens = tokenObserved(rows, row => safeInteger(row.n_prompt))
  const generationTokens = tokenObserved(rows, row => safeInteger(row.n_gen))
  const repetitions = commonObserved(rows, row => safeInteger(row.n_reps) ?? safeInteger(row.repetitions))
  const depth = commonObserved(rows, row => safeInteger(row.n_depth))
  const value: PerformanceObservedConfigurationV1 = {
    batchSize: batchSize.value,
    ubatchSize: ubatchSize.value,
    threads: threads.value,
    gpuLayers: gpuLayers.value,
    splitMode: splitMode.value,
    mainGpu: mainGpu.value,
    flashAttention: flashAttention.value,
    promptTokens: promptTokens.value,
    generationTokens: generationTokens.value,
    repetitions: repetitions.value,
    depth: depth.value,
  }
  const mismatches: string[] = []
  const check = (field: string, observed: unknown, declared: unknown, allowDefault = false): void => {
    if (observed === null || observed === undefined) return
    if (allowDefault && declared === null) return
    if (observed !== declared) mismatches.push(field)
  }
  check('n_batch', value.batchSize, setup.batchSize)
  check('n_ubatch', value.ubatchSize, setup.ubatchSize)
  check('n_threads', value.threads, setup.threads, true)
  check('n_gpu_layers', value.gpuLayers, setup.gpuLayers)
  check('split_mode', value.splitMode, setup.splitMode)
  check('main_gpu', value.mainGpu, setup.mainGpu, true)
  check('flash_attn', value.flashAttention, setup.flashAttention)
  check('n_prompt', value.promptTokens, setup.promptTokens)
  check('n_gen', value.generationTokens, setup.generationTokens)
  check('n_reps', value.repetitions, setup.repetitions)
  if (batchSize.conflict) mismatches.push('n_batch-conflict')
  if (ubatchSize.conflict) mismatches.push('n_ubatch-conflict')
  if (threads.conflict) mismatches.push('n_threads-conflict')
  if (gpuLayers.conflict) mismatches.push('n_gpu_layers-conflict')
  if (splitMode.conflict) mismatches.push('split_mode-conflict')
  if (mainGpu.conflict) mismatches.push('main_gpu-conflict')
  if (flashAttention.conflict) mismatches.push('flash_attn-conflict')
  if (promptTokens.conflict) mismatches.push('n_prompt-conflict')
  if (generationTokens.conflict) mismatches.push('n_gen-conflict')
  if (repetitions.conflict) mismatches.push('n_reps-conflict')
  if (depth.conflict) mismatches.push('n_depth-conflict')
  return { value, mismatches: [...new Set(mismatches)] }
}

export type ParsedLlamaBenchJson = {
  rows: Record<string, unknown>[]
  workloads: PerformanceWorkloadV1[]
  model: PerformanceRunV1['model']
  runtime: PerformanceRunV1['runtime']
  hardware: PerformanceRunV1['hardware']
  observedConfiguration: PerformanceObservedConfigurationV1
  configurationMismatches: string[]
}

/** Normalize only fields defined by llama-bench's JSON output; absent fields stay null. */
export function parseLlamaBenchJson(value: unknown, modelPath: string, setupInput: Partial<PerformanceSetupV1> = {}): ParsedLlamaBenchJson {
  const setup = normalizePerformanceSetup(setupInput)
  const rows = Array.isArray(value)
    ? value.filter(isRecord)
    : isRecord(value) && Array.isArray(value.results)
      ? value.results.filter(isRecord)
      : []
  if (!rows.length) throw new Error('llama-bench returned no JSON result rows')
  const workloads = rows.slice(0, MAX_WORKLOADS).map(row => normalizeWorkload(row, setup))
  if (!workloads.some(workload => workload.workload !== 'unknown')) throw new Error('llama-bench returned no recognized workload rows')
  const observed = observedConfiguration(rows.slice(0, MAX_WORKLOADS), setup)
  const first = rows[0]!
  const modelReported = safeName(first.model_filename, safeName(modelPath, 'unknown-model'))
  const model = {
    selected: safeName(modelPath, 'unknown-model'),
    reported: modelReported,
    type: safeMetadata(first.model_type),
    sizeBytes: safeInteger(first.model_size),
    parameterCount: safeInteger(first.model_n_params),
  }
  const buildCommit = safeMetadata(first.build_commit)
  const buildNumber = safeInteger(first.build_number)
  const backends = stringList(first.backends)
  const runtime = {
    id: PERFORMANCE_BENCH_RUNTIME_ID,
    buildCommit,
    buildNumber,
    version: buildCommit ?? (buildNumber === null ? null : String(buildNumber)),
    backends,
  }
  return {
    rows,
    workloads,
    model,
    runtime,
    hardware: {
      cpuInfo: safeMetadata(first.cpu_info),
      gpuInfo: safeMetadata(first.gpu_info),
      devices: stringList(first.devices),
    },
    observedConfiguration: observed.value,
    configurationMismatches: observed.mismatches,
  }
}

function nativeEnvironment(): NodeJS.ProcessEnv {
  // Preserve only process essentials. In particular, no provider/API secret
  // is needed by llama-bench and no benchmark argument is taken from env.
  const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'DYLD_LIBRARY_PATH', 'LD_LIBRARY_PATH']
  const result: NodeJS.ProcessEnv = {}
  for (const key of allowed) if (process.env[key] !== undefined) result[key] = process.env[key]
  return result
}

function chunkBuffer(value: unknown): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value))
}

function runBoundedNativeProcess(executablePath: string, args: readonly string[], parent: AbortSignal | undefined, timeoutMs: number): Promise<NativeProcessResult> {
  if (parent?.aborted) return Promise.resolve({ stdout: '', stderr: '', code: null, reason: 'cancelled' })
  return new Promise(resolve => {
    let child: ChildProcess
    try {
      child = spawn(executablePath, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: nativeEnvironment(),
      })
    } catch (error) {
      resolve({ stdout: '', stderr: '', code: null, reason: 'spawn-error', error: error instanceof Error ? error : new Error(String(error)) })
      return
    }
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    let reason: NativeProcessResult['reason']
    let absoluteTimer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (code: number | null, error?: Error): void => {
      if (settled) return
      settled = true
      if (absoluteTimer !== undefined) clearTimeout(absoluteTimer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
      parent?.removeEventListener('abort', onAbort)
      resolve({ stdout, stderr, code, ...(reason ? { reason } : {}), ...(error ? { error } : {}) })
    }
    const terminate = (nextReason: NonNullable<NativeProcessResult['reason']>): void => {
      if (settled || reason) return
      reason = nextReason
      try { child.kill('SIGTERM') } catch { /* hard-kill fallback still runs */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* close/error will settle */ }
        fallbackTimer = setTimeout(() => finish(null), HARD_KILL_FALLBACK_MS)
      }, TERMINATION_GRACE_MS)
    }
    const onAbort = () => terminate('cancelled')
    const append = (target: 'stdout' | 'stderr', raw: unknown): void => {
      if (settled || reason) return
      const chunk = chunkBuffer(raw)
      const remaining = MAX_PERFORMANCE_PROCESS_OUTPUT_BYTES - outputBytes
      if (remaining <= 0 || chunk.length > remaining) {
        if (remaining > 0) {
          const accepted = chunk.subarray(0, remaining).toString('utf8')
          outputBytes += remaining
          if (target === 'stdout') stdout += accepted
          else stderr += accepted
        }
        terminate('too-large')
        return
      }
      outputBytes += chunk.length
      if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }
    child.stdout?.on('data', chunk => append('stdout', chunk))
    child.stderr?.on('data', chunk => append('stderr', chunk))
    child.once('error', error => finish(null, error instanceof Error ? error : new Error(String(error))))
    child.once('close', code => finish(code))
    if (parent) parent.addEventListener('abort', onAbort, { once: true })
    absoluteTimer = setTimeout(() => terminate('timeout'), timeoutMs)
    if (parent?.aborted) onAbort()
  })
}

function failure(code: string, message: string): { code: string; message: string } {
  return { code, message: message.replace(/[\r\n]+/gu, ' ').slice(0, 240) }
}

function baseResult(options: PerformanceRunOptions, setup: PerformanceSetupV1, startedAt: string, endedAt: string, status: PerformanceStatusV1, termination: PerformanceTerminationStatusV1, parsed: ParsedLlamaBenchJson | null, failureValue: { code: string; message: string } | null): PerformanceRunV1 {
  const executableName = safeName(options.executablePath, 'llama-bench')
  const model = parsed?.model ?? {
    selected: safeName(options.modelPath, 'unknown-model'),
    reported: null,
    type: null,
    sizeBytes: null,
    parameterCount: null,
  }
  const runtime = parsed?.runtime ?? { id: PERFORMANCE_BENCH_RUNTIME_ID, buildCommit: null, buildNumber: null, version: null, backends: [] }
  const hardware = parsed?.hardware ?? { cpuInfo: null, gpuInfo: null, devices: [] }
  const methodology = {
    id: PERFORMANCE_BENCH_METHOD_ID,
    version: PERFORMANCE_BENCH_METHOD_VERSION,
    setup,
    argvDigest: sha256Json(buildLlamaBenchArgs(options.modelPath, setup)),
  }
  const result: PerformanceRunV1 = {
    schemaVersion: PERFORMANCE_BENCH_SCHEMA_VERSION,
    runId: options.runId ?? randomUUID(),
    runner: { id: PERFORMANCE_BENCH_RUNNER_ID, version: PERFORMANCE_BENCH_RUNNER_VERSION },
    methodology,
    model,
    executable: { name: executableName },
    runtime,
    hardware,
    environment: { os: `${platform()} ${release()}`, arch: arch(), node: process.version },
    startedAt,
    endedAt,
    status,
    termination: { status: termination },
    failure: failureValue,
    observedConfiguration: parsed?.observedConfiguration ?? null,
    workloads: parsed?.workloads ?? [],
    resultDigest: '',
  }
  result.resultDigest = performanceResultDigest(result)
  return result
}

export async function runPerformanceBenchV1(options: PerformanceRunOptions): Promise<PerformanceRunV1> {
  const executablePath = validatePerformanceExecutablePath(options.executablePath)
  const modelPath = validatePerformanceModelPath(options.modelPath)
  const setup = normalizePerformanceSetup(options.setup)
  const timeoutMs = validatePerformanceTimeoutMs(options.timeoutMs ?? DEFAULT_PERFORMANCE_TIMEOUT_MS)
  const startedAt = (options.now ?? (() => new Date()))().toISOString()
  const runner = options.processRunner ?? runBoundedNativeProcess
  const args = buildLlamaBenchArgs(modelPath, setup)
  const processResult = await runner(executablePath, args, options.signal, timeoutMs)
  const endedAt = (options.now ?? (() => new Date()))().toISOString()
  if (processResult.reason === 'cancelled') return baseResult({ ...options, executablePath, modelPath }, setup, startedAt, endedAt, 'cancelled', 'cancelled', null, failure('cancelled', 'llama-bench run was cancelled'))
  if (processResult.reason === 'timeout') return baseResult({ ...options, executablePath, modelPath }, setup, startedAt, endedAt, 'failed', 'timeout', null, failure('timeout', 'llama-bench run exceeded its bounded timeout'))
  if (processResult.reason === 'too-large') return baseResult({ ...options, executablePath, modelPath }, setup, startedAt, endedAt, 'failed', 'output-limit', null, failure('output-limit', 'llama-bench output exceeded its bounded limit'))
  if (processResult.reason === 'spawn-error' || processResult.error) return baseResult({ ...options, executablePath, modelPath }, setup, startedAt, endedAt, 'unavailable', 'spawn-error', null, failure('native-runtime-unavailable', 'The selected llama-bench executable could not be started.'))

  let parsed: ParsedLlamaBenchJson
  try {
    const decoded = JSON.parse(processResult.stdout) as unknown
    parsed = parseLlamaBenchJson(decoded, modelPath, setup)
  } catch {
    return baseResult({ ...options, executablePath, modelPath }, setup, startedAt, endedAt, 'failed', 'malformed-output', null, failure('malformed-output', 'llama-bench did not return recognized bounded JSON evidence'))
  }
  if (parsed.configurationMismatches.length) {
    return baseResult(
      { ...options, executablePath, modelPath },
      setup,
      startedAt,
      endedAt,
      'failed',
      'none',
      parsed,
      failure('configuration-mismatch', 'llama-bench observed configuration differs from the declared setup: ' + parsed.configurationMismatches.join(', ')),
    )
  }
  if (processResult.code !== 0) return baseResult({ ...options, executablePath, modelPath }, setup, startedAt, endedAt, 'failed', 'none', parsed, failure('nonzero-exit', 'llama-bench exited with a non-zero status after returning partial evidence'))
  return baseResult({ ...options, executablePath, modelPath }, setup, startedAt, endedAt, 'completed', 'none', parsed, null)
}
