import { describe, expect, it } from 'vitest'
import { compareBenchEvaluationsV1 } from '../src/bench/compare-v1.js'
import type { BenchEvaluationV1 } from '../src/bench/task-pack-run-v1.js'

function evaluation(runId: string, overrides: Partial<BenchEvaluationV1> = {}): BenchEvaluationV1 {
  const task = (id: string, latency: number | null, score: 0 | 1 | null) => ({ taskId: id, attempted: score !== null, status: score === 1 ? 'passed' as const : score === 0 ? 'failed' as const : 'unavailable' as const, score, outputDigest: score === null ? null : 'b'.repeat(64), outputChars: score === null ? null : 4, requestLatencyMs: latency, timeToFirstContentMs: latency === null ? null : latency / 2, runtimeReported: { totalDurationNs: null, loadDurationNs: null, promptEvalCount: null, promptEvalDurationNs: null, evalCount: null, evalDurationNs: null }, failure: score === 1 ? null : { code: 'scoring-failed' as const, message: 'bounded test failure' } })
  const base: BenchEvaluationV1 = { schemaVersion: 'metrora.bench-evaluation.v1', runId, runner: { id: 'ollama-task-pack-v1', version: '1.0.0' }, pack: { packId: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) }, model: { selected: runId, reported: runId }, runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434', version: '0.12.6' }, environment: { os: 'test', arch: 'x64', node: 'v22' }, generation: { parameters: { temperature: 0, seed: 1729, numPredict: 64 }, policy: 'one-bounded-request-per-task' }, startedAt: '2026-08-24T10:00:00.000Z', endedAt: '2026-08-24T10:01:00.000Z', status: 'completed', tasks: [task('a', 10, 1), task('b', 20, 1)], aggregate: { planned: 2, attempted: 2, passed: 2, failed: 0, unavailable: 0, cancelled: 0, score: { numerator: 2, denominator: 2, value: 1 } }, resultDigest: 'c'.repeat(64) }
  return { ...base, ...overrides }
}

describe('Bench comparison v1', () => {
  it('returns factual deltas for compatible records and preserves zero/missing semantics', () => {
    const left = evaluation('left')
    const right = evaluation('right', { tasks: [left.tasks[0]!, { ...left.tasks[1]!, requestLatencyMs: null, timeToFirstContentMs: null, score: 0, status: 'failed', failure: { code: 'scoring-failed', message: 'bounded test failure' } }], aggregate: { planned: 2, attempted: 2, passed: 1, failed: 1, unavailable: 0, cancelled: 0, score: { numerator: 1, denominator: 2, value: 0.5 } } })
    const result = compareBenchEvaluationsV1(left, right)
    expect(result.compatible).toBe(true)
    expect(result.deltas).toMatchObject({ score: -0.5, passed: -1, failed: 1, medianFirstContentMs: -2.5 })
    expect(result.deltas?.medianRequestLatencyMs).toBe(-5)

    const zero = evaluation('zero', { aggregate: { ...left.aggregate, score: { numerator: 0, denominator: 2, value: 0 } } })
    expect(compareBenchEvaluationsV1(zero, right).deltas?.score).toBe(0.5)
  })

  it('refuses incompatible pack identities', () => {
    const left = evaluation('left')
    const right = evaluation('right', { pack: { ...left.pack, digest: 'd'.repeat(64) } })
    expect(compareBenchEvaluationsV1(left, right)).toMatchObject({ compatible: false, reason: 'pack-mismatch', deltas: null })
  })
})
