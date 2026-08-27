// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import type { BenchEvaluation, BenchHistoryReport, BenchComparison } from '../lib/metrora-bridge-types'
import { buildAdvisorBenchEvidence, readAdvisorBenchEvidence } from './bench'

function evaluation(status: BenchEvaluation['status'] = 'completed'): BenchEvaluation {
  return {
    schemaVersion: 'metrora.bench-evaluation.v1',
    runId: 'run-1',
    runner: { id: 'ollama-task-pack-v1', version: '1.0.0' },
    pack: { packId: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) },
    model: { selected: 'qwen3:8b', reported: 'qwen3:8b' },
    runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434', version: '0.12.6' },
    generation: { parameters: { temperature: 0, seed: 1729, numPredict: 64 }, policy: 'one-bounded-request-per-task' },
    startedAt: '2026-08-24T10:00:00.000Z',
    endedAt: '2026-08-24T10:00:01.000Z',
    status,
    tasks: [{ taskId: 'task-1', attempted: status === 'completed', status: status === 'completed' ? 'passed' : 'unavailable', score: status === 'completed' ? 1 : null, outputDigest: status === 'completed' ? 'b'.repeat(64) : null, outputChars: status === 'completed' ? 4 : null, requestLatencyMs: status === 'completed' ? 10 : null, timeToFirstContentMs: status === 'completed' ? 3 : null, failure: null }],
    aggregate: { planned: 1, attempted: status === 'completed' ? 1 : 0, passed: status === 'completed' ? 1 : 0, failed: 0, unavailable: status === 'completed' ? 0 : 1, cancelled: 0, score: { numerator: status === 'completed' ? 1 : 0, denominator: status === 'completed' ? 1 : 0, value: status === 'completed' ? 1 : null } },
    resultDigest: 'c'.repeat(64),
  }
}

function history(record: BenchEvaluation, invalidCount = 0): BenchHistoryReport {
  return { schemaVersion: 'metrora.bench-history.v1', records: [record], invalidCount }
}

describe('Advisor Bench evidence projection', () => {
  it('marks one clean completed run as available bounded evidence', () => {
    const projected = buildAdvisorBenchEvidence(history(evaluation()))
    expect(projected.state).toBe('AVAILABLE')
    expect(projected.latest).toMatchObject({ runId: 'run-1', model: { selected: 'qwen3:8b' }, aggregate: { passed: 1, scoreValue: 1 } })
    expect(projected.latest?.tasks).toEqual([{ taskId: 'task-1', status: 'passed', score: 1, requestLatencyMs: 10, timeToFirstContentMs: 3 }])
  })

  it('keeps multiple clean compatible runs available and marks incomplete history partial', () => {
    const second = { ...evaluation(), runId: 'run-2', startedAt: '2026-08-23T10:00:00.000Z', endedAt: '2026-08-23T10:00:01.000Z' }
    expect(buildAdvisorBenchEvidence({ ...history(evaluation()), records: [evaluation(), second] }).state).toBe('AVAILABLE')
    expect(buildAdvisorBenchEvidence({ ...history(evaluation()), records: [evaluation(), evaluation('unavailable')] }).state).toBe('PARTIAL')
  })

  it('preserves unavailable and incompatible states without fabricating comparison facts', () => {
    const unavailable = buildAdvisorBenchEvidence(history(evaluation('unavailable')))
    expect(unavailable.state).toBe('UNAVAILABLE')
    expect(unavailable.latest).toMatchObject({ runId: 'run-1', status: 'unavailable', aggregate: { scoreValue: null, scoreDenominator: null } })
    const comparison: BenchComparison = { schemaVersion: 'metrora.bench-comparison.v1', compatible: false, reason: 'pack-mismatch', left: { runId: 'run-1', model: 'qwen3:8b', endedAt: '2026-08-24T10:00:01.000Z' }, right: { runId: 'run-2', model: 'other', endedAt: '2026-08-23T10:00:01.000Z' }, deltas: null }
    const projected = buildAdvisorBenchEvidence(history(evaluation()), comparison)
    expect(projected.state).toBe('NOT_COMPARABLE')
    expect(projected.comparison).toMatchObject({ compatibility: 'incompatible', reason: 'pack-mismatch', scoreDelta: null })
  })

  it('keeps the newest unavailable run as latest instead of surfacing an older score', () => {
    const newestUnavailable = { ...evaluation('unavailable'), runId: 'run-2', startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T10:00:01.000Z' }
    const projected = buildAdvisorBenchEvidence({ ...history(evaluation()), records: [newestUnavailable, evaluation()] })
    expect(projected.state).toBe('PARTIAL')
    expect(projected.latest).toMatchObject({ runId: 'run-2', status: 'unavailable', aggregate: { scoreValue: null } })
  })
  it('does not use global Bench runs outside the selected scope', async () => {
    const projected = await readAdvisorBenchEvidence(
      { getBenchHistory: async () => history(evaluation()), getBenchComparison: async () => { throw new Error('comparison should not be called') } },
      { period: 'all', range: null, provider: 'all', projectId: 'project-x', projectName: 'Project X', model: null },
    )
    expect(projected.state).toBe('NO_DATA')
    expect(projected.latest).toBeNull()
    expect(projected.runs).toEqual([])
  })
})
