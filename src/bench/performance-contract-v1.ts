import { sha256Json } from './serialization.js'

export const PERFORMANCE_BENCH_SCHEMA_VERSION = 'metrora.bench.performance.v1' as const
export const PERFORMANCE_BENCH_METHOD_ID = 'metrora.performance.llama-bench.v1' as const
export const PERFORMANCE_BENCH_METHOD_VERSION = '1' as const
export const PERFORMANCE_BENCH_RUNNER_ID = 'llama-bench' as const
export const PERFORMANCE_BENCH_RUNNER_VERSION = '1.0.0' as const
export const PERFORMANCE_BENCH_RUNTIME_ID = 'llama.cpp-native' as const

export const PERFORMANCE_HISTORY_KIND = 'metrora.performance-history.v1' as const
export const PERFORMANCE_HISTORY_VERSION = 1 as const

export type PerformanceFlashAttentionV1 = 'auto' | 'on' | 'off'
export type PerformanceSplitModeV1 = 'none' | 'layer' | 'row'
export type PerformanceObservedSplitModeV1 = PerformanceSplitModeV1 | 'tensor'
export type PerformanceTerminationStatusV1 = 'none' | 'timeout' | 'cancelled' | 'output-limit' | 'spawn-error' | 'malformed-output'
export type PerformanceStatusV1 = 'completed' | 'unavailable' | 'failed' | 'cancelled'

/**
 * The complete bounded setup accepted by the native adapter. There is no
 * free-form flag field: every value becomes one known llama-bench argument.
 */
export type PerformanceSetupV1 = {
  repetitions: number
  promptTokens: number
  generationTokens: number
  batchSize: number
  ubatchSize: number
  threads: number | null
  gpuLayers: number
  flashAttention: PerformanceFlashAttentionV1
  splitMode: PerformanceSplitModeV1
  mainGpu: number | null
  warmup: boolean
}

/**
 * Values echoed by llama-bench for the actual native run. A null value means
 * the upstream row did not expose that field; it is never filled from the
 * declared setup just to make an evidence record look complete.
 */
export type PerformanceObservedConfigurationV1 = {
  batchSize: number | null
  ubatchSize: number | null
  threads: number | null
  gpuLayers: number | null
  splitMode: PerformanceObservedSplitModeV1 | null
  mainGpu: number | null
  flashAttention: PerformanceFlashAttentionV1 | null
  promptTokens: number | null
  generationTokens: number | null
  repetitions: number | null
  depth: number | null
}

export type PerformanceWorkloadV1 = {
  workload: 'prefill' | 'decode' | 'mixed' | 'unknown'
  promptTokens: number | null
  generationTokens: number | null
  depth: number | null
  repetitions: number | null
  throughputTokensPerSecond: number | null
  throughputStddevTokensPerSecond: number | null
  averageTimeNs: number | null
  averageLatencyMs: number | null
  testTime: string | null
}

export type PerformanceRunV1 = {
  schemaVersion: typeof PERFORMANCE_BENCH_SCHEMA_VERSION
  runId: string
  runner: { id: typeof PERFORMANCE_BENCH_RUNNER_ID; version: typeof PERFORMANCE_BENCH_RUNNER_VERSION }
  methodology: {
    id: typeof PERFORMANCE_BENCH_METHOD_ID
    version: typeof PERFORMANCE_BENCH_METHOD_VERSION
    setup: PerformanceSetupV1
    argvDigest: string
  }
  model: {
    selected: string
    reported: string | null
    type: string | null
    sizeBytes: number | null
    parameterCount: number | null
  }
  executable: { name: string }
  runtime: {
    id: typeof PERFORMANCE_BENCH_RUNTIME_ID
    buildCommit: string | null
    buildNumber: number | null
    version: string | null
    backends: string[]
  }
  hardware: { cpuInfo: string | null; gpuInfo: string | null; devices: string[] }
  environment: { os: string; arch: string; node: string }
  startedAt: string
  endedAt: string
  status: PerformanceStatusV1
  termination: { status: PerformanceTerminationStatusV1 }
  failure: { code: string; message: string } | null
  observedConfiguration: PerformanceObservedConfigurationV1 | null
  workloads: PerformanceWorkloadV1[]
  resultDigest: string
}

/**
 * Result identity intentionally excludes wall-clock timestamps and process
 * diagnostics. A rerun with the same declared setup and measured values has
 * the same content digest; missing upstream values remain null.
 */
export function performanceResultDigest(record: Pick<PerformanceRunV1, 'methodology' | 'model' | 'executable' | 'runtime' | 'hardware' | 'status' | 'termination' | 'failure' | 'workloads'>): string {
  return sha256Json({
    methodology: record.methodology,
    model: record.model,
    executable: record.executable,
    runtime: record.runtime,
    hardware: record.hardware,
    status: record.status,
    termination: record.termination,
    failure: record.failure,
    observedConfiguration: 'observedConfiguration' in record ? record.observedConfiguration : null,
    workloads: record.workloads,
  })
}
