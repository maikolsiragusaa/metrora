import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import { readCanonicalBenchEvidenceV1 } from '../src/bench/evidence-v1.js'
import { savePerformanceRunV1 } from '../src/bench/performance-history-v1.js'
import { runPerformanceBenchV1 } from '../src/bench/performance-run-v1.js'
import { createMetroraToolRuntime } from '../src/mcp/runtime.js'

const directories: string[] = []

function fixtureOutput(): string {
  return JSON.stringify([
    {
      build_commit: 'abc123',
      build_number: 10516,
      cpu_info: 'fixture CPU',
      gpu_info: 'fixture GPU',
      backends: 'CUDA',
      devices: 'auto',
      model_filename: 'fixture.gguf',
      model_type: '7B',
      model_size: 4_000_000_000,
      model_n_params: 7_000_000_000,
      n_batch: 2048,
      n_ubatch: 512,
      n_threads: 8,
      n_gpu_layers: -1,
      split_mode: 'none',
      main_gpu: 0,
      flash_attn: 'auto',
      n_prompt: 512,
      n_gen: 0,
      n_depth: 0,
      n_reps: 3,
      avg_ns: 100_000_000,
      stddev_ns: 1_000_000,
      avg_ts: 100,
      stddev_ts: 1,
      test_time: '2026-08-30T10:00:01Z',
    },
    {
      n_batch: 2048,
      n_ubatch: 512,
      n_threads: 8,
      n_gpu_layers: -1,
      split_mode: 'none',
      main_gpu: 0,
      flash_attn: 'auto',
      n_prompt: 0,
      n_gen: 128,
      n_depth: 0,
      n_reps: 3,
      avg_ns: 500_000_000,
      stddev_ns: 5_000_000,
      avg_ts: 20,
      stddev_ts: 1,
      test_time: '2026-08-30T10:00:02Z',
    },
  ])
}

async function retainedPerformance(dataDir: string) {
  const inputDir = mkdtempSync(join(tmpdir(), 'metrora-bench-evidence-input-'))
  directories.push(inputDir)
  const executablePath = join(inputDir, 'llama-bench')
  const modelPath = join(inputDir, 'fixture.gguf')
  writeFileSync(executablePath, 'fixture')
  writeFileSync(modelPath, 'fixture')
  const record = await runPerformanceBenchV1({
    executablePath,
    modelPath,
    runId: 'canonical-performance-1',
    now: () => new Date('2026-08-30T10:00:00.000Z'),
    processRunner: async () => ({ stdout: fixtureOutput(), stderr: '', code: 0 }),
  })
  expect(record.status).toBe('completed')
  await savePerformanceRunV1(record, { dataDir })
  return record
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('canonical Bench evidence v1', () => {
  it('retains Performance facts in the transport-neutral source and the read-only MCP adapter', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metrora-bench-evidence-'))
    directories.push(dataDir)
    const record = await retainedPerformance(dataDir)

    const canonical = await readCanonicalBenchEvidenceV1({ dataDir, period: 'lifetime' })
    expect(canonical.core.state).toBe('NO_DATA')
    expect(canonical.performance).toMatchObject({
      state: 'AVAILABLE',
      latest: { runId: record.runId, model: { selected: 'fixture.gguf' }, observedConfiguration: { batchSize: 2048, ubatchSize: 512, splitMode: 'none' } },
      history: [{ runId: record.runId }],
    })

    const registry = await createMetroraToolRuntime({ period: 'lifetime', dataDir })
    const execution = await registry.execute('get_bench_evidence', {})
    const bench = execution.evidence.bench as { performance?: { state?: string; latest?: Record<string, unknown> | null } } | undefined
    expect(bench?.performance).toMatchObject({
      state: 'AVAILABLE',
      latest: { runId: record.runId, model: 'fixture.gguf', observedConfiguration: { batchSize: 2048, ubatchSize: 512, splitMode: 'none' } },
    })
    expect(execution.content).toContain('promptTokens')
    expect(execution.content).toContain('generationTokens')
    expect(execution.content).toContain('batchSize')
    expect(JSON.stringify(execution.content)).not.toContain('C:\\Users\\')
    expect(JSON.stringify(execution.content)).not.toContain('/home/')
    expect(JSON.stringify(execution.content)).not.toContain('llama-bench-input')
  })
})
