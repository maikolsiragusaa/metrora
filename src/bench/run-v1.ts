import { randomUUID } from 'node:crypto'
import { arch, platform, release } from 'node:os'
import {
  BENCH_RUNNER_ID,
  BENCH_RUNNER_VERSION,
  BENCH_RUN_SCHEMA_VERSION,
  FIXED_GENERATION_PARAMETERS,
  MEASURED_RUN_COUNT,
  WARMUP_RUN_COUNT,
  type BenchAggregateV1,
  type BenchFailureCode,
  type BenchPhase,
  type BenchRunEvidenceV1,
  type BenchRunV1,
  type NumericSummaryV1,
  type ObservedMetricsV1,
  type RuntimeReportedMetricsV1,
} from './contract-v1.js'
import { SYNTHETIC_FIXTURE_DIGEST, SYNTHETIC_FIXTURE_PACK } from './fixture-v1.js'
import {
  BenchOllamaError,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  fetchOllamaVersion,
  OLLAMA_LOCAL_BASE_URL,
  runOllamaGenerate,
  validateOllamaModelId,
  type BenchFetch,
} from './ollama-local.js'
import { sha256Json } from './serialization.js'

export type BenchRunOptions = {
  model: string
  fetchImpl?: BenchFetch
  signal?: AbortSignal
  timeoutMs?: number
  now?: () => Date
  monotonicNow?: () => number
  runId?: string
}

type FailureRecord = {
  phase: BenchPhase | 'preflight'
  index: number
  code: BenchFailureCode
  message: string
}

const EMPTY_RUNTIME_METRICS: RuntimeReportedMetricsV1 = {
  totalDurationNs: null,
  loadDurationNs: null,
  promptEvalCount: null,
  promptEvalDurationNs: null,
  evalCount: null,
  evalDurationNs: null,
}

const EMPTY_OBSERVED_METRICS: ObservedMetricsV1 = {
  requestLatencyMs: null,
  timeToFirstContentMs: null,
  responseBytes: 0,
  streamChunks: 0,
  streamEvents: 0,
  outputChars: 0,
  outputDigest: null,
}

function isoNow(now: () => Date): string {
  return now().toISOString()
}

function failureMessage(code: BenchFailureCode, fallback: string): string {
  switch (code) {
    case 'runtime-unavailable':
    case 'transport-error':
      return `Ollama local runtime unavailable at ${OLLAMA_LOCAL_BASE_URL}. Start Ollama and retry.`
    case 'model-not-found':
      return 'Ollama could not find the selected local model.'
    case 'timeout':
      return `Ollama local request timed out after the bounded timeout.`
    case 'cancelled':
      return 'BenchRunV1 cancellation requested; remaining runs were not started.'
    case 'malformed-response':
      return 'Ollama returned malformed runtime data; the run failed closed.'
    case 'response-limit':
      return 'Ollama response exceeded the bounded BenchRunV1 response limit.'
    case 'runtime-error':
      return 'Ollama reported a generation failure for the selected model.'
    case 'http-error':
      return fallback.startsWith('Ollama returned HTTP') ? fallback : 'Ollama local runtime returned an HTTP error.'
  }
}

function asFailure(error: unknown): { code: BenchFailureCode; message: string } {
  if (error instanceof BenchOllamaError) {
    return { code: error.code, message: failureMessage(error.code, error.message) }
  }
  return {
    code: 'transport-error',
    message: failureMessage('transport-error', 'Ollama local runtime request failed.'),
  }
}

function numericSummary(values: number[]): NumericSummaryV1 | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
  return {
    count: sorted.length,
    min: sorted[0]!,
    median,
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  }
}

function successfulMeasuredRuns(runs: BenchRunEvidenceV1[]): BenchRunEvidenceV1[] {
  return runs.filter(run => run.phase === 'measured' && run.status === 'success')
}

function metricValues(runs: BenchRunEvidenceV1[], read: (run: BenchRunEvidenceV1) => number | null): number[] {
  return successfulMeasuredRuns(runs)
    .map(read)
    .filter((value): value is number => value !== null)
}

function buildAggregate(runs: BenchRunEvidenceV1[], exclusions: BenchRunV1['exclusions']): BenchAggregateV1 {
  const measuredRuns = runs.filter(run => run.phase === 'measured')
  const successful = successfulMeasuredRuns(runs)
  return {
    measured: {
      planned: MEASURED_RUN_COUNT,
      attempted: measuredRuns.length,
      successful: successful.length,
      failed: measuredRuns.filter(run => run.status !== 'success').length,
      excluded: exclusions.filter(exclusion => exclusion.phase === 'measured').length,
      observed: {
        requestLatencyMs: numericSummary(metricValues(runs, run => run.observed.requestLatencyMs)),
        timeToFirstContentMs: numericSummary(metricValues(runs, run => run.observed.timeToFirstContentMs)),
        outputChars: numericSummary(metricValues(runs, run => run.observed.outputChars)),
      },
      runtimeReported: {
        totalDurationNs: numericSummary(metricValues(runs, run => run.runtimeReported.totalDurationNs)),
        loadDurationNs: numericSummary(metricValues(runs, run => run.runtimeReported.loadDurationNs)),
        promptEvalCount: numericSummary(metricValues(runs, run => run.runtimeReported.promptEvalCount)),
        promptEvalDurationNs: numericSummary(metricValues(runs, run => run.runtimeReported.promptEvalDurationNs)),
        evalCount: numericSummary(metricValues(runs, run => run.runtimeReported.evalCount)),
        evalDurationNs: numericSummary(metricValues(runs, run => run.runtimeReported.evalDurationNs)),
      },
    },
  }
}

function resultDigest(input: {
  model: BenchRunV1['model']
  runtimeVersion: string | null
  runs: BenchRunEvidenceV1[]
}): string {
  return sha256Json({
    schemaVersion: BENCH_RUN_SCHEMA_VERSION,
    runner: { id: BENCH_RUNNER_ID, version: BENCH_RUNNER_VERSION },
    fixtureDigest: SYNTHETIC_FIXTURE_DIGEST,
    model: input.model,
    runtimeVersion: input.runtimeVersion,
    generation: {
      parameters: FIXED_GENERATION_PARAMETERS,
      warmupCount: WARMUP_RUN_COUNT,
      measuredRunCount: MEASURED_RUN_COUNT,
    },
    runs: input.runs.map(run => ({
      phase: run.phase,
      index: run.index,
      status: run.status,
      reportedModel: run.reportedModel,
      outputDigest: run.observed.outputDigest,
      outputChars: run.observed.outputChars,
      promptEvalCount: run.runtimeReported.promptEvalCount,
      evalCount: run.runtimeReported.evalCount,
      failure: run.failure?.code ?? null,
    })),
  })
}

function makeExclusions(
  exclusions: BenchRunV1['exclusions'],
  phase: BenchPhase,
  startIndex: number,
  reason: 'not-started-after-failure' | 'not-started-after-cancellation',
): void {
  const endIndex = phase === 'warmup' ? WARMUP_RUN_COUNT : MEASURED_RUN_COUNT
  for (let index = startIndex; index <= endIndex; index++) exclusions.push({ phase, index, reason })
}

function makeRunEvidence(
  phase: BenchPhase,
  index: number,
  now: () => Date,
  status: BenchRunEvidenceV1['status'],
  reportedModel: string | null,
  observed: ObservedMetricsV1,
  runtimeReported: RuntimeReportedMetricsV1,
  failure: BenchRunEvidenceV1['failure'],
  startedAt: string,
): BenchRunEvidenceV1 {
  return {
    phase,
    index,
    status,
    startedAt,
    endedAt: isoNow(now),
    reportedModel,
    observed,
    runtimeReported,
    failure,
  }
}

export function validateBenchTimeoutMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 50 || value > 120_000) {
    throw new Error('timeout must be an integer from 50 to 120000 milliseconds')
  }
  return value
}

export async function runBenchRunV1(options: BenchRunOptions): Promise<BenchRunV1> {
  const model = validateOllamaModelId(options.model)
  const now = options.now ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const timeoutMs = validateBenchTimeoutMs(options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS)
  const startedAt = isoNow(now)
  let runtimeVersion: string | null = null
  const runs: BenchRunEvidenceV1[] = []
  const failures: BenchRunV1['failures'] = []
  const exclusions: BenchRunV1['exclusions'] = []
  let termination: BenchRunV1['termination'] = { status: 'none', phase: null, index: null }
  let status: BenchRunV1['status'] = 'completed'

  try {
    runtimeVersion = await fetchOllamaVersion({
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      timeoutMs,
    })
  } catch (error) {
    const failure = asFailure(error)
    failures.push({ phase: 'preflight', index: 0, ...failure })
    status = failure.code === 'cancelled' ? 'cancelled' : 'failed'
    termination = {
      status: failure.code === 'cancelled' ? 'cancelled' : failure.code === 'timeout' ? 'timeout' : 'none',
      phase: 'preflight',
      index: 0,
    }
    makeExclusions(exclusions, 'warmup', 1, failure.code === 'cancelled' ? 'not-started-after-cancellation' : 'not-started-after-failure')
    makeExclusions(exclusions, 'measured', 1, failure.code === 'cancelled' ? 'not-started-after-cancellation' : 'not-started-after-failure')
  }

  const runOne = async (phase: BenchPhase, index: number): Promise<BenchRunEvidenceV1> => {
    const runStartedAt = isoNow(now)
    try {
      if (options.signal?.aborted) throw new BenchOllamaError('cancelled', 'BenchRunV1 cancellation requested.')
      const evidence = await runOllamaGenerate({
        model,
        fetchImpl: options.fetchImpl,
        signal: options.signal,
        timeoutMs,
        monotonicNow,
      })
      return makeRunEvidence(
        phase,
        index,
        now,
        'success',
        evidence.reportedModel,
        evidence.observed,
        evidence.runtimeReported,
        null,
        runStartedAt,
      )
    } catch (error) {
      const failure = asFailure(error)
      return makeRunEvidence(
        phase,
        index,
        now,
        failure.code === 'cancelled' ? 'cancelled' : 'failed',
        null,
        { ...EMPTY_OBSERVED_METRICS },
        { ...EMPTY_RUNTIME_METRICS },
        failure,
        runStartedAt,
      )
    }
  }

  if (failures.length === 0) {
    const warmup = await runOne('warmup', 1)
    runs.push(warmup)
    if (warmup.failure) {
      failures.push({ phase: warmup.phase, index: warmup.index, ...warmup.failure })
      status = warmup.status === 'cancelled' ? 'cancelled' : 'failed'
      termination = {
        status: warmup.status === 'cancelled' ? 'cancelled' : warmup.failure.code === 'timeout' ? 'timeout' : 'none',
        phase: warmup.phase,
        index: warmup.index,
      }
      makeExclusions(exclusions, 'measured', 1, warmup.status === 'cancelled' ? 'not-started-after-cancellation' : 'not-started-after-failure')
    }
  }

  if (failures.length === 0) {
    for (let index = 1; index <= MEASURED_RUN_COUNT; index++) {
      if (options.signal?.aborted) {
        status = 'cancelled'
        termination = { status: 'cancelled', phase: 'measured', index }
        makeExclusions(exclusions, 'measured', index, 'not-started-after-cancellation')
        break
      }
      const measured = await runOne('measured', index)
      runs.push(measured)
      if (measured.failure) {
        failures.push({ phase: measured.phase, index: measured.index, ...measured.failure })
        status = measured.status === 'cancelled' ? 'cancelled' : 'failed'
        termination = {
          status: measured.status === 'cancelled' ? 'cancelled' : measured.failure.code === 'timeout' ? 'timeout' : 'none',
          phase: measured.phase,
          index: measured.index,
        }
        makeExclusions(exclusions, 'measured', index + 1, measured.status === 'cancelled' ? 'not-started-after-cancellation' : 'not-started-after-failure')
        break
      }
    }
  }

  const reportedModels = [...new Set(runs
    .map(run => run.reportedModel)
    .filter((value): value is string => value !== null))]
  const resultModel = { selected: model, reported: reportedModels.length === 1 ? reportedModels[0]! : null }

  const aggregate = buildAggregate(runs, exclusions)
  const result: BenchRunV1 = {
    schemaVersion: BENCH_RUN_SCHEMA_VERSION,
    runId: options.runId ?? randomUUID(),
    runner: { id: BENCH_RUNNER_ID, version: BENCH_RUNNER_VERSION },
    fixture: {
      packId: SYNTHETIC_FIXTURE_PACK.packId,
      version: SYNTHETIC_FIXTURE_PACK.version,
      caseId: SYNTHETIC_FIXTURE_PACK.caseId,
      digest: SYNTHETIC_FIXTURE_DIGEST,
    },
    model: resultModel,
    runtime: {
      id: 'ollama-local',
      endpoint: OLLAMA_LOCAL_BASE_URL,
      version: runtimeVersion,
    },
    environment: {
      os: `${platform()} ${release()}`,
      arch: arch(),
      node: process.version,
    },
    generation: {
      parameters: { ...FIXED_GENERATION_PARAMETERS },
      warmupCount: WARMUP_RUN_COUNT,
      measuredRunCount: MEASURED_RUN_COUNT,
      fixturePolicy: 'same-versioned-synthetic-fixture-for-every-request',
    },
    startedAt,
    endedAt: isoNow(now),
    status,
    termination,
    runs,
    failures,
    exclusions,
    aggregate,
    resultDigest: '',
  }
  result.resultDigest = resultDigest({ model: result.model, runtimeVersion, runs })
  return result
}
