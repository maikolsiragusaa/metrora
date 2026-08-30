import {
  PERFORMANCE_BENCH_METHOD_ID,
  PERFORMANCE_BENCH_METHOD_VERSION,
  PERFORMANCE_BENCH_SCHEMA_VERSION,
  type PerformanceRunV1,
} from './performance-contract-v1.js'

export const PERFORMANCE_COMPARISON_SCHEMA_VERSION = 'metrora.performance-comparison.v1' as const

export type PerformanceComparisonReasonV1 = 'compatible' | 'methodology-mismatch' | 'runner-mismatch' | 'setup-mismatch' | 'hardware-mismatch' | 'incomplete-run' | 'missing-metrics'
export type PerformanceComparisonDeltaV1 = {
  prefillThroughputTokensPerSecond: number | null
  decodeThroughputTokensPerSecond: number | null
  prefillLatencyMs: number | null
  decodeLatencyMs: number | null
}
export type PerformanceComparisonV1 = {
  schemaVersion: typeof PERFORMANCE_COMPARISON_SCHEMA_VERSION
  compatible: boolean
  reason: PerformanceComparisonReasonV1
  left: { runId: string; model: string; endedAt: string }
  right: { runId: string; model: string; endedAt: string }
  deltas: PerformanceComparisonDeltaV1 | null
}

function sameSetup(left: PerformanceRunV1, right: PerformanceRunV1): boolean {
  return JSON.stringify(left.methodology.setup) === JSON.stringify(right.methodology.setup)
}

function sameHardware(left: PerformanceRunV1, right: PerformanceRunV1): boolean {
  return left.runtime.buildCommit === right.runtime.buildCommit
    && left.runtime.buildNumber === right.runtime.buildNumber
    && JSON.stringify(left.runtime.backends) === JSON.stringify(right.runtime.backends)
    && left.hardware.cpuInfo === right.hardware.cpuInfo
    && left.hardware.gpuInfo === right.hardware.gpuInfo
    && JSON.stringify(left.hardware.devices) === JSON.stringify(right.hardware.devices)
    && left.environment.os === right.environment.os
    && left.environment.arch === right.environment.arch
}

function metric(run: PerformanceRunV1, workload: 'prefill' | 'decode', key: 'throughputTokensPerSecond' | 'averageLatencyMs'): number | null {
  const row = run.workloads.find(item => item.workload === workload)
  const value = row?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function delta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : right - left
}

export function comparePerformanceRunsV1(left: PerformanceRunV1, right: PerformanceRunV1): PerformanceComparisonV1 {
  const base = {
    left: { runId: left.runId, model: left.model.selected, endedAt: left.endedAt },
    right: { runId: right.runId, model: right.model.selected, endedAt: right.endedAt },
  }
  let reason: PerformanceComparisonReasonV1 = 'compatible'
  if (left.methodology.id !== PERFORMANCE_BENCH_METHOD_ID || right.methodology.id !== PERFORMANCE_BENCH_METHOD_ID || left.methodology.version !== PERFORMANCE_BENCH_METHOD_VERSION || right.methodology.version !== PERFORMANCE_BENCH_METHOD_VERSION) reason = 'methodology-mismatch'
  else if (left.runner.id !== right.runner.id || left.runner.version !== right.runner.version) reason = 'runner-mismatch'
  else if (!sameSetup(left, right)) reason = 'setup-mismatch'
  else if (!sameHardware(left, right)) reason = 'hardware-mismatch'
  else if (left.status !== 'completed' || right.status !== 'completed') reason = 'incomplete-run'
  else if (![
    [metric(left, 'prefill', 'throughputTokensPerSecond'), metric(right, 'prefill', 'throughputTokensPerSecond')],
    [metric(left, 'decode', 'throughputTokensPerSecond'), metric(right, 'decode', 'throughputTokensPerSecond')],
    [metric(left, 'prefill', 'averageLatencyMs'), metric(right, 'prefill', 'averageLatencyMs')],
    [metric(left, 'decode', 'averageLatencyMs'), metric(right, 'decode', 'averageLatencyMs')],
  ].some(([leftValue, rightValue]) => leftValue !== null && rightValue !== null)) reason = 'missing-metrics'
  if (reason !== 'compatible') return { schemaVersion: PERFORMANCE_COMPARISON_SCHEMA_VERSION, compatible: false, reason, ...base, deltas: null }
  return {
    schemaVersion: PERFORMANCE_COMPARISON_SCHEMA_VERSION,
    compatible: true,
    reason,
    ...base,
    deltas: {
      prefillThroughputTokensPerSecond: delta(metric(left, 'prefill', 'throughputTokensPerSecond'), metric(right, 'prefill', 'throughputTokensPerSecond')),
      decodeThroughputTokensPerSecond: delta(metric(left, 'decode', 'throughputTokensPerSecond'), metric(right, 'decode', 'throughputTokensPerSecond')),
      prefillLatencyMs: delta(metric(left, 'prefill', 'averageLatencyMs'), metric(right, 'prefill', 'averageLatencyMs')),
      decodeLatencyMs: delta(metric(left, 'decode', 'averageLatencyMs'), metric(right, 'decode', 'averageLatencyMs')),
    },
  }
}
