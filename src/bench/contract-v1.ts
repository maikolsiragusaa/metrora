export const BENCH_RUN_SCHEMA_VERSION = 'metrora.bench-run.v1'
export const BENCH_RUNNER_ID = 'ollama-local-v1'
export const BENCH_RUNNER_VERSION = '1.0.0'
export const WARMUP_RUN_COUNT = 1
export const MEASURED_RUN_COUNT = 5

export const FIXED_GENERATION_PARAMETERS = {
  temperature: 0,
  seed: 1729,
  numPredict: 64,
} as const

export type BenchRunStatus = 'completed' | 'failed' | 'cancelled'
export type BenchTerminationStatus = 'none' | 'cancelled' | 'timeout'
export type BenchPhase = 'warmup' | 'measured'

export type BenchFailureCode =
  | 'runtime-unavailable'
  | 'transport-error'
  | 'http-error'
  | 'model-not-found'
  | 'runtime-error'
  | 'malformed-response'
  | 'response-limit'
  | 'timeout'
  | 'cancelled'

export type RuntimeReportedMetricsV1 = {
  totalDurationNs: number | null
  loadDurationNs: number | null
  promptEvalCount: number | null
  promptEvalDurationNs: number | null
  evalCount: number | null
  evalDurationNs: number | null
}

export type ObservedMetricsV1 = {
  requestLatencyMs: number | null
  timeToFirstContentMs: number | null
  responseBytes: number
  streamChunks: number
  streamEvents: number
  outputChars: number
  outputDigest: string | null
}

export type BenchRunEvidenceV1 = {
  phase: BenchPhase
  index: number
  status: 'success' | 'failed' | 'cancelled'
  startedAt: string
  endedAt: string
  reportedModel: string | null
  observed: ObservedMetricsV1
  runtimeReported: RuntimeReportedMetricsV1
  failure: { code: BenchFailureCode; message: string } | null
}

export type NumericSummaryV1 = {
  count: number
  min: number
  median: number
  max: number
  mean: number
}

export type BenchAggregateV1 = {
  measured: {
    planned: number
    attempted: number
    successful: number
    failed: number
    excluded: number
    observed: {
      requestLatencyMs: NumericSummaryV1 | null
      timeToFirstContentMs: NumericSummaryV1 | null
      outputChars: NumericSummaryV1 | null
    }
    runtimeReported: {
      totalDurationNs: NumericSummaryV1 | null
      loadDurationNs: NumericSummaryV1 | null
      promptEvalCount: NumericSummaryV1 | null
      promptEvalDurationNs: NumericSummaryV1 | null
      evalCount: NumericSummaryV1 | null
      evalDurationNs: NumericSummaryV1 | null
    }
  }
}

export type BenchRunV1 = {
  schemaVersion: typeof BENCH_RUN_SCHEMA_VERSION
  runId: string
  runner: {
    id: typeof BENCH_RUNNER_ID
    version: typeof BENCH_RUNNER_VERSION
  }
  fixture: {
    packId: string
    version: string
    caseId: string
    digest: string
  }
  model: {
    selected: string
    reported: string | null
  }
  runtime: {
    id: 'ollama-local'
    endpoint: 'http://127.0.0.1:11434'
    version: string | null
  }
  environment: {
    os: string
    arch: string
    node: string
  }
  generation: {
    parameters: {
      temperature: number
      seed: number
      numPredict: number
    }
    warmupCount: typeof WARMUP_RUN_COUNT
    measuredRunCount: typeof MEASURED_RUN_COUNT
    fixturePolicy: 'same-versioned-synthetic-fixture-for-every-request'
  }
  startedAt: string
  endedAt: string
  status: BenchRunStatus
  termination: {
    status: BenchTerminationStatus
    phase: BenchPhase | 'preflight' | null
    index: number | null
  }
  runs: BenchRunEvidenceV1[]
  failures: Array<{
    phase: BenchPhase | 'preflight'
    index: number
    code: BenchFailureCode
    message: string
  }>
  exclusions: Array<{
    phase: BenchPhase
    index: number
    reason: 'not-started-after-failure' | 'not-started-after-cancellation'
  }>
  aggregate: BenchAggregateV1
  resultDigest: string
}
