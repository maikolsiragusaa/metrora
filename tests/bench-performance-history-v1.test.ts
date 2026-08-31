import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { performanceHistoryDirectoryV1, savePerformanceRunV1, scanPerformanceHistoryV1 } from '../src/bench/performance-history-v1.js'
import { runPerformanceBenchV1 } from '../src/bench/performance-run-v1.js'

const directories: string[] = []

function dataDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-performance-history-'))
  directories.push(directory)
  return directory
}

async function record(runId = 'history-run') {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-performance-input-'))
  directories.push(directory)
  const executablePath = join(directory, 'llama-bench')
  const modelPath = join(directory, 'model.gguf')
  writeFileSync(executablePath, 'fixture')
  writeFileSync(modelPath, 'fixture')
  return runPerformanceBenchV1({
    executablePath,
    modelPath,
    runId,
    processRunner: async () => ({
      stdout: JSON.stringify([
        {
          build_commit: 'abc123',
          build_number: 10516,
          cpu_info: 'fixture CPU',
          gpu_info: 'fixture GPU',
          backends: 'CUDA',
          devices: 'auto',
          model_filename: 'model.gguf',
          model_type: '7B',
          model_size: 4_000_000_000,
          model_n_params: 7_000_000_000,
          n_batch: 2048,
          n_ubatch: 512,
          n_threads: 8,
          n_gpu_layers: -1,
          split_mode: 'none',
          main_gpu: 0,
          flash_attn: -1,
          n_prompt: 512,
          n_gen: 0,
          n_depth: 0,
          n_reps: 3,
          avg_ts: 100,
          stddev_ts: 1,
          avg_ns: 1_000_000,
          stddev_ns: 10_000,
          test_time: '2026-08-30T10:00:01Z',
        },
        {
          n_batch: 2048,
          n_ubatch: 512,
          n_threads: 8,
          n_gpu_layers: -1,
          split_mode: 'none',
          main_gpu: 0,
          flash_attn: -1,
          n_prompt: 0,
          n_gen: 128,
          n_depth: 0,
          n_reps: 3,
          avg_ts: 20,
          stddev_ts: 1,
          avg_ns: 5_000_000,
          stddev_ns: 50_000,
          test_time: '2026-08-30T10:00:02Z',
        },
      ]),
      stderr: '',
      code: 0,
    }),
  })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Performance history v1', () => {
  it('writes atomically, deduplicates, and scans a bounded retained record', async () => {
    const dir = dataDir()
    const value = await record()
    expect(await savePerformanceRunV1(value, { dataDir: dir })).toMatchObject({ status: 'saved' })
    expect(await savePerformanceRunV1(value, { dataDir: dir })).toMatchObject({ status: 'duplicate' })
    const scan = await scanPerformanceHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(1)
    expect(scan.records[0]).toMatchObject({ runId: 'history-run', status: 'completed' })
    expect(scan.records[0]?.workloads.map(workload => workload.workload)).toEqual(['prefill', 'decode'])
    expect(scan.invalid).toEqual([])
  })

  it('skips malformed and tampered retained files without hiding valid history', async () => {
    const dir = dataDir()
    const value = await record('valid-run')
    await savePerformanceRunV1(value, { dataDir: dir })
    const recordsDir = performanceHistoryDirectoryV1(dir)
    const file = readdirSync(recordsDir).find(name => name.endsWith('.json'))!
    const stored = JSON.parse(readFileSync(join(recordsDir, file), 'utf8')) as Record<string, unknown>
    const storedRecord = stored.record as Record<string, unknown>
    storedRecord.status = 'failed'
    writeFileSync(join(recordsDir, file), JSON.stringify(stored))
    writeFileSync(join(recordsDir, 'a'.repeat(64) + '.json'), '{not-json}')
    const scan = await scanPerformanceHistoryV1({ dataDir: dir })
    expect(scan.records).toHaveLength(0)
    expect(scan.invalid.length).toBe(2)
    expect(scan.invalid.some(item => item.reason.includes('result digest') || item.reason.includes('record digest'))).toBe(true)
  })

  it('rejects non-performance records at the public parser boundary', async () => {
    const dir = dataDir()
    const value = await record('parser-run')
    const result = await savePerformanceRunV1(value, { dataDir: dir })
    expect(result.status).toBe('saved')
    const scan = await scanPerformanceHistoryV1({ dataDir: dir })
    expect(scan.records[0]?.schemaVersion).toBe('metrora.bench.performance.v1')
    expect(scan.records[0]?.methodology.id).toBe('metrora.performance.llama-bench.v1')
  })
})
