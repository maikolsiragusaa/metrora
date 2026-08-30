import { arch, platform, release } from 'node:os'
import { randomUUID } from 'node:crypto'
import { FIXED_GENERATION_PARAMETERS, type BenchFailureCode, type RuntimeReportedMetricsV1 } from './contract-v1.js'
import { BenchOllamaError, DEFAULT_OLLAMA_TIMEOUT_MS, fetchOllamaVersion, OLLAMA_LOCAL_BASE_URL, runOllamaGenerate, validateOllamaModelId, type BenchFetch } from './ollama-local.js'
import { validateBenchTimeoutMs } from './run-v1.js'
import { scoreBenchTaskV1, type BenchTaskScoreStatusV1 } from './scoring-v1.js'
import { sha256Json } from './serialization.js'
import { getBenchTaskPackV1, type BenchTaskPackV1 } from './task-pack-v1.js'

export const BENCH_EVALUATION_SCHEMA_VERSION = 'metrora.bench-evaluation.v1' as const
export const BENCH_TASK_RUNNER_ID = 'ollama-task-pack-v1' as const
export const BENCH_TASK_RUNNER_VERSION = '1.0.0' as const
export type BenchTaskRunStatusV1 = BenchTaskScoreStatusV1 | 'unavailable' | 'timeout' | 'cancelled'
export type BenchTaskFailureCodeV1 = BenchFailureCode | 'scoring-failed' | 'malformed-output'

export type BenchTaskResultV1 = {
  taskId: string
  attempted: boolean
  status: BenchTaskRunStatusV1
  score: 0 | 1 | null
  outputDigest: string | null
  outputChars: number | null
  requestLatencyMs: number | null
  timeToFirstContentMs: number | null
  runtimeReported: RuntimeReportedMetricsV1
  failure: { code: BenchTaskFailureCodeV1; message: string } | null
}

export type BenchEvaluationV1 = {
  schemaVersion: typeof BENCH_EVALUATION_SCHEMA_VERSION
  runId: string
  runner: { id: typeof BENCH_TASK_RUNNER_ID; version: typeof BENCH_TASK_RUNNER_VERSION }
  pack: { packId: BenchTaskPackV1['packId']; version: BenchTaskPackV1['version']; digest: string }
  model: { selected: string; reported: string | null }
  runtime: { id: 'ollama-local'; endpoint: typeof OLLAMA_LOCAL_BASE_URL; version: string | null }
  environment: { os: string; arch: string; node: string }
  generation: { parameters: typeof FIXED_GENERATION_PARAMETERS; policy: 'one-bounded-request-per-task' }
  startedAt: string
  endedAt: string
  status: 'completed' | 'unavailable' | 'cancelled'
  tasks: BenchTaskResultV1[]
  aggregate: { planned: number; attempted: number; passed: number; failed: number; unavailable: number; cancelled: number; score: { numerator: number; denominator: number; value: number | null } }
  resultDigest: string
}

export type BenchTaskPackProgressV1 = { planned: number; completed: number }
export type BenchTaskPackRunOptions = { model: string; packId?: string; fetchImpl?: BenchFetch; signal?: AbortSignal; timeoutMs?: number; now?: () => Date; monotonicNow?: () => number; runId?: string; onProgress?: (progress: BenchTaskPackProgressV1) => void | Promise<void> }

const EMPTY_RUNTIME_METRICS: RuntimeReportedMetricsV1 = { totalDurationNs: null, loadDurationNs: null, promptEvalCount: null, promptEvalDurationNs: null, evalCount: null, evalDurationNs: null }
const isoNow = (now: () => Date): string => now().toISOString()

function failureMessage(code: BenchTaskFailureCodeV1): string {
  switch (code) {
    case 'runtime-unavailable': case 'transport-error': return 'Ollama local runtime unavailable at ' + OLLAMA_LOCAL_BASE_URL + '.'
    case 'model-not-found': return 'Ollama could not find the selected local model.'
    case 'http-error': return 'Ollama local runtime returned an HTTP error.'
    case 'timeout': return 'The bounded local task request timed out.'
    case 'cancelled': return 'The local Bench task pack was cancelled.'
    case 'response-limit': return 'The bounded local response limit was exceeded.'
    case 'malformed-response': return 'The local runtime returned malformed data.'
    case 'runtime-error': return 'The local runtime reported a generation failure.'
    case 'scoring-failed': return 'The deterministic task assertion did not match.'
    case 'malformed-output': return 'The model output was not valid for deterministic scoring.'
  }
}
function asFailure(error: unknown): { code: BenchTaskFailureCodeV1; message: string } {
  return error instanceof BenchOllamaError ? { code: error.code, message: failureMessage(error.code) } : { code: 'transport-error', message: failureMessage('transport-error') }
}
function emptyTask(taskId: string, status: 'unavailable' | 'timeout' | 'cancelled', code: 'runtime-unavailable' | 'timeout' | 'cancelled'): BenchTaskResultV1 {
  return { taskId, attempted: false, status, score: null, outputDigest: null, outputChars: null, requestLatencyMs: null, timeToFirstContentMs: null, runtimeReported: { ...EMPTY_RUNTIME_METRICS }, failure: { code, message: failureMessage(code) } }
}
function buildAggregate(tasks: BenchTaskResultV1[]): BenchEvaluationV1['aggregate'] {
  const passed = tasks.filter(task => task.score === 1).length
  const failed = tasks.filter(task => task.score === 0).length
  const unavailable = tasks.filter(task => task.status === 'unavailable' || task.status === 'timeout').length
  const cancelled = tasks.filter(task => task.status === 'cancelled').length
  const denominator = passed + failed
  return { planned: tasks.length, attempted: tasks.filter(task => task.attempted).length, passed, failed, unavailable, cancelled, score: { numerator: passed, denominator, value: denominator === 0 ? null : passed / denominator } }
}
export function digestBenchEvaluationV1(result: Pick<BenchEvaluationV1, 'model' | 'runtime' | 'pack' | 'tasks'>): string {
  return sha256Json({ schemaVersion: BENCH_EVALUATION_SCHEMA_VERSION, runner: { id: BENCH_TASK_RUNNER_ID, version: BENCH_TASK_RUNNER_VERSION }, pack: result.pack, model: result.model, runtimeVersion: result.runtime.version, tasks: result.tasks.map(task => ({ taskId: task.taskId, attempted: task.attempted, status: task.status, score: task.score, outputDigest: task.outputDigest, outputChars: task.outputChars, runtimeReported: task.runtimeReported, failure: task.failure?.code ?? null })) })
}

export async function runBenchTaskPackV1(options: BenchTaskPackRunOptions): Promise<BenchEvaluationV1> {
  const model = validateOllamaModelId(options.model)
  const pack = getBenchTaskPackV1(options.packId)
  const now = options.now ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const timeoutMs = validateBenchTimeoutMs(options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS)
  const runId = options.runId ?? randomUUID()
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) throw new Error('run id must contain only letters, numbers, dot, underscore, colon, or hyphen (1-128 characters)')
  const startedAt = isoNow(now)
  let runtimeVersion: string | null = null
  let preflightFailure: { code: BenchTaskFailureCodeV1; message: string } | null = null
  try { runtimeVersion = await fetchOllamaVersion({ fetchImpl: options.fetchImpl, signal: options.signal, timeoutMs }) } catch (error) { preflightFailure = asFailure(error) }

  const tasks: BenchTaskResultV1[] = []
  const reportProgress = async (): Promise<void> => {
    try { await options.onProgress?.({ planned: pack.tasks.length, completed: tasks.length }) } catch {
      // Progress is advisory and must never change the canonical result.
    }
  }
  let reportedModel: string | null = null
  let reportedModelConflict = false
  for (let index = 0; index < pack.tasks.length; index++) {
    const task = pack.tasks[index]!
    if (preflightFailure) {
      const taskStatus: 'unavailable' | 'timeout' | 'cancelled' = preflightFailure.code === 'cancelled' ? 'cancelled' : preflightFailure.code === 'timeout' ? 'timeout' : 'unavailable'
      const taskCode: 'runtime-unavailable' | 'timeout' | 'cancelled' = preflightFailure.code === 'cancelled' ? 'cancelled' : preflightFailure.code === 'timeout' ? 'timeout' : 'runtime-unavailable'
      tasks.push(emptyTask(task.id, taskStatus, taskCode))
      await reportProgress()
      continue
    }
    if (options.signal?.aborted) { for (let rest = index; rest < pack.tasks.length; rest++) tasks.push(emptyTask(pack.tasks[rest]!.id, 'cancelled', 'cancelled')); await reportProgress(); break }
    try {
      const evidence = await runOllamaGenerate({ model, prompt: task.prompt, includeOutput: true, fetchImpl: options.fetchImpl, signal: options.signal, timeoutMs, monotonicNow })
      if (evidence.reportedModel !== null && !reportedModelConflict) {
        if (reportedModel === null) reportedModel = evidence.reportedModel
        else if (reportedModel !== evidence.reportedModel) {
          reportedModel = null
          reportedModelConflict = true
        }
      }
      if (evidence.output === undefined) throw new BenchOllamaError('malformed-response', 'The local runtime output was unavailable for transient scoring.')
      const scored = scoreBenchTaskV1(task, evidence.output)
      tasks.push({ taskId: task.id, attempted: true, status: scored.status, score: scored.score, outputDigest: scored.outputDigest, outputChars: scored.outputChars, requestLatencyMs: evidence.observed.requestLatencyMs, timeToFirstContentMs: evidence.observed.timeToFirstContentMs, runtimeReported: evidence.runtimeReported, failure: scored.status === 'passed' ? null : { code: scored.status === 'malformed' ? 'malformed-output' : 'scoring-failed', message: failureMessage(scored.status === 'malformed' ? 'malformed-output' : 'scoring-failed') } })
      await reportProgress()
    } catch (error) {
      const failure = asFailure(error)
      const status: BenchTaskRunStatusV1 = failure.code === 'cancelled' ? 'cancelled' : failure.code === 'timeout' ? 'timeout' : ['runtime-unavailable', 'transport-error', 'http-error', 'model-not-found', 'runtime-error', 'malformed-response', 'response-limit'].includes(failure.code) ? 'unavailable' : 'failed'
      tasks.push({ taskId: task.id, attempted: true, status, score: null, outputDigest: null, outputChars: null, requestLatencyMs: null, timeToFirstContentMs: null, runtimeReported: { ...EMPTY_RUNTIME_METRICS }, failure })
      await reportProgress()
      if (status === 'cancelled') { for (let rest = index + 1; rest < pack.tasks.length; rest++) tasks.push(emptyTask(pack.tasks[rest]!.id, 'cancelled', 'cancelled')); await reportProgress(); break }
      if (status === 'unavailable') { for (let rest = index + 1; rest < pack.tasks.length; rest++) tasks.push(emptyTask(pack.tasks[rest]!.id, 'unavailable', 'runtime-unavailable')); await reportProgress(); break }
    }
  }

  const resultWithoutDigest = {
    schemaVersion: BENCH_EVALUATION_SCHEMA_VERSION,
    runId,
    runner: { id: BENCH_TASK_RUNNER_ID, version: BENCH_TASK_RUNNER_VERSION },
    pack: { packId: pack.packId, version: pack.version, digest: pack.digest },
    model: { selected: model, reported: reportedModel },
    runtime: { id: 'ollama-local' as const, endpoint: OLLAMA_LOCAL_BASE_URL, version: runtimeVersion },
    environment: { os: platform() + ' ' + release(), arch: arch(), node: process.version },
    generation: { parameters: { ...FIXED_GENERATION_PARAMETERS }, policy: 'one-bounded-request-per-task' as const },
    startedAt,
    endedAt: isoNow(now),
    status: tasks.some(task => task.status === 'cancelled') ? 'cancelled' as const : tasks.some(task => task.status === 'unavailable' || task.status === 'timeout') ? 'unavailable' as const : 'completed' as const,
    tasks,
    aggregate: buildAggregate(tasks),
  }
  return { ...resultWithoutDigest, resultDigest: digestBenchEvaluationV1(resultWithoutDigest) }
}
