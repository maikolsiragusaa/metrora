// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bench } from './Bench'

const {
  getBenchHistory,
  getBenchModelDiscovery,
  getBenchComparison,
  runBenchTaskPack,
  getPerformanceBenchHistory,
  getPerformanceBenchComparison,
  runPerformanceBench,
  cancelPerformanceBench,
  chooseFile,
} = vi.hoisted(() => ({
  getBenchHistory: vi.fn(),
  getBenchModelDiscovery: vi.fn(),
  getBenchComparison: vi.fn(),
  runBenchTaskPack: vi.fn(),
  getPerformanceBenchHistory: vi.fn(),
  getPerformanceBenchComparison: vi.fn(),
  runPerformanceBench: vi.fn(),
  cancelPerformanceBench: vi.fn(),
  chooseFile: vi.fn(),
}))

vi.mock('../lib/ipc', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return {
    ...actual,
    metrora: {
      ...actual.metrora,
      getBenchHistory,
      getBenchModelDiscovery,
      getBenchComparison,
      runBenchTaskPack,
      getPerformanceBenchHistory,
      getPerformanceBenchComparison,
      runPerformanceBench,
      cancelPerformanceBench,
      chooseFile,
    },
  }
})

const runtimeReported = {
  totalDurationNs: 100_000_000,
  loadDurationNs: 10_000_000,
  promptEvalCount: 3,
  promptEvalDurationNs: 4_000_000,
  evalCount: 4,
  evalDurationNs: 80_000_000,
}

function record(runId: string, model: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'metrora.bench-evaluation.v1',
    runId,
    runner: { id: 'ollama-task-pack-v1', version: '1.0.0' },
    pack: { packId: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) },
    model: { selected: model, reported: model },
    runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434', version: '0.12.6' },
    environment: { os: 'test', arch: 'x64', node: 'v22' },
    generation: { parameters: { temperature: 0, seed: 1729, numPredict: 64 }, policy: 'one-bounded-request-per-task' },
    startedAt: '2026-08-24T10:00:00.000Z',
    endedAt: '2026-08-24T10:01:00.000Z',
    status: 'completed',
    tasks: [{ taskId: 'exact-word', attempted: true, status: 'passed', score: 1, outputDigest: 'b'.repeat(64), outputChars: 4, requestLatencyMs: 10, timeToFirstContentMs: 3, runtimeReported, failure: null }],
    aggregate: { planned: 1, attempted: 1, passed: 1, failed: 0, unavailable: 0, cancelled: 0, score: { numerator: 1, denominator: 1, value: 1 } },
    resultDigest: 'c'.repeat(64),
    ...overrides,
  }
}

function performanceRecord(runId: string, model = 'Qwen3.5-9B-UD-Q4_K_XL-MTP.gguf', overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'metrora.bench.performance.v1',
    runId,
    runner: { id: 'llama-bench', version: '1.0.0' },
    methodology: {
      id: 'metrora.performance.llama-bench.v1',
      version: '1',
      setup: {
        repetitions: 3,
        promptTokens: 512,
        generationTokens: 128,
        batchSize: 2048,
        ubatchSize: 512,
        threads: null,
        gpuLayers: -1,
        flashAttention: 'auto',
        splitMode: 'none',
        mainGpu: null,
        warmup: true,
      },
      argvDigest: 'd'.repeat(64),
    },
    model: { selected: model, reported: model, type: 'Medium', sizeBytes: null, parameterCount: null },
    executable: { name: 'llama-bench' },
    runtime: { id: 'llama.cpp-native', buildCommit: 'c1d0e7a00', buildNumber: null, version: 'native · c1d0e7a00', backends: [] },
    hardware: { cpuInfo: 'Test CPU', gpuInfo: null, devices: [] },
    environment: { os: 'test-os', arch: 'x64', node: 'v22' },
    startedAt: '2026-08-31T23:44:00.000Z',
    endedAt: '2026-08-31T23:45:48.000Z',
    status: 'completed',
    termination: { status: 'none' },
    failure: null,
    observedConfiguration: null,
    workloads: [
      { workload: 'prefill', promptTokens: 512, generationTokens: 128, depth: null, repetitions: 3, throughputTokensPerSecond: 22.6, throughputStddevTokensPerSecond: 0.5, averageTimeNs: 22_716_000_000, averageLatencyMs: 22716, testTime: null },
      { workload: 'decode', promptTokens: 512, generationTokens: 128, depth: null, repetitions: 3, throughputTokensPerSecond: 6.0, throughputStddevTokensPerSecond: 0.2, averageTimeNs: null, averageLatencyMs: null, testTime: null },
    ],
    resultDigest: 'e'.repeat(64),
    ...overrides,
  }
}

function unavailableRecord(runId = 'run-unavailable') {
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    taskId: `task-${index + 1}`,
    attempted: false,
    status: 'unavailable',
    score: null,
    outputDigest: null,
    outputChars: null,
    requestLatencyMs: null,
    timeToFirstContentMs: null,
    runtimeReported: { totalDurationNs: null, loadDurationNs: null, promptEvalCount: null, promptEvalDurationNs: null, evalCount: null, evalDurationNs: null },
    failure: { code: 'runtime-unavailable', message: 'Ollama local runtime unavailable.' },
  }))
  return record(runId, 'qwen3:8b', {
    status: 'unavailable',
    tasks,
    aggregate: { planned: 6, attempted: 0, passed: 0, failed: 0, unavailable: 6, cancelled: 0, score: { numerator: 0, denominator: 0, value: null } },
  })
}

function partialUnavailableRecord(runId = 'run-partial-unavailable') {
  const base = unavailableRecord(runId)
  const tasks = base.tasks.map((task: Record<string, unknown>, index: number) => index === 0
    ? { ...task, attempted: true, status: 'passed', score: 1, outputDigest: 'b'.repeat(64), outputChars: 4, requestLatencyMs: 10, timeToFirstContentMs: 3, failure: null }
    : task)
  return {
    ...base,
    tasks,
    aggregate: { planned: 6, attempted: 1, passed: 1, failed: 0, unavailable: 5, cancelled: 0, score: { numerator: 1, denominator: 1, value: 1 } },
  }
}

function compatibleComparison() {
  return {
    schemaVersion: 'metrora.bench-comparison.v1',
    compatible: true,
    reason: 'compatible',
    left: { runId: 'run-a', model: 'llama3.2', endedAt: '2026-08-24T10:01:00.000Z' },
    right: { runId: 'run-b', model: 'qwen3:8b', endedAt: '2026-08-24T10:01:00.000Z' },
    deltas: { score: 0, passed: 0, failed: 0, unavailable: 0, cancelled: 0, medianRequestLatencyMs: 0, medianFirstContentMs: 0 },
  }
}

function compatiblePerformanceComparison() {
  return {
    schemaVersion: 'metrora.performance-comparison.v1',
    compatible: true,
    reason: 'compatible',
    left: {
      runId: 'perf-a',
      model: 'Qwen3.5-9B-UD-Q4_K_XL-MTP.gguf',
      modelType: 'Medium',
      endedAt: '2026-08-31T23:45:48.000Z',
      executable: 'llama-bench',
      runtime: { id: 'llama.cpp-native', buildCommit: 'c1d0e7a00', buildNumber: null, version: 'native', backends: [] },
      hardware: { cpuInfo: 'Test CPU', gpuInfo: null, devices: [] },
      environment: { os: 'test-os', arch: 'x64', node: 'v22' },
      setup: { repetitions: 3, promptTokens: 512, generationTokens: 128, batchSize: 2048, ubatchSize: 512, threads: null, gpuLayers: -1, flashAttention: 'auto', splitMode: 'none', mainGpu: null, warmup: true },
      observedConfiguration: null,
    },
    right: {
      runId: 'perf-b',
      model: 'Qwen3.5-9B-UD-Q4_K_XL-MTP.gguf',
      modelType: 'Medium',
      endedAt: '2026-08-31T23:46:48.000Z',
      executable: 'llama-bench',
      runtime: { id: 'llama.cpp-native', buildCommit: 'c1d0e7a00', buildNumber: null, version: 'native', backends: [] },
      hardware: { cpuInfo: 'Test CPU', gpuInfo: null, devices: [] },
      environment: { os: 'test-os', arch: 'x64', node: 'v22' },
      setup: { repetitions: 3, promptTokens: 512, generationTokens: 128, batchSize: 2048, ubatchSize: 512, threads: null, gpuLayers: -1, flashAttention: 'auto', splitMode: 'none', mainGpu: null, warmup: true },
      observedConfiguration: null,
    },
    deltas: { prefillThroughputTokensPerSecond: 1.5, decodeThroughputTokensPerSecond: 0.5, prefillLatencyMs: -100, decodeLatencyMs: null },
  }
}

function defaultHistory() {
  return { schemaVersion: 'metrora.bench-history-report.v1', records: [record('run-b', 'qwen3:8b'), record('run-a', 'llama3.2')], invalidCount: 0 }
}

function defaultPerformanceHistory() {
  return { schemaVersion: 'metrora.performance-history-report.v1', records: [performanceRecord('perf-b'), performanceRecord('perf-a')], invalidCount: 0 }
}

describe('Bench overview / preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBenchHistory.mockResolvedValue(defaultHistory())
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b', 'llama3.2'],
      detail: '2 local Ollama models discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    getBenchComparison.mockResolvedValue(compatibleComparison())
    runBenchTaskPack.mockResolvedValue(record('run-c', 'qwen3:8b'))
    getPerformanceBenchHistory.mockResolvedValue(defaultPerformanceHistory())
    getPerformanceBenchComparison.mockResolvedValue(compatiblePerformanceComparison())
    runPerformanceBench.mockResolvedValue(performanceRecord('perf-c'))
    chooseFile.mockResolvedValue('/tmp/llama-bench')
  })

  it('shows the Bench preview by default with four families and methodology', async () => {
    render(<Bench />)
    expect(await screen.findByRole('heading', { name: 'Bench' })).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
    expect(screen.getByText('Evaluate models and AI systems with reproducible evidence.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Performance' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Model evaluations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Coding evaluations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Agent evaluations' })).toBeInTheDocument()
    expect(screen.getAllByText('Available').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Exploring')).toBeInTheDocument()
    expect(screen.getAllByText('Future').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Current foundation: llama.cpp / llama-bench')).toBeInTheDocument()
    expect(screen.getByText('Established benchmarks. Transparent methodology.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Performance/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Advanced Bench/ })).toBeInTheDocument()
  })

  it('keeps the initial overview lightweight with no Bench bridge reads', async () => {
    render(<Bench />)
    await screen.findByRole('heading', { name: 'Bench' })
    // Overview is informational only; advanced reads must not fire on entry.
    expect(getBenchHistory).not.toHaveBeenCalled()
    expect(getBenchModelDiscovery).not.toHaveBeenCalled()
    expect(getPerformanceBenchHistory).not.toHaveBeenCalled()
    expect(getPerformanceBenchComparison).not.toHaveBeenCalled()
    expect(runBenchTaskPack).not.toHaveBeenCalled()
    expect(runPerformanceBench).not.toHaveBeenCalled()
  })

  it('uses the shared Search sections TopBar without fake scope controls', async () => {
    render(<Bench />)
    await screen.findByRole('heading', { name: 'Bench' })
    expect(screen.getByRole('button', { name: /Search Metrora sections/ })).toBeInTheDocument()
    expect(screen.queryByText('7D')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Providers')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Metrora Projects')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Bench' })).toHaveLength(1)
  })

  it('navigates from overview to Performance and back', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Performance/ }))
    expect(await screen.findByRole('navigation', { name: 'Bench location' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Performance' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Back to Bench Preview/ })[0]!)
    expect(await screen.findByRole('heading', { name: 'Bench' })).toBeInTheDocument()
  })
})

describe('Bench mainstream Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBenchHistory.mockResolvedValue(defaultHistory())
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b'],
      detail: '1 local Ollama model discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    getBenchComparison.mockResolvedValue(compatibleComparison())
    runBenchTaskPack.mockResolvedValue(record('run-c', 'qwen3:8b'))
    getPerformanceBenchHistory.mockResolvedValue(defaultPerformanceHistory())
    getPerformanceBenchComparison.mockResolvedValue(compatiblePerformanceComparison())
    runPerformanceBench.mockResolvedValue(performanceRecord('perf-c'))
    chooseFile.mockResolvedValue('/tmp/model.gguf')
  })

  it('loads only Performance history on the Performance view', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Performance/ }))
    await waitFor(() => expect(getPerformanceBenchHistory).toHaveBeenCalledTimes(1))
    expect(getBenchHistory).not.toHaveBeenCalled()
    expect(getBenchModelDiscovery).not.toHaveBeenCalled()
    expect(await screen.findByText('Latest result')).toBeInTheDocument()
  })

  it('presents real choosers, fixed workload, and factual KPIs without peak memory', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Performance/ }))
    await screen.findByText('Latest result')
    expect(screen.getByRole('button', { name: /Choose model/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Choose runtime/ })).toBeInTheDocument()
    expect(screen.getAllByText('512 prompt · 128 generation').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: /Choose workload/ })).not.toBeInTheDocument()
    expect(screen.getByText('Prefill throughput')).toBeInTheDocument()
    expect(screen.getByText('Generation throughput')).toBeInTheDocument()
    expect(screen.queryByText(/Peak memory/)).not.toBeInTheDocument()
  })

  it('runs and cancels through the real Performance bridge', async () => {
    chooseFile
      .mockResolvedValueOnce('/tmp/llama-bench')
      .mockResolvedValueOnce('/tmp/model.gguf')
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Performance/ }))
    await screen.findByText('Latest result')
    fireEvent.click(screen.getByRole('button', { name: /Choose runtime/ }))
    await waitFor(() => expect(chooseFile).toHaveBeenCalledWith('llama-bench'))
    fireEvent.click(screen.getByRole('button', { name: /Choose model/ }))
    await waitFor(() => expect(chooseFile).toHaveBeenCalledWith('gguf'))
    fireEvent.click(screen.getByRole('button', { name: /Run benchmark/ }))
    await waitFor(() => expect(runPerformanceBench).toHaveBeenCalled())
  })

  it('reports incompatible Performance records without inventing deltas', async () => {
    getPerformanceBenchComparison.mockResolvedValue({ ...compatiblePerformanceComparison(), compatible: false, reason: 'setup-mismatch', deltas: null })
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Performance/ }))
    expect(await screen.findByText('Not comparable')).toBeInTheDocument()
    expect(screen.getByText(/declared setup differs/)).toBeInTheDocument()
  })
})

describe('Bench future previews are non-executable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBenchHistory.mockResolvedValue(defaultHistory())
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b'],
      detail: '1 local Ollama model discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    getBenchComparison.mockResolvedValue(compatibleComparison())
    getPerformanceBenchHistory.mockResolvedValue(defaultPerformanceHistory())
    getPerformanceBenchComparison.mockResolvedValue(compatiblePerformanceComparison())
  })

  it('describes model evaluations as exploring with candidates and no Run', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Preview model evaluations/ }))
    expect(await screen.findByRole('heading', { name: 'Model evaluations' })).toBeInTheDocument()
    expect(screen.getByText('Exploring')).toBeInTheDocument()
    expect(screen.getByText('Inspect AI')).toBeInTheDocument()
    expect(screen.getByText('Candidate')).toBeInTheDocument()
    expect(screen.getByText('lm-evaluation-harness')).toBeInTheDocument()
    expect(screen.getByText('Integration has not been selected yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument()
    expect(getBenchHistory).not.toHaveBeenCalled()
    expect(getPerformanceBenchHistory).not.toHaveBeenCalled()
  })

  it('describes coding evaluations as future with EvalPlus and no release promise', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Preview coding evaluations/ }))
    expect(await screen.findByRole('heading', { name: 'Coding evaluations' })).toBeInTheDocument()
    expect(screen.getByText('EvalPlus')).toBeInTheDocument()
    expect(screen.getByText('Candidate')).toBeInTheDocument()
    expect(screen.getByText('This evaluation family is a future direction and is not executable yet.')).toBeInTheDocument()
    expect(screen.queryByText(/will be available in a future release/)).not.toBeInTheDocument()
    expect(screen.getByText('Separate from local Performance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument()
  })

  it('keeps Harbor outside the Agent node and frames the full system', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Preview agent evaluations/ }))
    expect(await screen.findByRole('heading', { name: 'Agent evaluations' })).toBeInTheDocument()
    const flow = screen.getByRole('list', { name: 'Agent evaluation flow' })
    expect(within(flow).getByText('Agent')).toBeInTheDocument()
    expect(within(flow).queryByText(/Harbor/)).not.toBeInTheDocument()
    expect(screen.getByText('Harbor')).toBeInTheDocument()
    expect(screen.getByText('SWE-bench')).toBeInTheDocument()
    expect(screen.getByText('Terminal-Bench')).toBeInTheDocument()
    expect(screen.getByText('Agent evaluations evaluate the full system')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument()
  })
})

describe('Bench final polish copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBenchHistory.mockResolvedValue(defaultHistory())
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b'],
      detail: '1 local Ollama model discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    getBenchComparison.mockResolvedValue(compatibleComparison())
    getPerformanceBenchHistory.mockResolvedValue(defaultPerformanceHistory())
    getPerformanceBenchComparison.mockResolvedValue(compatiblePerformanceComparison())
    runPerformanceBench.mockResolvedValue(performanceRecord('perf-c'))
    chooseFile.mockResolvedValue('/tmp/model.gguf')
  })

  it('presents bounded Performance configuration as fixed and read-only', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Performance/ }))
    await screen.findByText('Latest result')
    expect(screen.getByText('Benchmark configuration')).toBeInTheDocument()
    expect(screen.getByText('Fixed')).toBeInTheDocument()
    expect(screen.queryByText('Advanced configuration')).not.toBeInTheDocument()
    expect(screen.queryByText('Optional')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Inspect the fixed repetitions, token counts, batch size, GPU layers, Flash Attention and runtime settings used by this benchmark.',
      ),
    ).toBeInTheDocument()
  })

  it('labels retained hardware truthfully with its run timestamp', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Performance/ }))
    await screen.findByText('Latest result')
    expect(screen.getByRole('heading', { name: 'Last observed hardware' })).toBeInTheDocument()
    expect(screen.getByText('From latest retained run: Test CPU')).toBeInTheDocument()
  })

  it('keeps model methodology free of coding benchmark examples', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Preview model evaluations/ }))
    expect(await screen.findByRole('heading', { name: 'Model evaluations' })).toBeInTheDocument()
    expect(screen.getByText(/e\.g\. MMLU, GPQA/)).toBeInTheDocument()
    const methodology = screen.getByRole('heading', { name: 'Methodology' }).closest('section')!
    expect(within(methodology).queryByText(/HumanEval/)).not.toBeInTheDocument()
  })

  it('uses intended language for coding evaluations without release promises', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Preview coding evaluations/ }))
    expect(await screen.findByRole('heading', { name: 'Coding evaluations' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This evaluation family is intended to measure how models solve programming tasks using established benchmarks and reproducible environments.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Coding evaluations are intended to provide standardized, reproducible results that are independent of your local hardware performance.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Metrora will evaluate/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Coding evaluations will provide/)).not.toBeInTheDocument()
  })

  it('keeps related coding benchmarks separated as name plus description', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Preview coding evaluations/ }))
    expect(await screen.findByRole('heading', { name: 'Coding evaluations' })).toBeInTheDocument()
    const humanEval = screen.getByText('HumanEval+')
    const mbpp = screen.getByText('MBPP+')
    expect(humanEval.nextElementSibling?.textContent).toMatch(/An extended version/)
    expect(mbpp.nextElementSibling?.textContent).toMatch(/An improved version/)
  })

  it('frames agent evaluations without a universal score', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Preview agent evaluations/ }))
    expect(await screen.findByRole('heading', { name: 'Agent evaluations' })).toBeInTheDocument()
    expect(screen.getByText('Agent evaluations evaluate the full system')).toBeInTheDocument()
    expect(screen.queryByText('Agent evaluations score the full system')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Candidate benchmark families include established software-engineering and terminal-task benchmarks.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/We plan to support established agent benchmarks/)).not.toBeInTheDocument()
  })
})

describe('Bench advanced surface preserves technical behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBenchHistory.mockResolvedValue(defaultHistory())
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b', 'llama3.2'],
      detail: '2 local Ollama models discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    getBenchComparison.mockResolvedValue(compatibleComparison())
    runBenchTaskPack.mockResolvedValue(record('run-c', 'qwen3:8b'))
    getPerformanceBenchHistory.mockResolvedValue(defaultPerformanceHistory())
    getPerformanceBenchComparison.mockResolvedValue(compatiblePerformanceComparison())
    runPerformanceBench.mockResolvedValue(performanceRecord('perf-c'))
    chooseFile.mockResolvedValue('/tmp/llama-bench')
  })

  it('opens Advanced Bench with Performance and Compatibility tabs', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    expect(await screen.findByRole('heading', { name: 'Advanced Bench' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Performance' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Compatibility' })).toBeInTheDocument()
    await waitFor(() => expect(getPerformanceBenchHistory).toHaveBeenCalledTimes(1))
    expect(getBenchHistory).not.toHaveBeenCalled()
  })

  it('keeps Compatibility/Core behavior behind the Compatibility tab', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    expect(await screen.findByRole('heading', { name: 'Compatibility / Runtime Health' })).toBeInTheDocument()
    expect(await screen.findByText(/2 local Ollama models discovered/)).toBeInTheDocument()
    expect(screen.getByLabelText('Local model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Core conformance' })).toBeInTheDocument()
    expect(screen.getByText(/without a universal quality score/)).toBeInTheDocument()
  })

  it('runs the selected discovered model and updates the evidence list', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    await screen.findByText(/2 local Ollama models discovered/)
    fireEvent.change(screen.getByLabelText('Local model'), { target: { value: 'qwen3:8b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Core conformance' }))
    await waitFor(() => expect(runBenchTaskPack).toHaveBeenCalledWith('qwen3:8b', 'core-v1'))
    expect(screen.getByText('Latest core conformance')).toBeInTheDocument()
  })

  it('shows an unavailable result after a runtime outage instead of retaining the previous score', async () => {
    runBenchTaskPack.mockResolvedValue(record('run-c', 'qwen3:8b', {
      status: 'unavailable',
      tasks: [{ taskId: 'exact-word', attempted: false, status: 'unavailable', score: null, outputDigest: null, outputChars: null, requestLatencyMs: null, timeToFirstContentMs: null, runtimeReported, failure: { code: 'runtime-unavailable', message: 'Ollama local runtime unavailable.' } }],
      aggregate: { planned: 1, attempted: 0, passed: 0, failed: 0, unavailable: 1, cancelled: 0, score: { numerator: 0, denominator: 0, value: null } },
    }))
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    await screen.findByText(/2 local Ollama models discovered/)
    fireEvent.change(screen.getByLabelText('Local model'), { target: { value: 'qwen3:8b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Core conformance' }))

    await waitFor(() => expect(runBenchTaskPack).toHaveBeenCalledWith('qwen3:8b', 'core-v1'))
    expect(await screen.findByText('Runtime unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('No checks scored · 1 planned').length).toBeGreaterThan(0)
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })

  it('keeps technical identity and raw task evidence behind progressive disclosure', async () => {
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    await screen.findByText('Latest core conformance')
    const details = screen.getByText('Details').closest('details')
    const evidence = screen.getByText('Evidence').closest('details')
    expect(details).not.toBeNull()
    expect(evidence).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Details'))
    fireEvent.click(screen.getByText('Evidence'))
    expect(details).toHaveAttribute('open')
    expect(evidence).toHaveAttribute('open')
    expect(screen.getByText('Pack identity')).toBeInTheDocument()
    expect(screen.getByText('Raw task results')).toBeInTheDocument()
    expect(screen.getByText(/Response bodies and prompts are not retained/)).toBeInTheDocument()
  })

  it('does not turn unavailable runtime state into a zero score', async () => {
    getBenchHistory.mockResolvedValue({ schemaVersion: 'metrora.bench-history-report.v1', records: [unavailableRecord()], invalidCount: 0 })
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    expect(await screen.findByText('Runtime unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('No checks scored · 6 planned').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0)
    expect(screen.queryByText('0 / 6')).not.toBeInTheDocument()
  })

  it('distinguishes a runtime outage during a partial run from generic incompleteness', async () => {
    getBenchHistory.mockResolvedValue({ schemaVersion: 'metrora.bench-history-report.v1', records: [partialUnavailableRecord()], invalidCount: 0 })
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    expect(await screen.findByText('Runtime unavailable during run')).toBeInTheDocument()
    expect(screen.getByText(/local runtime became unavailable during the run/)).toBeInTheDocument()
  })

  it('distinguishes invalid-only history from an empty history', async () => {
    getBenchHistory.mockResolvedValue({ schemaVersion: 'metrora.bench-history-report.v1', records: [], invalidCount: 2 })
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    expect(await screen.findByText(/No usable Core conformance runs yet/)).toBeInTheDocument()
    expect(screen.getByText('2 invalid retained records skipped')).toBeInTheDocument()
  })

  it('keeps manual entry available when local model discovery is unavailable', async () => {
    getBenchModelDiscovery.mockRejectedValue(new Error('bridge unavailable'))
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    expect(await screen.findByText(/Manual Ollama model entry remains available/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. qwen3:8b')).toBeInTheDocument()
  })

  it('distinguishes structured discovery unavailability from an empty model list', async () => {
    getBenchModelDiscovery.mockResolvedValue({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'unavailable',
      models: [],
      detail: 'Ollama local runtime is unavailable.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    })
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    expect(await screen.findByText(/Model discovery is unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/No local Ollama models were discovered/)).not.toBeInTheDocument()
  })

  it('preserves a manually entered model when discovery is refreshed', async () => {
    getBenchModelDiscovery.mockResolvedValueOnce({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'no-models',
      models: [],
      detail: 'Ollama is reachable but no usable local models were discovered.',
      checkedAt: '2026-08-24T10:00:00.000Z',
    }).mockResolvedValueOnce({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b'],
      detail: '1 local Ollama model discovered.',
      checkedAt: '2026-08-24T10:01:00.000Z',
    })
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    const input = await screen.findByPlaceholderText('e.g. qwen3:8b')
    fireEvent.change(input, { target: { value: 'manual-model:latest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
    expect(await screen.findByDisplayValue('manual-model:latest')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use a discovered model' })).toBeInTheDocument()
  })

  it('reports incompatible retained records without inventing deltas', async () => {
    getBenchComparison.mockResolvedValue({ ...compatibleComparison(), compatible: false, reason: 'pack-mismatch', deltas: null })
    render(<Bench />)
    fireEvent.click(await screen.findByRole('button', { name: /Open Advanced Bench/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Compatibility' }))
    expect(await screen.findByText('Not comparable')).toBeInTheDocument()
    expect(screen.getByText('Reason: pack identity differs')).toBeInTheDocument()
    expect(screen.queryByText('Pass-rate delta')).not.toBeInTheDocument()
  })
})
