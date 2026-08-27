import { describe, expect, it } from 'vitest'
import { discoverBenchModelsV1 } from '../src/bench/model-discovery-v1.js'
import { discoverOllamaModels, OLLAMA_TAGS_URL, type BenchFetch } from '../src/bench/ollama-local.js'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('bounded local Bench model discovery', () => {
  it('returns deduplicated executable Ollama model ids', async () => {
    const fetchImpl: BenchFetch = async input => {
      expect(String(input)).toBe(OLLAMA_TAGS_URL)
      return response({ models: [{ name: 'qwen3:8b' }, { name: 'qwen3:8b' }, { name: 'bad\u0000model' }, { name: 'llama3.2' }, { digest: 'not-a-model' }] })
    }
    const result = await discoverBenchModelsV1({ fetchImpl, now: () => new Date('2026-08-27T10:00:00.000Z') })
    expect(result).toMatchObject({
      schemaVersion: 'metrora.bench-model-discovery.v1',
      runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
      status: 'models-discovered',
      models: ['qwen3:8b', 'llama3.2'],
      checkedAt: '2026-08-27T10:00:00.000Z',
    })
    expect(result.detail).toContain('2 local Ollama models discovered.')
  })

  it('distinguishes a reachable runtime with no usable models', async () => {
    const result = await discoverOllamaModels({ fetchImpl: (async () => response({ models: [{ name: 'bad\u0000model' }, {}] })) as BenchFetch })
    expect(result).toEqual({ status: 'no-models', models: [], detail: 'Ollama is reachable but no usable local models were discovered.' })
  })

  it('treats HTTP and malformed discovery responses as unavailable without exposing response data', async () => {
    const httpFailure = await discoverOllamaModels({ fetchImpl: (async () => response({ error: 'secret provider detail' }, 503)) as BenchFetch })
    expect(httpFailure).toEqual({ status: 'unavailable', models: [], detail: 'Ollama local runtime is unavailable.' })
    expect(JSON.stringify(httpFailure)).not.toContain('secret')

    const malformed = await discoverOllamaModels({ fetchImpl: (async () => response({ models: 'not-an-array' })) as BenchFetch })
    expect(malformed).toEqual({ status: 'unavailable', models: [], detail: 'Ollama returned malformed model data.' })
  })
})
