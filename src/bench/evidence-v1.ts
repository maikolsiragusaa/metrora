import { getDateRange, type Period } from '../cli-date.js'
import { scanBenchHistoryV1 } from './history-v1.js'
import { compareBenchEvaluationsV1, type BenchComparisonV1 } from './compare-v1.js'
import { scanPerformanceHistoryV1 } from './performance-history-v1.js'
import { comparePerformanceRunsV1, type PerformanceComparisonV1 } from './performance-compare-v1.js'
import type { BenchEvaluationV1 } from './task-pack-run-v1.js'
import type { PerformanceRunV1 } from './performance-contract-v1.js'

export const BENCH_EVIDENCE_SCHEMA_VERSION = 'metrora.bench-evidence.v1' as const
export const BENCH_EVIDENCE_MAX_RECORDS = 50

export type BenchEvidenceRangeV1 = { from: string; to: string }
export type BenchEvidenceScopeV1 = {
  period: Period
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
  period?: Period
  range?: BenchEvidenceRangeV1 | null
  provider?: string
  projectId?: string
  model?: string | null
  limit?: number
}

function localDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const monthIndex = month! - 1
  const date = new Date(year!, monthIndex, day!)
  return date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day ? date : null
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function rangeFor(options: CanonicalBenchEvidenceOptionsV1): { start: Date; end: Date } {
  if (!options.range) return getDateRange(options.period ?? 'all').range
  const start = localDate(options.range.from)
  const end = localDate(options.range.to)
  if (!start || !end || start > end) throw new Error('Bench evidence date range is invalid')
  return { start, end: endOfDay(end) }
}

function validLimit(value: number | undefined): number {
  return value === undefined ? 10 : Number.isSafeInteger(value) && value >= 1 && value <= BENCH_EVIDENCE_MAX_RECORDS ? value : 10
}

function withinScope(startedAt: string, model: { selected: string; reported: string | null }, options: CanonicalBenchEvidenceOptionsV1, range: { start: Date; end: Date }): boolean {
  if ((options.provider ?? 'all') !== 'all' || (options.projectId ?? 'all') !== 'all') return false
  if (options.model && options.model !== model.selected && options.model !== model.reported) return false
  const timestamp = Date.parse(startedAt)
  return Number.isFinite(timestamp) && timestamp >= range.start.getTime() && timestamp <= range.end.getTime()
}

function isGlobal(options: CanonicalBenchEvidenceOptionsV1): boolean {
  return (options.provider ?? 'all') === 'all'
    && (options.projectId ?? 'all') === 'all'
    && !options.model
    && !options.range
    && ((options.period ?? 'all') === 'all' || (options.period ?? 'all') === 'lifetime')
}

function coreState(history: BenchEvaluationV1[], invalidCount: number, comparison: BenchComparisonV1 | null): BenchEvidenceStateV1 {
  if (!history.length) return invalidCount ? 'UNAVAILABLE' : 'NO_DATA'
  const latest = history[0]!
  if (comparison && !comparison.compatible) return 'NOT_COMPARABLE'
  if (latest.status !== 'completed') return history.some(record => record.status === 'completed') ? 'PARTIAL' : 'UNAVAILABLE'
  return invalidCount > 0 || history.some(record => record.status !== 'completed') || latest.aggregate.attempted < latest.aggregate.planned
    ? 'PARTIAL'
    : 'AVAILABLE'
}

function performanceState(history: PerformanceRunV1[], invalidCount: number, comparison: PerformanceComparisonV1 | null): BenchEvidenceStateV1 {
  if (!history.length) return invalidCount ? 'UNAVAILABLE' : 'NO_DATA'
  const latest = history[0]!
  if (comparison && !comparison.compatible) return 'NOT_COMPARABLE'
  if (latest.status !== 'completed') return history.some(record => record.status === 'completed') ? 'PARTIAL' : 'UNAVAILABLE'
  return invalidCount > 0 || history.some(record => record.status !== 'completed') ? 'PARTIAL' : 'AVAILABLE'
}

/**
 * Canonical factual aggregation for both local Bench families. Electron
 * Harness and MCP adapters consume this source; neither transport recomputes
 * scope, latest/previous selection, or comparisons.
 */
export async function readCanonicalBenchEvidenceV1(options: CanonicalBenchEvidenceOptionsV1 = {}): Promise<CanonicalBenchEvidenceV1> {
  const period = options.period ?? 'all'
  const scope: BenchEvidenceScopeV1 = {
    period,
    range: options.range ?? null,
    provider: options.provider ?? 'all',
    projectId: options.projectId ?? 'all',
    model: options.model ?? null,
  }
  const range = rangeFor(options)
  const limit = validLimit(options.limit)
  const [coreScan, performanceScan] = await Promise.all([
    scanBenchHistoryV1({ dataDir: options.dataDir }),
    scanPerformanceHistoryV1({ dataDir: options.dataDir }),
  ])
  const coreHistory = coreScan.records.filter(record => withinScope(record.startedAt, record.model, options, range)).slice(0, limit)
  const performanceHistory = performanceScan.records.filter(record => withinScope(record.startedAt, record.model, options, range)).slice(0, limit)
  const coreLatest = coreHistory[0] ?? null
  const corePrevious = coreHistory[1] ?? null
  const performanceLatest = performanceHistory[0] ?? null
  const performancePrevious = performanceHistory[1] ?? null
  const coreComparison = coreLatest && corePrevious ? compareBenchEvaluationsV1(corePrevious, coreLatest) : null
  const performanceComparison = performanceLatest && performancePrevious ? comparePerformanceRunsV1(performancePrevious, performanceLatest) : null
  const global = isGlobal(options)
  const coreInvalidCount = global ? coreScan.invalid.length : 0
  const performanceInvalidCount = global ? performanceScan.invalid.length : 0
  return {
    schemaVersion: BENCH_EVIDENCE_SCHEMA_VERSION,
    scope,
    core: {
      state: coreState(coreHistory, coreInvalidCount, coreComparison),
      latest: coreLatest,
      history: coreHistory,
      comparison: coreComparison,
      invalidCount: coreInvalidCount,
    },
    performance: {
      state: performanceState(performanceHistory, performanceInvalidCount, performanceComparison),
      latest: performanceLatest,
      history: performanceHistory,
      comparison: performanceComparison,
      invalidCount: performanceInvalidCount,
    },
  }
}
