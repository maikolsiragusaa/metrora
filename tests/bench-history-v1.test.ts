import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BENCH_HISTORY_MAX_CANDIDATE_FILES,
  BENCH_HISTORY_MAX_FILE_BYTES,
  BENCH_HISTORY_MAX_INVALID_DIAGNOSTICS,
  BENCH_HISTORY_MAX_INVALID_FILES,
  BENCH_HISTORY_MAX_RECORDS,
  benchHistoryDirectoryV1,
  saveBenchEvaluationV1,
  scanBenchHistoryV1,
} from '../src/bench/history-v1.js'
import type { BenchEvaluationV1 } from '../src/bench/task-pack-run-v1.js'

const dirs: string[] = []
function evaluation(runId: string, endedAt = '2026-08-24T10:00:00.000Z'): BenchEvaluationV1 {
  return {
    schemaVersion: 'metrora.bench-evaluation.v1', runId, runner: { id: 'ollama-task-pack-v1', version: '1.0.0' }, pack: { packId: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) }, model: { selected: 'qwen3:8b', reported: 'qwen3:8b' }, runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434', version: '0.12.6' }, environment: { os: 'test', arch: 'x64', node: 'v22' }, generation: { parameters: { temperature: 0, seed: 1729, numPredict: 64 }, policy: 'one-bounded-request-per-task' }, startedAt: endedAt, endedAt, status: 'completed', tasks: [{ taskId: 'exact-word', attempted: true, status: 'passed', score: 1, outputDigest: 'b'.repeat(64), outputChars: 4, requestLatencyMs: 10, timeToFirstContentMs: 3, runtimeReported: { totalDurationNs: null, loadDurationNs: null, promptEvalCount: null, promptEvalDurationNs: null, evalCount: null, evalDurationNs: null }, failure: null }], aggregate: { planned: 1, attempted: 1, passed: 1, failed: 0, unavailable: 0, cancelled: 0, score: { numerator: 1, denominator: 1, value: 1 } }, resultDigest: 'c'.repeat(64),
  }
}
function dataDir(): string { const dir = mkdtempSync(join(tmpdir(), 'metrora-bench-history-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('Bench history v1', () => {
  it('writes atomically, deduplicates, skips corrupt files, and never stores task text', async () => {
    const dir = dataDir()
    const record = evaluation('run-one')
    expect(await saveBenchEvaluationV1(record, { dataDir: dir })).toMatchObject({ status: 'saved' })
    expect(await saveBenchEvaluationV1(record, { dataDir: dir })).toMatchObject({ status: 'duplicate' })
    await expect(saveBenchEvaluationV1({ ...record, model: { selected: 'other', reported: null } }, { dataDir: dir })).rejects.toThrow('collision')
    const corrupt = join(benchHistoryDirectoryV1(dir), 'a'.repeat(64) + '.json')
    writeFileSync(corrupt, '{not-json}')
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(1)
    expect(scan.invalid).toHaveLength(1)
    expect(JSON.stringify(scan.records)).not.toContain('single lowercase word')
    expect(JSON.stringify(scan.records)).not.toContain('model response body')
  })

  it('bounds oversized corrupt files before parsing', async () => {
    const dir = dataDir()
    const file = 'b'.repeat(64) + '.json'
    mkdirSync(benchHistoryDirectoryV1(dir), { recursive: true })
    writeFileSync(join(benchHistoryDirectoryV1(dir), file), Buffer.alloc(BENCH_HISTORY_MAX_FILE_BYTES + 1, 0x78))
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(0)
    expect(scan.invalid).toEqual([{ file, reason: expect.stringContaining('bounded byte limit') }])
  })

  it('bounds corrupt candidate scanning and diagnostic accumulation', async () => {
    const dir = dataDir()
    const recordsDir = benchHistoryDirectoryV1(dir)
    mkdirSync(recordsDir, { recursive: true })
    for (let index = 0; index < BENCH_HISTORY_MAX_CANDIDATE_FILES + 20; index++) {
      const file = index.toString(16).padStart(64, '0') + '.json'
      writeFileSync(join(recordsDir, file), '{not-json}')
    }
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(0)
    expect(scan.invalid.length).toBeLessThanOrEqual(BENCH_HISTORY_MAX_INVALID_DIAGNOSTICS)
    expect(scan.invalid.some(item => item.file === '<bounded-diagnostics>' || item.file === '<candidate-scan>')).toBe(true)
  })

  it('keeps valid recent records usable among corruption', async () => {
    const dir = dataDir()
    const record = evaluation('recent', '2026-08-24T12:00:00.000Z')
    await saveBenchEvaluationV1(record, { dataDir: dir })
    const recordsDir = benchHistoryDirectoryV1(dir)
    for (let index = 0; index < BENCH_HISTORY_MAX_INVALID_FILES + 4; index++) {
      const file = (index + 100).toString(16).padStart(64, '0') + '.json'
      writeFileSync(join(recordsDir, file), '{corrupt}')
    }
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records.map(item => item.runId)).toContain('recent')
  })

  it('retains invalid files under a deterministic bounded budget without evicting valid history', async () => {
    const dir = dataDir()
    const recordsDir = benchHistoryDirectoryV1(dir)
    mkdirSync(recordsDir, { recursive: true })
    for (let index = 0; index < BENCH_HISTORY_MAX_INVALID_FILES + 4; index++) {
      const file = (index + 200).toString(16).padStart(64, '0') + '.json'
      writeFileSync(join(recordsDir, file), '{corrupt}')
    }
    await saveBenchEvaluationV1(evaluation('retained', '2026-08-24T13:00:00.000Z'), { dataDir: dir })
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records.map(item => item.runId)).toEqual(['retained'])
    expect(scan.invalid.length).toBeLessThanOrEqual(BENCH_HISTORY_MAX_INVALID_FILES)
  })

  it('retains at most the bounded record count', async () => {
    const dir = dataDir()
    for (let index = 0; index < BENCH_HISTORY_MAX_RECORDS + 2; index++) {
      const endedAt = new Date(Date.UTC(2026, 0, index + 1, 10)).toISOString()
      await saveBenchEvaluationV1(evaluation('run-' + index, endedAt), { dataDir: dir })
    }
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records.length).toBeLessThanOrEqual(BENCH_HISTORY_MAX_RECORDS)
    expect(scan.records[0]?.runId).toBe('run-51')
  })
})
