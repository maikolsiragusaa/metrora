import { describe, expect, it } from 'vitest'
import { comparePerformanceRunsV1 } from '../src/bench/performance-compare-v1.js'
import { performanceResultDigest, type PerformanceRunV1 } from '../src/bench/performance-contract-v1.js'

function run(runId: string, patch: Partial<PerformanceRunV1> = {}): PerformanceRunV1 {
  const base: PerformanceRunV1 = {
    schemaVersion: 'metrora.bench.performance.v1',
    runId,
    runner: { id: 'llama-bench', version: '1.0.0' },
    methodology: {
      id: 'metrora.performance.llama-bench.v1',
      version: '1',
      setup: { repetitions: 3, promptTokens: 512, generationTokens: 128, batchSize: 2048, ubatchSize: 512, threads: null, gpuLayers: -1, flashAttention: 'auto', splitMode: 'none', mainGpu: null, warmup: true },
      argvDigest: 'a'.repeat(64),
    },
    model: { selected: 'model.gguf', reported: 'model.gguf', type: '7B', quantization: 'Q4_K_M', sizeBytes: 4_000_000_000, parameterCount: 7_000_000_000 },
    executable: { name: 'llama-bench.exe' },
    runtime: { id: 'llama.cpp-native', buildCommit: 'abc', buildNumber: 1, version: 'abc', backends: ['CPU'] },
    hardware: { cpuInfo: 'CPU', gpuInfo: null, devices: [] },
    environment: { os: 'test', arch: 'x64', node: 'v22' },
    startedAt: '2026-08-30T10:00:00.000Z',
    endedAt: '2026-08-30T10:00:01.000Z',
    status: 'completed',
    termination: { status: 'none' },
    failure: null,
    workloads: [
      { workload: 'prefill', promptTokens: 512, generationTokens: 0, contextSize: null, repetitions: 3, throughputTokensPerSecond: 100, throughputStddevTokensPerSecond: 1, averageTimeNs: 10_000_000, averageLatencyMs: 10, testTimeSeconds: 1 },
      { workload: 'decode', promptTokens: 0, generationTokens: 128, contextSize: null, repetitions: 3, throughputTokensPerSecond: 20, throughputStddevTokensPerSecond: 1, averageTimeNs: 50_000_000, averageLatencyMs: 50, testTimeSeconds: 2 },
    ],
    resultDigest: '',
  }
  const result = { ...base, ...patch }
  result.resultDigest = performanceResultDigest(result)
  return result
}

describe('Performance comparison v1', () => {
  it('calculates conditional throughput and latency deltas for compatible completed runs', () => {
    const comparison = comparePerformanceRunsV1(run('left'), run('right', { model: { ...run('left').model, selected: 'other.gguf' }, workloads: [
      { ...run('left').workloads[0]!, throughputTokensPerSecond: 120, averageLatencyMs: 9 },
      { ...run('left').workloads[1]!, throughputTokensPerSecond: 18, averageLatencyMs: 55 },
    ] }))
    expect(comparison).toMatchObject({ compatible: true, reason: 'compatible', deltas: { prefillThroughputTokensPerSecond: 20, decodeThroughputTokensPerSecond: -2, prefillLatencyMs: -1, decodeLatencyMs: 5 } })
  })

  it.each([
    ['setup-mismatch', { methodology: { ...run('x').methodology, setup: { ...run('x').methodology.setup, batchSize: 1024 } } }],
    ['hardware-mismatch', { hardware: { cpuInfo: 'different CPU', gpuInfo: null, devices: [] } }],
    ['incomplete-run', { status: 'failed', termination: { status: 'malformed-output' }, failure: { code: 'malformed', message: 'bad output' }, workloads: [] }],
    ['missing-metrics', { workloads: [{ ...run('x').workloads[0]!, throughputTokensPerSecond: null, averageLatencyMs: null }, { ...run('x').workloads[1]!, throughputTokensPerSecond: null, averageLatencyMs: null }] }],
  ] as const)('returns %s instead of calculating unsupported deltas', (reason, patch) => {
    const comparison = comparePerformanceRunsV1(run('left'), run('right', patch as Partial<PerformanceRunV1>))
    expect(comparison).toMatchObject({ compatible: false, reason, deltas: null })
  })
})
