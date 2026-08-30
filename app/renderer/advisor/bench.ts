import type { BenchComparison, BenchEvaluation, CanonicalBenchEvidenceReport } from '../lib/metrora-bridge-types'
import type { AdvisorBenchComparison, AdvisorBenchEvidence, AdvisorBenchRun, AdvisorBenchTask, AdvisorScope } from './types'

const MAX_RUNS = 10
const MAX_TASKS = 64
const SCORER = { id: 'metrora.bench-scoring', version: '1' } as const

function safeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized && normalized.length <= 200 && /^[A-Za-z0-9._:/-]+$/u.test(normalized) ? normalized : fallback
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
  if (!generation) return 'unavailable'
  const policy = typeof generation.policy === 'string' ? generation.policy : 'unknown-policy'
  const parameters = Object.entries(generation.parameters ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => safeToken(key) + '-' + safeToken(value))
    .join('_') || 'unknown-parameters'
  return safeIdentifier(safeToken(policy) + '-' + parameters, 'unavailable')
}

function mapRun(record: BenchEvaluation): AdvisorBenchRun {
  const usable = record.status === 'completed'
  return {
    runId: safeIdentifier(record.runId, 'unknown-run'),
    pack: { id: safeIdentifier(record.pack.packId, 'unknown-pack'), version: safeIdentifier(record.pack.version, 'unknown-version'), digest: safeIdentifier(record.pack.digest, 'unknown-digest') },
    scorer: SCORER,
    runner: { id: safeIdentifier(record.runner.id, 'unknown-runner'), version: safeIdentifier(record.runner.version, 'unknown-version') },
    runtime: { id: safeIdentifier(record.runtime.id, 'unknown-runtime'), version: safeIdentifier(record.runtime.version, 'unknown-version') },
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
  return {
    compatibility: value.compatible ? 'compatible' : 'incompatible',
    reason: mappedReason(value.reason),
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

/** Format the already-aggregated host report for Advisor presentation. */
export function buildAdvisorBenchEvidence(evidence: CanonicalBenchEvidenceReport): AdvisorBenchEvidence {
  const coreRuns = evidence.core.history.slice(0, MAX_RUNS).map(mapRun)
  return {
    state: evidence.core.state,
    runs: coreRuns,
    latest: coreRuns[0] ?? null,
    comparison: mapComparison(evidence.core.comparison),
    performance: {
      state: evidence.performance.state,
      runs: evidence.performance.history.slice(0, MAX_RUNS),
      latest: evidence.performance.latest,
      comparison: evidence.performance.comparison,
    },
  }
}

export async function readAdvisorBenchEvidence(
  bridge: { getBenchEvidence(period: AdvisorScope['period'], range?: AdvisorScope['range'], model?: string | null, provider?: string, projectId?: string | null): Promise<CanonicalBenchEvidenceReport> },
  scope: AdvisorScope,
  signal?: AbortSignal,
): Promise<AdvisorBenchEvidence> {
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  const evidence = await bridge.getBenchEvidence(scope.period, scope.range, scope.model, scope.provider, scope.projectId)
  if (signal?.aborted) throw new DOMException('Advisor Bench read cancelled', 'AbortError')
  return buildAdvisorBenchEvidence(evidence)
}
