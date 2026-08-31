import type { BenchComparisonV1 } from './compare-v1.js'
import type { BenchEvaluationV1 } from './task-pack-run-v1.js'
import type { PerformanceComparisonV1 } from './performance-compare-v1.js'
import type { PerformanceRunV1 } from './performance-contract-v1.js'

export const BENCH_EVIDENCE_SCHEMA_VERSION = 'metrora.bench-evidence.v1' as const
export const BENCH_EVIDENCE_MAX_RECORDS = 50

export type BenchEvidencePeriodV1 = 'today' | 'week' | '30days' | 'month' | 'all' | 'lifetime'
export type BenchEvidenceRangeV1 = { from: string; to: string }
export type BenchEvidenceScopeV1 = {
  period: BenchEvidencePeriodV1
  range: BenchEvidenceRangeV1 | null
  provider: string
  projectId: string
  model: string | null
}
export type BenchEvidenceStateV1 = 'NO_DATA' | 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL' | 'NOT_COMPARABLE'
export type CanonicalBenchEvidenceV1 = {
  schemaVersion: typeof BENCH_EVIDENCE_SCHEMA_VERSION
  scope: BenchEvidenceScopeV1
  core: {
    state: BenchEvidenceStateV1
    latest: BenchEvaluationV1 | null
    history: BenchEvaluationV1[]
    comparison: BenchComparisonV1 | null
    invalidCount: number
  }
  performance: {
    state: BenchEvidenceStateV1
    latest: PerformanceRunV1 | null
    history: PerformanceRunV1[]
    comparison: PerformanceComparisonV1 | null
    invalidCount: number
  }
}

export type CanonicalBenchEvidenceOptionsV1 = {
  dataDir?: string
  period?: BenchEvidencePeriodV1
  range?: BenchEvidenceRangeV1 | null
  provider?: string
  projectId?: string
  model?: string | null
  limit?: number
}

export type { BenchComparisonV1, BenchEvaluationV1, PerformanceComparisonV1, PerformanceRunV1 }
