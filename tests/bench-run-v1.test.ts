import { describe, expect, it } from 'vitest'
import {
  BENCH_RUNNER_ID,
  BENCH_RUNNER_VERSION,
  BENCH_RUN_SCHEMA_VERSION,
  MEASURED_RUN_COUNT,
  WARMUP_RUN_COUNT,
} from '../src/bench/contract-v1.js'
import {
  MAX_OUTPUT_BYTES,
  OLLAMA_GENERATE_URL,
  OLLAMA_LOCAL_BASE_URL,
  OLLAMA_VERSION_URL,
  type BenchFetch,
} from '../src/bench/ollama-local.js'
import { SYNTHETIC_FIXTURE_DIGEST, SYNTHETIC_FIXTURE_PACK } from '../src/bench/fixture-v1.js'
import { runBenchRunV1 } from '../src/bench/run-v1.js'
import { sha256Json } from '../src/bench/serialization.js'

type FetchCall = { url: string; init?: RequestInit; body?: Record<string, unknown> }

function streamResponse(events: unknown[], status = 200): Response {
  const body = events.map(event => JSON.stringify(event)).join('\n') + '\n'
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

function successfulEvents(withMetrics = true, output = 'synthetic fixture received'): unknown[] {
  return [
    { model: 'qwen3:8b', response: output, done: false },
    withMetrics
      ? {
          model: 'qwen3:8b',
          response: '',
          done: true,
          total_duration: 1_000_000,
          load_duration: 100_000,
          prompt_eval_count: 17,
          prompt_eval_duration: 200_000,
          eval_count: 8,
          eval_duration: 700_000,
        }
      : { model: 'qwen3:8b', response: '', done: true },
  ]
}

function makeFetch(options: {
  generateResponse?: (call: number, body: Record<string, unknown>) => Response | Promise<Response>
} = {}): { fetchImpl: BenchFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let generateCalls = 0
  const fetchImpl: BenchFetch = async (input, init) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
    calls.push({ url, init, body })
    if (url === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
    if (url !== OLLAMA_GENERATE_URL) return new Response('not found', { status: 404 })
    generateCalls += 1
    return options.generateResponse?.(generateCalls, body ?? {}) ?? streamResponse(successfulEvents())
  }
  return { fetchImpl, calls }
}

function generationCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter(call => call.url === OLLAMA_GENERATE_URL)
}

describe('BenchRunV1 ollama-local', () => {
  it('exposes a versioned manifest and deterministic fixture identity', () => {
    expect(BENCH_RUN_SCHEMA_VERSION).toBe('metrora.bench-run.v1')
    expect(BENCH_RUNNER_ID).toBe('ollama-local-v1')
    expect(BENCH_RUNNER_VERSION).toBe('1.0.0')
    expect(WARMUP_RUN_COUNT).toBe(1)
    expect(MEASURED_RUN_COUNT).toBe(5)
    expect(SYNTHETIC_FIXTURE_DIGEST).toBe(sha256Json(SYNTHETIC_FIXTURE_PACK))
  })

  it('runs exactly one warmup and five measured requests with fixed synthetic input and parameters', async () => {
    const { fetchImpl, calls } = makeFetch()
    const result = await runBenchRunV1({ model: 'qwen3:8b', fetchImpl, runId: 'test-run', timeoutMs: 1000 })
    const generate = generationCalls(calls)

    expect(result.status).toBe('completed')
    expect(generate).toHaveLength(6)
    expect(result.runs.map(run => `${run.phase}:${run.index}`)).toEqual([
      'warmup:1',
      'measured:1',
      'measured:2',
      'measured:3',
      'measured:4',
      'measured:5',
    ])
    expect(new Set(generate.map(call => JSON.stringify(call.body))).size).toBe(1)
    expect(generate[0]?.body).toMatchObject({
      model: 'qwen3:8b',
      prompt: SYNTHETIC_FIXTURE_PACK.prompt,
      stream: true,
      keep_alive: '5m',
      options: { temperature: 0, seed: 1729, num_predict: 64 },
    })
    expect(result.generation.parameters).toEqual({ temperature: 0, seed: 1729, numPredict: 64 })
    expect(result.fixture.digest).toBe(SYNTHETIC_FIXTURE_DIGEST)
    expect(result.runtime.endpoint).toBe(OLLAMA_LOCAL_BASE_URL)
    expect(calls.every(call => call.url.startsWith(OLLAMA_LOCAL_BASE_URL))).toBe(true)
    expect(calls.every(call => call.init?.redirect === 'error')).toBe(true)
  })

  it('keeps runtime-reported token metadata factual and distinguishes missing values', async () => {
    const withTokens = await runBenchRunV1({ model: 'qwen3:8b', fetchImpl: makeFetch().fetchImpl, timeoutMs: 1000 })
    expect(withTokens.runs[1]?.runtimeReported.promptEvalCount).toBe(17)
    expect(withTokens.runs[1]?.runtimeReported.evalCount).toBe(8)
    expect(withTokens.aggregate.measured.runtimeReported.evalCount).toMatchObject({ count: 5, median: 8 })

    const withoutTokens = await runBenchRunV1({
      model: 'qwen3:8b',
      fetchImpl: makeFetch({ generateResponse: () => streamResponse(successfulEvents(false)) }).fetchImpl,
      timeoutMs: 1000,
    })
    expect(withoutTokens.runs[1]?.runtimeReported.promptEvalCount).toBeNull()
    expect(withoutTokens.runs[1]?.runtimeReported.evalCount).toBeNull()
    expect(withoutTokens.aggregate.measured.runtimeReported.evalCount).toBeNull()
  })

  it('fails closed on malformed NDJSON/JSON and records exclusions', async () => {
    const result = await runBenchRunV1({
      model: 'qwen3:8b',
      fetchImpl: makeFetch({ generateResponse: () => new Response('{not-json}\n', { status: 200 }) }).fetchImpl,
      timeoutMs: 1000,
    })
    expect(result.status).toBe('failed')
    expect(result.runs[0]?.failure?.code).toBe('malformed-response')
    expect(result.aggregate.measured.attempted).toBe(0)
    expect(result.exclusions).toHaveLength(5)
  })

  it('bounds generated output and response handling', async () => {
    const oversizedOutput = 'x'.repeat(MAX_OUTPUT_BYTES + 1)
    const result = await runBenchRunV1({
      model: 'qwen3:8b',
      fetchImpl: makeFetch({ generateResponse: () => streamResponse(successfulEvents(true, oversizedOutput)) }).fetchImpl,
      timeoutMs: 1000,
    })
    expect(result.status).toBe('failed')
    expect(result.failures[0]?.code).toBe('response-limit')
    expect(result.runs[0]?.observed.outputDigest).toBeNull()
  })

  it('records a bounded timeout without hanging the run', async () => {
    const { calls } = makeFetch()
    const fetchImpl: BenchFetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
      return await new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
        else init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    }
    const result = await runBenchRunV1({ model: 'qwen3:8b', fetchImpl, timeoutMs: 50 })
    expect(result.status).toBe('failed')
    expect(result.termination.status).toBe('timeout')
    expect(result.failures[0]?.code).toBe('timeout')
  })

  it('records cancellation and excludes runs not started after the abort', async () => {
    const controller = new AbortController()
    const fetchImpl: BenchFetch = async (input, init) => {
      const url = String(input)
      if (url === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
      return await new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
        else init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    }
    const pending = runBenchRunV1({ model: 'qwen3:8b', fetchImpl, signal: controller.signal, timeoutMs: 1000 })
    setTimeout(() => controller.abort(), 10)
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(result.termination.status).toBe('cancelled')
    expect(result.failures[0]?.code).toBe('cancelled')
    expect(result.exclusions.length).toBeGreaterThan(0)
  })

  it('preserves partial failure semantics instead of fabricating missing repetitions', async () => {
    const { fetchImpl } = makeFetch({
      generateResponse: (call) => call === 3
        ? new Response('runtime failure', { status: 503 })
        : streamResponse(successfulEvents()),
    })
    const result = await runBenchRunV1({ model: 'qwen3:8b', fetchImpl, timeoutMs: 1000 })
    expect(result.status).toBe('failed')
    expect(result.runs.map(run => `${run.phase}:${run.index}`)).toEqual(['warmup:1', 'measured:1', 'measured:2'])
    expect(result.aggregate.measured).toMatchObject({ planned: 5, attempted: 2, successful: 1, failed: 1, excluded: 3 })
    expect(result.exclusions.map(exclusion => exclusion.index)).toEqual([3, 4, 5])
  })

  it('keeps result digest stable when only timing changes', async () => {
    let generationCall = 0
    const makeTimedFetch = (): BenchFetch => async (input, init) => {
      const url = String(input)
      if (url === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
      generationCall += 1
      return streamResponse([
        { model: 'qwen3:8b', response: 'same result', done: false },
        { model: 'qwen3:8b', response: '', done: true, total_duration: generationCall, eval_count: 8, prompt_eval_count: 17 },
      ])
    }
    const first = await runBenchRunV1({ model: 'qwen3:8b', fetchImpl: makeTimedFetch(), timeoutMs: 1000 })
    generationCall = 100
    const second = await runBenchRunV1({ model: 'qwen3:8b', fetchImpl: makeTimedFetch(), timeoutMs: 1000 })
    expect(first.resultDigest).toBe(second.resultDigest)
  })

  it('does not expose quality, cost, ranking, or user-content fields', async () => {
    const result = await runBenchRunV1({ model: 'qwen3:8b', fetchImpl: makeFetch().fetchImpl, timeoutMs: 1000 })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('quality')
    expect(serialized).not.toContain('cost')
    expect(serialized).not.toContain('ranking')
    expect(serialized).not.toContain('top secret user prompt')
    expect(result).not.toHaveProperty('prompt')
    expect(result).not.toHaveProperty('response')
    expect(result).not.toHaveProperty('score')
  })
})
