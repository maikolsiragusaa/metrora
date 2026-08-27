import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BENCH_HISTORY_KIND,
  BENCH_HISTORY_VERSION,
  BENCH_HISTORY_MAX_CANDIDATE_FILES,
  BENCH_HISTORY_MAX_FILE_BYTES,
  BENCH_HISTORY_MAX_INVALID_DIAGNOSTICS,
  BENCH_HISTORY_MAX_INVALID_FILES,
  BENCH_HISTORY_MAX_RECORDS,
  benchHistoryDirectoryV1,
  saveBenchEvaluationV1,
  scanBenchHistoryV1,
} from '../src/bench/history-v1.js'
import { sha256Json } from '../src/bench/serialization.js'
import { CORE_TASK_PACK_V1 } from '../src/bench/task-pack-v1.js'
import { digestBenchEvaluationV1, type BenchEvaluationV1 } from '../src/bench/task-pack-run-v1.js'

const dirs: string[] = []
function evaluation(runId: string, endedAt = '2026-08-24T10:00:00.000Z'): BenchEvaluationV1 {
  const resultWithoutDigest = {
    schemaVersion: 'metrora.bench-evaluation.v1' as const,
    runId,
    runner: { id: 'ollama-task-pack-v1' as const, version: '1.0.0' as const },
    pack: { packId: 'metrora.bench.core' as const, version: '1.0.0' as const, digest: CORE_TASK_PACK_V1.digest },
    model: { selected: 'qwen3:8b', reported: 'qwen3:8b' },
    runtime: { id: 'ollama-local' as const, endpoint: 'http://127.0.0.1:11434' as const, version: '0.12.6' },
    environment: { os: 'test', arch: 'x64', node: 'v22' },
    generation: { parameters: { temperature: 0, seed: 1729, numPredict: 64 }, policy: 'one-bounded-request-per-task' as const },
    startedAt: endedAt,
    endedAt,
    status: 'completed' as const,
    tasks: CORE_TASK_PACK_V1.tasks.map(task => ({
      taskId: task.id,
      attempted: true,
      status: 'passed' as const,
      score: 1 as const,
      outputDigest: 'b'.repeat(64),
      outputChars: 4,
      requestLatencyMs: 10,
      timeToFirstContentMs: 3,
      runtimeReported: { totalDurationNs: null, loadDurationNs: null, promptEvalCount: null, promptEvalDurationNs: null, evalCount: null, evalDurationNs: null },
      failure: null,
    })),
    aggregate: { planned: 6, attempted: 6, passed: 6, failed: 0, unavailable: 0, cancelled: 0, score: { numerator: 6, denominator: 6, value: 1 } },
  }
  return { ...resultWithoutDigest, resultDigest: digestBenchEvaluationV1(resultWithoutDigest) }
}
function dataDir(): string { const dir = mkdtempSync(join(tmpdir(), 'metrora-bench-history-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('Bench history v1', () => {
  it('writes atomically, deduplicates, skips corrupt files, and never stores task text', async () => {
    const dir = dataDir()
    const record = evaluation('run-one')
    expect(await saveBenchEvaluationV1(record, { dataDir: dir })).toMatchObject({ status: 'saved' })
    expect(await saveBenchEvaluationV1(record, { dataDir: dir })).toMatchObject({ status: 'duplicate' })
    const otherModel = { ...record, model: { selected: 'other', reported: null } }
    await expect(saveBenchEvaluationV1({ ...otherModel, resultDigest: digestBenchEvaluationV1(otherModel) }, { dataDir: dir })).rejects.toThrow('collision')
    const corrupt = join(benchHistoryDirectoryV1(dir), 'a'.repeat(64) + '.json')
    writeFileSync(corrupt, '{not-json}')
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(1)
    expect(scan.invalid).toHaveLength(1)
    expect(JSON.stringify(scan.records)).not.toContain('single lowercase word')
    expect(JSON.stringify(scan.records)).not.toContain('model response body')
  })

  it('rejects a wrapper digest forged to make tampered existing content look like a duplicate', async () => {
    const dir = dataDir()
    const original = evaluation('wrapper-tamper')
    await saveBenchEvaluationV1(original, { dataDir: dir })
    const incomingWithoutDigest = { ...original, tasks: original.tasks.map((task, index) => index === 0 ? { ...task, outputDigest: 'c'.repeat(64) } : task) }
    const incoming = { ...incomingWithoutDigest, resultDigest: digestBenchEvaluationV1(incomingWithoutDigest) }
    const file = join(benchHistoryDirectoryV1(dir), sha256Json([BENCH_HISTORY_KIND, original.runId]) + '.json')
    const wrapper = JSON.parse(readFileSync(file, 'utf8')) as { recordSha256: string; record: BenchEvaluationV1 }
    wrapper.recordSha256 = sha256Json(incoming)
    writeFileSync(file, JSON.stringify({ ...wrapper, kind: BENCH_HISTORY_KIND, version: BENCH_HISTORY_VERSION }))

    await expect(saveBenchEvaluationV1(incoming, { dataDir: dir })).rejects.toThrow('existing history record digest mismatch')
  })

  it('rejects semantically inconsistent retained records', async () => {
    const dir = dataDir()
    const record = evaluation('inconsistent')
    const invalidRecord = { ...record, aggregate: { ...record.aggregate, passed: 0 } }
    const recordsDir = benchHistoryDirectoryV1(dir)
    mkdirSync(recordsDir, { recursive: true })
    const file = sha256Json([BENCH_HISTORY_KIND, invalidRecord.runId]) + '.json'
    writeFileSync(join(recordsDir, file), JSON.stringify({
      kind: BENCH_HISTORY_KIND,
      version: BENCH_HISTORY_VERSION,
      recordSha256: sha256Json(invalidRecord),
      record: invalidRecord,
    }))

    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(0)
    expect(scan.invalid).toEqual([{ file, reason: expect.stringContaining('passed count does not match') }])
  })

  it('rejects non-canonical packs and tampered result digests', async () => {
    const dir = dataDir()
    const record = evaluation('tampered')
    const invalidRecord = { ...record, pack: { ...record.pack, digest: 'a'.repeat(64) } }
    const recordsDir = benchHistoryDirectoryV1(dir)
    mkdirSync(recordsDir, { recursive: true })
    const file = sha256Json([BENCH_HISTORY_KIND, invalidRecord.runId]) + '.json'
    writeFileSync(join(recordsDir, file), JSON.stringify({
      kind: BENCH_HISTORY_KIND,
      version: BENCH_HISTORY_VERSION,
      recordSha256: sha256Json(invalidRecord),
      record: invalidRecord,
    }))

    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(0)
    expect(scan.invalid).toEqual([{ file, reason: expect.stringContaining('canonical Core conformance pack') }])
  })

  it('rejects a result digest that does not match retained task evidence', async () => {
    const dir = dataDir()
    const record = evaluation('bad-result-digest')
    const invalidRecord = { ...record, resultDigest: 'c'.repeat(64) }
    const recordsDir = benchHistoryDirectoryV1(dir)
    mkdirSync(recordsDir, { recursive: true })
    const file = sha256Json([BENCH_HISTORY_KIND, invalidRecord.runId]) + '.json'
    writeFileSync(join(recordsDir, file), JSON.stringify({
      kind: BENCH_HISTORY_KIND,
      version: BENCH_HISTORY_VERSION,
      recordSha256: sha256Json(invalidRecord),
      record: invalidRecord,
    }))

    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(0)
    expect(scan.invalid).toEqual([{ file, reason: expect.stringContaining('result digest does not match') }])
  })

  it('rejects altered fixed generation parameters', async () => {
    const dir = dataDir()
    const record = evaluation('altered-generation')
    const invalidRecord = { ...record, generation: { ...record.generation, parameters: { ...record.generation.parameters, seed: 1730 } } }
    const recordsDir = benchHistoryDirectoryV1(dir)
    mkdirSync(recordsDir, { recursive: true })
    const file = sha256Json([BENCH_HISTORY_KIND, invalidRecord.runId]) + '.json'
    writeFileSync(join(recordsDir, file), JSON.stringify({
      kind: BENCH_HISTORY_KIND,
      version: BENCH_HISTORY_VERSION,
      recordSha256: sha256Json(invalidRecord),
      record: invalidRecord,
    }))

    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(0)
    expect(scan.invalid).toEqual([{ file, reason: expect.stringContaining('fixed Core conformance policy') }])
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

  it('prunes overflow candidates instead of leaving the history directory unbounded', async () => {
    const dir = dataDir()
    const recordsDir = benchHistoryDirectoryV1(dir)
    mkdirSync(recordsDir, { recursive: true })
    for (let index = 0; index < BENCH_HISTORY_MAX_CANDIDATE_FILES + 20; index++) {
      const file = index.toString(16).padStart(64, '0') + '.json'
      writeFileSync(join(recordsDir, file), '{not-json}')
    }

    await saveBenchEvaluationV1(evaluation('newest', '2026-08-24T14:00:00.000Z'), { dataDir: dir })

    const files = readdirSync(recordsDir).filter(file => /^[0-9a-f]{64}\.json$/u.test(file))
    expect(files).toHaveLength(1 + BENCH_HISTORY_MAX_INVALID_FILES)
    const scan = await scanBenchHistoryV1({ dataDir: dir })
    expect(scan.records.map(item => item.runId)).toEqual(['newest'])
    expect(scan.invalid.length).toBeLessThanOrEqual(BENCH_HISTORY_MAX_INVALID_FILES)
  })
})
