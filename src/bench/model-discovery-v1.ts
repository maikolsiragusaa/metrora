import { OLLAMA_LOCAL_BASE_URL, discoverOllamaModels, type BenchFetch } from './ollama-local.js'

export const BENCH_MODEL_DISCOVERY_SCHEMA_VERSION = 'metrora.bench-model-discovery.v1' as const
export const BENCH_MODEL_DISCOVERY_RUNTIME_ID = 'ollama-local' as const

export type BenchModelDiscoveryV1 = {
  schemaVersion: typeof BENCH_MODEL_DISCOVERY_SCHEMA_VERSION
  runtime: { id: typeof BENCH_MODEL_DISCOVERY_RUNTIME_ID; endpoint: typeof OLLAMA_LOCAL_BASE_URL }
  status: 'models-discovered' | 'no-models' | 'unavailable'
  models: string[]
  detail: string
  checkedAt: string
}

export async function discoverBenchModelsV1(options: {
  fetchImpl?: BenchFetch
  signal?: AbortSignal
  timeoutMs?: number
  now?: () => Date
} = {}): Promise<BenchModelDiscoveryV1> {
  const discovery = await discoverOllamaModels(options)
  return {
    schemaVersion: BENCH_MODEL_DISCOVERY_SCHEMA_VERSION,
    runtime: { id: BENCH_MODEL_DISCOVERY_RUNTIME_ID, endpoint: OLLAMA_LOCAL_BASE_URL },
    status: discovery.status,
    models: discovery.models,
    detail: discovery.detail,
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
  }
}
