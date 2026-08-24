import type { BenchEvaluationV1 } from './task-pack-run-v1.js'

export const BENCH_COMPARISON_SCHEMA_VERSION = 'metrora.bench-comparison.v1' as const
type CompareReason = 'compatible' | 'pack-mismatch' | 'runner-mismatch' | 'scoring-mismatch' | 'generation-mismatch'
export type BenchComparisonV1 = {
  schemaVersion: typeof BENCH_COMPARISON_SCHEMA_VERSION
  compatible: boolean
  reason: CompareReason
  left: { runId: string; model: string; endedAt: string }
  right: { runId: string; model: string; endedAt: string }
  deltas: { score: number | null; passed: number; failed: number; unavailable: number; cancelled: number; medianRequestLatencyMs: number | null; medianFirstContentMs: number | null } | null
}
function median(values: number[]): number | null { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2 }
function reason(left: BenchEvaluationV1, right: BenchEvaluationV1): CompareReason {
  if (left.pack.packId !== right.pack.packId || left.pack.version !== right.pack.version || left.pack.digest !== right.pack.digest) return 'pack-mismatch'
  if (left.runner.id !== right.runner.id || left.runner.version !== right.runner.version) return 'runner-mismatch'
  if (left.tasks.length !== right.tasks.length || left.tasks.some((task, index) => task.taskId !== right.tasks[index]?.taskId)) return 'scoring-mismatch'
  if (JSON.stringify(left.generation) !== JSON.stringify(right.generation)) return 'generation-mismatch'
  return 'compatible'
}
function summary(result: BenchEvaluationV1) { return { runId: result.runId, model: result.model.selected, endedAt: result.endedAt } }
function metric(result: BenchEvaluationV1, key: 'requestLatencyMs' | 'timeToFirstContentMs'): number[] { return result.tasks.map(task => task[key]).filter((value): value is number => value !== null) }
export function compareBenchEvaluationsV1(left: BenchEvaluationV1, right: BenchEvaluationV1): BenchComparisonV1 {
  const comparisonReason = reason(left, right)
  const base = { schemaVersion: BENCH_COMPARISON_SCHEMA_VERSION, compatible: comparisonReason === 'compatible', reason: comparisonReason, left: summary(left), right: summary(right) }
  if (comparisonReason !== 'compatible') return { ...base, deltas: null }
  const leftLatency = median(metric(left, 'requestLatencyMs'))
  const rightLatency = median(metric(right, 'requestLatencyMs'))
  const leftFirst = median(metric(left, 'timeToFirstContentMs'))
  const rightFirst = median(metric(right, 'timeToFirstContentMs'))
  return {
    ...base,
    deltas: {
      score: left.aggregate.score.value === null || right.aggregate.score.value === null ? null : right.aggregate.score.value - left.aggregate.score.value,
      passed: right.aggregate.passed - left.aggregate.passed,
      failed: right.aggregate.failed - left.aggregate.failed,
      unavailable: right.aggregate.unavailable - left.aggregate.unavailable,
      cancelled: right.aggregate.cancelled - left.aggregate.cancelled,
      medianRequestLatencyMs: leftLatency === null || rightLatency === null ? null : rightLatency - leftLatency,
      medianFirstContentMs: leftFirst === null || rightFirst === null ? null : rightFirst - leftFirst,
    },
  }
}
