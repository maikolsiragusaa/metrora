// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import type { CanonicalBenchEvidenceReport } from '../lib/metrora-bridge-types'
import type { BenchComparisonV1 } from '../../../src/bench/compare-v1'
import type { BenchEvaluationV1 } from '../../../src/bench/task-pack-run-v1'
import { buildAdvisorBenchEvidence, readAdvisorBenchEvidence } from './bench'
import type { AdvisorScope } from './types'

function evaluation(status: BenchEvaluationV1['status'] = 'completed'): BenchEvaluationV1 {
  return {
    schemaVersion: 'metrora.bench-evaluation.v1',
    runId: 'run-1',
    runner: { id: 'ollama-task-pack-v1', version: '1.0.0' },
    pack: { packId: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) },
    model: { selected: 'qwen3:8b', reported: 'qwen3:8b' },
    runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434', version: '0.12.6' },
    environment: { os: 'test', arch: 'x64', node: 'v22' },
    generation: { parameters: { temperature: 0, seed: 1729, numPredict: 64 }, policy: 'one-bounded-request-per-task' },
    startedAt: '2026-08-24T10:00:00.000Z',
    endedAt: '2026-08-24T10:00:01.000Z',
    status,
    tasks: [{ taskId: 'task-1', attempted: status === 'completed', status: status === 'completed' ? 'passed' : 'unavailable', score: status === 'completed' ? 1 : null, outputDigest: status === 'completed' ? 'b'.repeat(64) : null, outputChars: status === 'completed' ? 4 : null, requestLatencyMs: status === 'completed' ? 10 : null, timeToFirstContentMs: status === 'completed' ? 3 : null, runtimeReported: { totalDurationNs: null, loadDurationNs: null, promptEvalCount: null, promptEvalDurationNs: null, evalCount: null, evalDurationNs: null }, failure: null }],
    aggregate: { planned: 1, attempted: status === 'completed' ? 1 : 0, passed: status === 'completed' ? 1 : 0, failed: 0, unavailable: status === 'completed' ? 0 : 1, cancelled: 0, score: { numerator: status === 'completed' ? 1 : 0, denominator: status === 'completed' ? 1 : 0, value: status === 'completed' ? 1 : null } },
    resultDigest: 'c'.repeat(64),
  }
}

function evidence(records: BenchEvaluationV1[], options: { state?: CanonicalBenchEvidenceReport['core']['state']; comparison?: BenchComparisonV1 | null; invalidCount?: number } = {}): CanonicalBenchEvidenceReport {
  return {
    schemaVersion: 'metrora.bench-evidence.v1',
    scope: { period: 'all', range: null, provider: 'all', projectId: 'all', model: null },
    core: {
      state: options.state ?? (records.length ? 'AVAILABLE' : 'NO_DATA'),
      latest: records[0] ?? null,
      history: records,
      comparison: options.comparison ?? null,
      invalidCount: options.invalidCount ?? 0,
    },
    performance: { state: 'NO_DATA', latest: null, history: [], comparison: null, invalidCount: 0 },
  }
}

describe('Advisor Bench evidence projection', () => {
  it('marks one clean completed run as available bounded evidence', () => {
    const projected = buildAdvisorBenchEvidence(evidence([evaluation()]))
    expect(projected.state).toBe('AVAILABLE')
    expect(projected.latest).toMatchObject({ runId: 'run-1', model: { selected: 'qwen3:8b' }, aggregate: { passed: 1, scoreValue: 1 } })
    expect(projected.latest?.tasks).toEqual([{ taskId: 'task-1', status: 'passed', score: 1, requestLatencyMs: 10, timeToFirstContentMs: 3 }])
    expect(projected.performance?.state).toBe('NO_DATA')
  })

  it('keeps multiple clean compatible runs available and marks incomplete history partial', () => {
    const second = { ...evaluation(), runId: 'run-2', startedAt: '2026-08-23T10:00:00.000Z', endedAt: '2026-08-23T10:00:01.000Z' }
    expect(buildAdvisorBenchEvidence(evidence([evaluation(), second])).state).toBe('AVAILABLE')
    expect(buildAdvisorBenchEvidence(evidence([evaluation(), evaluation('unavailable')], { state: 'PARTIAL' })).state).toBe('PARTIAL')
  })

  it('preserves unavailable and incompatible states without fabricating comparison facts', () => {
    const unavailable = buildAdvisorBenchEvidence(evidence([evaluation('unavailable')], { state: 'UNAVAILABLE' }))
    expect(unavailable.state).toBe('UNAVAILABLE')
    expect(unavailable.latest).toMatchObject({ runId: 'run-1', status: 'unavailable', aggregate: { scoreValue: null, scoreDenominator: null } })
    const comparison: BenchComparisonV1 = { schemaVersion: 'metrora.bench-comparison.v1', compatible: false, reason: 'pack-mismatch', left: { runId: 'run-1', model: 'qwen3:8b', endedAt: '2026-08-24T10:00:01.000Z' }, right: { runId: 'run-2', model: 'other', endedAt: '2026-08-23T10:00:01.000Z' }, deltas: null }
    const projected = buildAdvisorBenchEvidence(evidence([evaluation()], { state: 'NOT_COMPARABLE', comparison }))
    expect(projected.state).toBe('NOT_COMPARABLE')
    expect(projected.comparison).toMatchObject({ compatibility: 'incompatible', reason: 'pack-mismatch', scoreDelta: null })
  })

  it('keeps the newest unavailable run as latest instead of surfacing an older score', () => {
    const newestUnavailable = { ...evaluation('unavailable'), runId: 'run-2', startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T10:00:01.000Z' }
    const projected = buildAdvisorBenchEvidence(evidence([newestUnavailable, evaluation()], { state: 'PARTIAL' }))
    expect(projected.state).toBe('PARTIAL')
    expect(projected.latest).toMatchObject({ runId: 'run-2', status: 'unavailable', aggregate: { scoreValue: null } })
  })

  it('delegates scope filtering and comparison selection to the canonical host report', async () => {
    const calls: unknown[][] = []
    const scope: AdvisorScope = { period: 'month', range: { from: '2026-07-01', to: '2026-07-11' }, provider: 'all', projectId: 'project-x', projectName: 'Project X', model: 'qwen3:8b' }
    const projected = await readAdvisorBenchEvidence({
      getBenchEvidence: async (...args) => {
        calls.push(args)
        return { ...evidence([]), scope: { ...evidence([]).scope, period: scope.period, range: scope.range, projectId: scope.projectId, model: scope.model } }
      },
    }, scope)
    expect(calls).toEqual([[scope.period, scope.range, scope.model, scope.provider, scope.projectId]])
    expect(projected.state).toBe('NO_DATA')
    expect(projected.latest).toBeNull()
    expect(projected.runs).toEqual([])
  })
})
