import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildLlamaBenchArgs,
  parseLlamaBenchJson,
  runPerformanceBenchV1,
} from '../src/bench/performance-run-v1.js'

const directories: string[] = []

function files(): { executablePath: string; modelPath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-performance-run-'))
  directories.push(directory)
  const executablePath = join(directory, process.platform === 'win32' ? 'llama-bench.exe' : 'llama-bench')
  const modelPath = join(directory, 'fixture.gguf')
  writeFileSync(executablePath, 'native fixture')
  writeFileSync(modelPath, 'gguf fixture')
  return { executablePath, modelPath }
}

function output(): string {
  return JSON.stringify([
    {
      build_commit: 'abc123',
      build_number: 10516,
      backends: 'CUDA',
      cpu_info: 'fixture CPU',
      gpu_info: 'fixture GPU',
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
      flash_attn: -1,
      n_prompt: 512,
      n_gen: 0,
      n_depth: 0,
      n_reps: 3,
      avg_ts: 1200,
      stddev_ts: 12,
      avg_ns: 426_000_000,
      stddev_ns: 4_000_000,
      test_time: '2026-08-30T10:00:01Z',
    },
    {
      build_commit: 'abc123',
      build_number: 10516,
      backends: 'CUDA',
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
      avg_ts: 80,
      stddev_ts: 2,
      avg_ns: 1_600_000_000,
      stddev_ns: 20_000_000,
      test_time: '2026-08-30T10:00:02Z',
    },
  ])
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Performance Bench v1', () => {
  it('builds a fixed known llama-bench argv with no free-form flags', () => {
    const { modelPath } = files()
    expect(buildLlamaBenchArgs(modelPath, { repetitions: 2, threads: 8, flashAttention: 'on', warmup: false })).toEqual([
      '-m', modelPath, '-o', 'json', '-r', '2', '-p', '512', '-n', '128', '-b', '2048', '-ub', '512', '-ngl', '-1', '-fa', 'on', '-sm', 'none', '-t', '8', '--no-warmup',
    ])
  })

  it('normalizes official JSON workload and provenance fields while preserving missing values', () => {
    const { modelPath } = files()
    const parsed = parseLlamaBenchJson(JSON.parse(output()), modelPath)
    expect(parsed.workloads).toMatchObject([
      { workload: 'prefill', promptTokens: 512, generationTokens: 0, depth: 0, throughputTokensPerSecond: 1200, averageLatencyMs: 426, repetitions: 3, testTime: '2026-08-30T10:00:01.000Z' },
      { workload: 'decode', promptTokens: 0, generationTokens: 128, depth: 0, throughputTokensPerSecond: 80, averageLatencyMs: 1600, repetitions: 3, testTime: '2026-08-30T10:00:02.000Z' },
    ])
    expect(parsed.model).toMatchObject({ reported: 'fixture.gguf', type: '7B', sizeBytes: 4_000_000_000, parameterCount: 7_000_000_000 })
    expect(parsed.model).not.toHaveProperty('quantization')
    expect(parsed.runtime).toMatchObject({ buildCommit: 'abc123', buildNumber: 10516, backends: ['CUDA'] })
    expect(parsed.hardware).toEqual({ cpuInfo: 'fixture CPU', gpuInfo: 'fixture GPU', devices: ['auto'] })
    expect(parsed.observedConfiguration).toEqual({
      batchSize: 2048,
      ubatchSize: 512,
      threads: 8,
      gpuLayers: -1,
      splitMode: 'none',
      mainGpu: 0,
      flashAttention: 'auto',
      promptTokens: 512,
      generationTokens: 128,
      repetitions: 3,
      depth: 0,
    })
    expect(parsed.workloads[1]).not.toHaveProperty('contextSize')
    expect(parsed.workloads[1]).not.toHaveProperty('testTimeSeconds')
  })

  it.each([
    { upstream: -1, normalized: 'auto' as const, declared: 'auto' as const },
    { upstream: 0, normalized: 'off' as const, declared: 'off' as const },
    { upstream: 1, normalized: 'on' as const, declared: 'on' as const },
  ])('normalizes upstream flash_attn $upstream to $normalized and matches the declared setup', ({ upstream, normalized, declared }) => {
    const { modelPath } = files()
    const rows = JSON.parse(output()) as Array<Record<string, unknown>>
    for (const row of rows) row.flash_attn = upstream
    const parsed = parseLlamaBenchJson(rows, modelPath, { flashAttention: declared })
    expect(parsed.observedConfiguration.flashAttention).toBe(normalized)
    expect(parsed.configurationMismatches).not.toContain('flash_attn')
  })

  it('keeps an absent flash_attn field unavailable', () => {
    const { modelPath } = files()
    const rows = JSON.parse(output()) as Array<Record<string, unknown>>
    for (const row of rows) delete row.flash_attn
    const parsed = parseLlamaBenchJson(rows, modelPath)
    expect(parsed.observedConfiguration.flashAttention).toBeNull()
    expect(parsed.configurationMismatches).not.toContain('flash_attn')
  })

  it('returns a completed retained record through an injected native process runner', async () => {
    const { executablePath, modelPath } = files()
    const runner = vi.fn(async (_executable: string, args: readonly string[]) => {
      expect(args).toContain('-o')
      expect(args).toContain('json')
      return { stdout: output(), stderr: '', code: 0 }
    })
    const result = await runPerformanceBenchV1({ executablePath, modelPath, runId: 'perf-run-1', processRunner: runner, now: () => new Date('2026-08-30T10:00:00.000Z') })
    expect(runner).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ schemaVersion: 'metrora.bench.performance.v1', runId: 'perf-run-1', status: 'completed', termination: { status: 'none' }, failure: null, model: { selected: 'fixture.gguf' }, observedConfiguration: { splitMode: 'none', batchSize: 2048, ubatchSize: 512 } })
    expect(result.workloads.map(item => item.workload)).toEqual(['prefill', 'decode'])
    expect(result.resultDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('fails closed when llama-bench reports a material setup mismatch', async () => {
    const { executablePath, modelPath } = files()
    const mismatched = JSON.parse(output()) as Array<Record<string, unknown>>
    mismatched[0]!.n_batch = 1024
    const result = await runPerformanceBenchV1({
      executablePath,
      modelPath,
      processRunner: async () => ({ stdout: JSON.stringify(mismatched), stderr: '', code: 0 }),
    })
    expect(result).toMatchObject({ status: 'failed', termination: { status: 'none' }, failure: { code: 'configuration-mismatch' } })
    expect(result.workloads).toHaveLength(2)
  })

  it('reports a semantic flash attention mismatch as configuration-mismatch', async () => {
    const { executablePath, modelPath } = files()
    const mismatched = JSON.parse(output()) as Array<Record<string, unknown>>
    for (const row of mismatched) row.flash_attn = 1
    const result = await runPerformanceBenchV1({
      executablePath,
      modelPath,
      setup: { flashAttention: 'auto' },
      processRunner: async () => ({ stdout: JSON.stringify(mismatched), stderr: '', code: 0 }),
    })
    expect(result).toMatchObject({ status: 'failed', termination: { status: 'none' }, failure: { code: 'configuration-mismatch' } })
    expect(result.failure?.message).toContain('flash_attn')
  })

  it('fails closed on an unsupported upstream flash_attn value', async () => {
    const { executablePath, modelPath } = files()
    const malformed = JSON.parse(output()) as Array<Record<string, unknown>>
    for (const row of malformed) row.flash_attn = 2
    expect(() => parseLlamaBenchJson(malformed, modelPath)).toThrow(/unsupported flash_attn/u)
    const result = await runPerformanceBenchV1({
      executablePath,
      modelPath,
      processRunner: async () => ({ stdout: JSON.stringify(malformed), stderr: '', code: 0 }),
    })
    expect(result).toMatchObject({ status: 'failed', termination: { status: 'malformed-output' }, failure: { code: 'malformed-output' } })
  })

  it.each([
    [{ reason: 'cancelled' as const, status: 'cancelled', termination: 'cancelled' }, 'cancelled'],
    [{ reason: 'timeout' as const, status: 'failed', termination: 'timeout' }, 'timeout'],
    [{ reason: 'too-large' as const, status: 'failed', termination: 'output-limit' }, 'output-limit'],
  ])('keeps native termination truthful for %s', async (processResult, failureCode) => {
    const { executablePath, modelPath } = files()
    const result = await runPerformanceBenchV1({ executablePath, modelPath, processRunner: async () => ({ stdout: '', stderr: '', code: null, reason: processResult.reason }) })
    expect(result.status).toBe(processResult.status)
    expect(result.termination.status).toBe(processResult.termination)
    expect(result.failure?.code).toBe(failureCode)
    expect(result.workloads).toEqual([])
  })

  it('fails closed on malformed output and rejects arbitrary or non-GGUF paths', async () => {
    const { executablePath, modelPath } = files()
    const malformed = await runPerformanceBenchV1({ executablePath, modelPath, processRunner: async () => ({ stdout: '{not-json}', stderr: '', code: 0 }) })
    expect(malformed.status).toBe('failed')
    expect(malformed.termination.status).toBe('malformed-output')
    expect(malformed.failure?.code).toBe('malformed-output')
    await expect(runPerformanceBenchV1({ executablePath: executablePath + ' --unsafe', modelPath, processRunner: async () => ({ stdout: output(), stderr: '', code: 0 }) })).rejects.toThrow(/invalid|not found/u)
    await expect(runPerformanceBenchV1({ executablePath, modelPath: join(tmpdir(), 'model.bin'), processRunner: async () => ({ stdout: output(), stderr: '', code: 0 }) })).rejects.toThrow(/not found/u)
  })
})
