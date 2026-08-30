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
      stdout: JSON.stringify([{ n_prompt: 512, n_gen: 0, avg_ts: 100, avg_ns: 1_000_000 }]),
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
    expect(scan.records[0]).toMatchObject({ runId: 'history-run', status: 'completed', workloads: [{ workload: 'prefill' }] })
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
