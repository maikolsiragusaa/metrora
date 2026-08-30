import type { BenchComparison, BenchEvaluation, BenchHistoryReport, PerformanceHistoryReport } from '../lib/metrora-bridge-types'
import type { PerformanceComparisonV1 } from '../../../src/bench/performance-compare-v1'
import type { PerformanceRunV1 } from '../../../src/bench/performance-contract-v1'
import type { AdvisorBenchComparison, AdvisorBenchEvidence, AdvisorBenchRun, AdvisorBenchTask, AdvisorPerformanceEvidence, AdvisorScope } from './types'

const MAX_RUNS = 10
const MAX_TASKS = 64
const SCORER = { id: 'metrora.bench-scoring', version: '1' } as const

function safeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || !/^[A-Za-z0-9._:/-]+$/u.test(normalized)) return fallback
  return normalized
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeToken(value: unknown): string {
  const normalized = String(value).trim().replace(/[^A-Za-z0-9._:/-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return normalized.slice(0, 80) || 'unknown'
}
function mapTask(task: BenchEvaluation['tasks'][number], usable: boolean): AdvisorBenchTask {
  return {
    taskId: safeIdentifier(task.taskId, 'task'),
    status: task.status,
    score: usable ? task.score : null,
    requestLatencyMs: usable ? finiteOrNull(task.requestLatencyMs) : null,
    timeToFirstContentMs: usable ? finiteOrNull(task.timeToFirstContentMs) : null,
  }
}

function generationIdentity(record: BenchEvaluation): string {
  const generation = record.generation
  if (!generation || typeof generation !== 'object') return 'unavailable'
  const policy = typeof generation.policy === 'string' ? generation.policy : 'unknown-policy'
  const parameters = generation.parameters && typeof generation.parameters === 'object'
    ? Object.entries(generation.parameters).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => safeToken(key) + '-' + safeToken(value)).join('_') || 'unknown-parameters'
    : 'unknown-parameters'
  return safeIdentifier(safeToken(policy) + '-' + parameters, 'unavailable')
}

function mapRun(record: BenchEvaluation): AdvisorBenchRun {
  const usable = record.status === 'completed'
  return {
    runId: safeIdentifier(record.runId, 'unknown-run'),
    pack: {
      id: safeIdentifier(record.pack.packId, 'unknown-pack'),
      version: safeIdentifier(record.pack.version, 'unknown-version'),
      digest: safeIdentifier(record.pack.digest, 'unknown-digest'),
    },
    scorer: SCORER,
    runner: {
      id: safeIdentifier(record.runner.id, 'unknown-runner'),
      version: safeIdentifier(record.runner.version, 'unknown-version'),
    },
    runtime: {
      id: safeIdentifier(record.runtime.id, 'unknown-runtime'),
      version: safeIdentifier(record.runtime.version, 'unknown-version'),
    },
    model: {
      selected: safeIdentifier(record.model.selected, 'unknown-model'),
      reported: record.model.reported === null ? null : safeIdentifier(record.model.reported, 'unknown-model'),
    },
    generationPolicy: generationIdentity(record),
    status: record.status,
    aggregate: {
      planned: record.aggregate.planned,
      attempted: record.aggregate.attempted,
      passed: record.aggregate.passed,
      failed: record.aggregate.failed,
      unavailable: record.aggregate.unavailable,
      cancelled: record.aggregate.cancelled,
      scoreNumerator: usable ? record.aggregate.score.numerator : null,
      scoreDenominator: usable ? record.aggregate.score.denominator : null,
      scoreValue: usable ? finiteOrNull(record.aggregate.score.value) : null,
    },
    tasks: record.tasks.slice(0, MAX_TASKS).map(task => mapTask(task, usable)),
    resultDigest: safeIdentifier(record.resultDigest, 'unknown-digest'),
  }
}

function mappedReason(value: string): AdvisorBenchComparison['reason'] {
  if (value === 'compatible' || value === 'pack-mismatch' || value === 'runner-mismatch' || value === 'scoring-mismatch' || value === 'generation-mismatch') return value
  return 'missing-run'
}

function mapComparison(value: BenchComparison | null): AdvisorBenchComparison | null {
  if (!value) return null
  const reason = mappedReason(value.reason)
  return {
    compatibility: value.compatible ? 'compatible' : 'incompatible',
    reason,
    comparedRunIds: [safeIdentifier(value.left.runId, 'unknown-run'), safeIdentifier(value.right.runId, 'unknown-run')],
    scoreDelta: finiteOrNull(value.deltas?.score),
    passedDelta: value.deltas?.passed ?? null,
    failedDelta: value.deltas?.failed ?? null,
    unavailableDelta: value.deltas?.unavailable ?? null,
    cancelledDelta: value.deltas?.cancelled ?? null,
    medianLatencyDeltaMs: finiteOrNull(value.deltas?.medianRequestLatencyMs),
    timeToFirstContentDeltaMs: finiteOrNull(value.deltas?.medianFirstContentMs),
  }
}

function parseBenchTime(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function periodStart(period: AdvisorScope['period'], now: number): number | null {
  if (period === 'all' || period === 'lifetime') return null
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  if (period === 'today') return day.getTime()
  if (period === 'week') return day.getTime() - 6 * 24 * 60 * 60 * 1000
  if (period === '30days') return day.getTime() - 29 * 24 * 60 * 60 * 1000
  return new Date(day.getFullYear(), day.getMonth(), 1).getTime()
}

function recordMatchesScope(record: BenchEvaluation, scope: AdvisorScope, now = Date.now()): boolean {
  if (scope.projectId !== 'all' || scope.provider !== 'all') return false
  if (scope.model && record.model.selected !== scope.model && record.model.reported !== scope.model) return false
  const rangeFrom = scope.range ? parseBenchTime(scope.range.from) : null
  const rangeTo = scope.range ? parseBenchTime(scope.range.to) : null
  const lowerBound = rangeFrom ?? periodStart(scope.period, now)
  const hasTemporalFilter = Boolean(scope.range) || lowerBound !== null
  if (!hasTemporalFilter) return true
  const startedAt = parseBenchTime(record.startedAt)
  if (startedAt === null || (lowerBound !== null && startedAt < lowerBound)) return false
  if (rangeTo !== null && startedAt > rangeTo + 24 * 60 * 60 * 1000 - 1) return false
  return true
}

function scopedHistory(history: BenchHistoryReport, scope: AdvisorScope): BenchHistoryReport {
  const records = Array.isArray(history.records) ? history.records.filter(record => recordMatchesScope(record, scope)) : []
  const globalScope = scope.projectId === 'all' && scope.provider === 'all' && scope.model === null && scope.range === null && (scope.period === 'all' || scope.period === 'lifetime')
  return { ...history, records, invalidCount: globalScope ? history.invalidCount : 0 }
}

function performanceRecordMatchesScope(record: PerformanceRunV1, scope: AdvisorScope, now = Date.now()): boolean {
  if (scope.projectId !== 'all' || scope.provider !== 'all') return false
  if (scope.model && record.model.selected !== scope.model && record.model.reported !== scope.model) return false
  const rangeFrom = scope.range ? parseBenchTime(scope.range.from) : null
  const rangeTo = scope.range ? parseBenchTime(scope.range.to) : null
  const lowerBound = rangeFrom ?? periodStart(scope.period, now)
  const hasTemporalFilter = Boolean(scope.range) || lowerBound !== null
  if (!hasTemporalFilter) return true
  const startedAt = parseBenchTime(record.startedAt)
  if (startedAt === null || (lowerBound !== null && startedAt < lowerBound)) return false
  if (rangeTo !== null && startedAt > rangeTo + 24 * 60 * 60 * 1000 - 1) return false
  return true
}

function scopedPerformanceHistory(history: PerformanceHistoryReport, scope: AdvisorScope): PerformanceHistoryReport {
  const records = Array.isArray(history.records) ? history.records.filter(record => performanceRecordMatchesScope(record, scope)) : []
  const globalScope = scope.projectId === 'all' && scope.provider === 'all' && scope.model === null && scope.range === null && (scope.period === 'all' || scope.period === 'lifetime')
  return { ...history, records, invalidCount: globalScope ? history.invalidCount : 0 }
}

function performanceState(history: PerformanceHistoryReport, latest: PerformanceRunV1 | null, comparison: PerformanceComparisonV1 | null): AdvisorPerformanceEvidence['state'] {
  if (!latest) return history.invalidCount > 0 ? 'UNAVAILABLE' : 'NO_DATA'
  if (comparison && !comparison.compatible) return 'NOT_COMPARABLE'
  const completed = history.records.filter(record => record.status === 'completed')
  if (latest.status !== 'completed') return completed.length ? 'PARTIAL' : 'UNAVAILABLE'
  return history.invalidCount > 0 || history.records.some(record => record.status !== 'completed') ? 'PARTIAL' : 'AVAILABLE'
}

function buildAdvisorPerformanceEvidence(history: PerformanceHistoryReport, comparison: PerformanceComparisonV1 | null): AdvisorPerformanceEvidence {
  const runs = Array.isArray(history.records) ? history.records.slice(0, MAX_RUNS) : []
  const latest = runs[0] ?? null
  return { state: performanceState({ ...history, records: runs }, latest, comparison), runs, latest, comparison }
}

export function buildAdvisorBenchEvidence(history: BenchHistoryReport, comparison: BenchComparison | null = null, performanceHistory: PerformanceHistoryReport | null = null, performanceComparison: PerformanceComparisonV1 | null = null): AdvisorBenchEvidence {
  const records = Array.isArray(history.records) ? history.records.slice(0, MAX_RUNS) : []
  const runs = records.map(mapRun)
  const mappedComparison = mapComparison(comparison)
  const latest = runs[0] ?? null
  const hasCompletedRun = runs.some(run => run.status === 'completed')
  const state = !runs.length
    ? history.invalidCount > 0 ? 'UNAVAILABLE' as const : 'NO_DATA' as const
    : !latest
      ? 'UNAVAILABLE' as const
      : mappedComparison?.compatibility === 'incompatible'
      ? 'NOT_COMPARABLE' as const
      : latest.status !== 'completed'
        ? hasCompletedRun ? 'PARTIAL' as const : 'UNAVAILABLE' as const
      : history.invalidCount > 0
        || runs.some(run => run.status !== 'completed')
        || runs.some(run => run.tasks.some(task => task.status === 'malformed' || task.status === 'unavailable' || task.status === 'timeout' || task.status === 'cancelled'))
        || latest.aggregate.attempted < latest.aggregate.planned
        || latest.aggregate.unavailable > 0
        || latest.aggregate.cancelled > 0
        ? 'PARTIAL' as const
        : 'AVAILABLE' as const
  return {
    state,
    runs,
    latest,
    comparison: mappedComparison,
    ...(performanceHistory ? { performance: buildAdvisorPerformanceEvidence(performanceHistory, performanceComparison) } : {}),
  }
}

export async function readAdvisorBenchEvidence(
  bridge: { getBenchHistory(): Promise<BenchHistoryReport>; getBenchComparison(leftRunId: string, rightRunId: string): Promise<BenchComparison>; getPerformanceBenchHistory?: () => Promise<PerformanceHistoryReport>; getPerformanceBenchComparison?: (leftRunId: string, rightRunId: string) => Promise<PerformanceComparisonV1> },
  scope: AdvisorScope,
  signal?: AbortSignal,
): Promise<AdvisorBenchEvidence> {
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  const [history, performanceHistoryValue] = await Promise.all([
    bridge.getBenchHistory(),
    bridge.getPerformanceBenchHistory ? bridge.getPerformanceBenchHistory().catch(() => null) : Promise.resolve(null),
  ])
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  const scoped = scopedHistory(history, scope)
  const scopedPerformance = performanceHistoryValue ? scopedPerformanceHistory(performanceHistoryValue, scope) : null
  const records = Array.isArray(scoped.records) ? scoped.records : []
  const comparableRecords = records.filter(record => record.status === 'completed')
  const performanceRecords = scopedPerformance?.records ?? []
  let comparison: BenchComparison | null = null
  if (comparableRecords.length >= 2) {
    try {
      comparison = await bridge.getBenchComparison(comparableRecords[1]!.runId, comparableRecords[0]!.runId)
    } catch {
      comparison = null
    }
  }
  let performanceComparison: PerformanceComparisonV1 | null = null
  if (performanceRecords.length >= 2 && bridge.getPerformanceBenchComparison) {
    try {
      performanceComparison = await bridge.getPerformanceBenchComparison(performanceRecords[1]!.runId, performanceRecords[0]!.runId)
    } catch {
      performanceComparison = null
    }
  }
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  return buildAdvisorBenchEvidence(scoped, comparison, scopedPerformance, performanceComparison)
}
