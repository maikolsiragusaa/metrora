import type { BenchComparison, BenchEvaluation, BenchHistoryReport } from '../lib/metrora-bridge-types'
import type { AdvisorBenchComparison, AdvisorBenchEvidence, AdvisorBenchRun, AdvisorBenchTask, AdvisorScope } from './types'

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

function mapTask(task: BenchEvaluation['tasks'][number]): AdvisorBenchTask {
  return {
    taskId: safeIdentifier(task.taskId, 'task'),
    status: task.status,
    score: task.score,
    requestLatencyMs: finiteOrNull(task.requestLatencyMs),
    timeToFirstContentMs: finiteOrNull(task.timeToFirstContentMs),
  }
}

function generationIdentity(record: BenchEvaluation): string {
  const generation = record.generation
  if (!generation || typeof generation !== 'object') return 'unavailable'
  const policy = typeof generation.policy === 'string' ? generation.policy : 'unknown-policy'
  const parameters = generation.parameters && typeof generation.parameters === 'object'
    ? Object.entries(generation.parameters).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => key + '=' + String(value)).join(',')
    : 'unknown-parameters'
  return safeIdentifier(policy + '[' + parameters + ']', 'unavailable')
}

function mapRun(record: BenchEvaluation): AdvisorBenchRun {
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
      scoreNumerator: record.aggregate.score.numerator,
      scoreDenominator: record.aggregate.score.denominator,
      scoreValue: finiteOrNull(record.aggregate.score.value),
    },
    tasks: record.tasks.slice(0, MAX_TASKS).map(mapTask),
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

export function buildAdvisorBenchEvidence(history: BenchHistoryReport, comparison: BenchComparison | null = null): AdvisorBenchEvidence {
  const records = Array.isArray(history.records) ? history.records.slice(0, MAX_RUNS) : []
  const runs = records.map(mapRun)
  const mappedComparison = mapComparison(comparison)
  const state = !runs.length
    ? history.invalidCount > 0 ? 'UNAVAILABLE' as const : 'NO_DATA' as const
    : mappedComparison?.compatibility === 'incompatible'
      ? 'NOT_COMPARABLE' as const
      : history.invalidCount > 0 || runs.some(run => run.status !== 'completed')
        ? 'PARTIAL' as const
        : 'PARTIAL' as const
  return { state, runs, latest: runs[0] ?? null, comparison: mappedComparison }
}

export async function readAdvisorBenchEvidence(
  bridge: { getBenchHistory(): Promise<BenchHistoryReport>; getBenchComparison(leftRunId: string, rightRunId: string): Promise<BenchComparison> },
  _scope: AdvisorScope,
  signal?: AbortSignal,
): Promise<AdvisorBenchEvidence> {
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  const history = await bridge.getBenchHistory()
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  const records = Array.isArray(history.records) ? history.records : []
  let comparison: BenchComparison | null = null
  if (records.length >= 2) {
    try {
      comparison = await bridge.getBenchComparison(records[1]!.runId, records[0]!.runId)
    } catch {
      comparison = null
    }
  }
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  return buildAdvisorBenchEvidence(history, comparison)
}
