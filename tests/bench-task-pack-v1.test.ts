import { describe, expect, it } from 'vitest'
import { CORE_TASK_PACK_V1 } from '../src/bench/task-pack-v1.js'
import { scoreBenchTaskV1 } from '../src/bench/scoring-v1.js'
import { OLLAMA_GENERATE_URL, OLLAMA_VERSION_URL, type BenchFetch } from '../src/bench/ollama-local.js'
import { runBenchTaskPackV1 } from '../src/bench/task-pack-run-v1.js'

const NL = String.fromCharCode(10)
function stream(output: string, model = 'qwen3:8b'): Response {
  return new Response(JSON.stringify({ model, response: output, done: false }) + NL + JSON.stringify({ model, response: '', done: true, eval_count: 4, prompt_eval_count: 8 }) + NL, { status: 200 })
}
function passingOutput(prompt: string): string {
  if (prompt.includes('single lowercase word')) return 'blue'
  if (prompt.includes('17 + 25')) return '42'
  if (prompt.includes('answer as the number')) return '{"answer":42,"unit":"items"}'
  if (prompt.includes('JSON object')) return '{"kind":"fixture","count":3}'
  if (prompt.includes('JSON array')) return '["alpha","beta","gamma"]'
  return 'READY'
}
function passFetch(): BenchFetch {
  return async (input, init) => {
    const url = String(input)
    if (url === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
    if (url !== OLLAMA_GENERATE_URL) return new Response('not found', { status: 404 })
    const body = JSON.parse(String(init?.body)) as { prompt: string }
    return stream(passingOutput(body.prompt))
  }
}

describe('deterministic Bench task pack v1', () => {
  it('has stable versioned identity and scores exact, normalized, numeric, JSON, and shape cases', () => {
    expect(CORE_TASK_PACK_V1.tasks).toHaveLength(6)
    expect(CORE_TASK_PACK_V1.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(scoreBenchTaskV1(CORE_TASK_PACK_V1.tasks[0]!, ' blue ' + NL).status).toBe('passed')
    expect(scoreBenchTaskV1(CORE_TASK_PACK_V1.tasks[1]!, '41').status).toBe('failed')
    expect(scoreBenchTaskV1(CORE_TASK_PACK_V1.tasks[2]!, '{bad').status).toBe('malformed')
    expect(scoreBenchTaskV1(CORE_TASK_PACK_V1.tasks[4]!, '{"answer":"42","unit":"items"}').status).toBe('failed')
    expect(scoreBenchTaskV1(CORE_TASK_PACK_V1.tasks[5]!, 'ready').status).toBe('passed')
  })

  it('runs every task and retains no prompt or response body', async () => {
    const result = await runBenchTaskPackV1({ model: 'qwen3:8b', fetchImpl: passFetch(), runId: 'pack-pass', timeoutMs: 1000 })
    expect(result.status).toBe('completed')
    expect(result.aggregate).toMatchObject({ planned: 6, attempted: 6, passed: 6, failed: 0, unavailable: 0 })
    expect(result.aggregate.score).toEqual({ numerator: 6, denominator: 6, value: 1 })
    expect(JSON.stringify(result)).not.toContain('single lowercase word')
    expect(JSON.stringify(result)).not.toContain('fixture","count')
    expect(result.tasks[0]?.outputDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('preserves preflight timeout semantics without fabricating a zero score', async () => {
    const timedOut = await runBenchTaskPackV1({ model: 'qwen3:8b', fetchImpl: async () => await new Promise<Response>(() => undefined), runId: 'pack-timeout', timeoutMs: 50 })
    expect(timedOut.status).toBe('unavailable')
    expect(timedOut.tasks.every(task => task.status === 'timeout')).toBe(true)
    expect(timedOut.aggregate.failed).toBe(0)
    expect(timedOut.aggregate.score.value).toBeNull()
  })

  it('preserves unavailable, cancellation, and missing-metric semantics', async () => {
    const unavailable = await runBenchTaskPackV1({ model: 'qwen3:8b', fetchImpl: async () => new Response('missing', { status: 404 }), runId: 'pack-unavailable', timeoutMs: 1000 })
    expect(unavailable.status).toBe('unavailable')
    expect(unavailable.aggregate.score.value).toBeNull()
    expect(unavailable.tasks.every(task => task.status === 'unavailable')).toBe(true)

    const controller = new AbortController()
    controller.abort()
    const cancelled = await runBenchTaskPackV1({ model: 'qwen3:8b', fetchImpl: passFetch(), signal: controller.signal, runId: 'pack-cancelled', timeoutMs: 1000 })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.aggregate.cancelled).toBe(6)

    const noMetrics = await runBenchTaskPackV1({ model: 'qwen3:8b', fetchImpl: async (input, init) => {
      if (String(input) === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
      const body = JSON.parse(String(init?.body)) as { prompt: string }
      return new Response(JSON.stringify({ model: 'qwen3:8b', response: passingOutput(body.prompt), done: true }) + NL, { status: 200 })
    }, runId: 'pack-no-metrics', timeoutMs: 1000 })
    expect(noMetrics.tasks[0]?.runtimeReported.evalCount).toBeNull()
  })
})
