import { metrora } from '../lib/ipc'
import { LocalAdvisorRuntime, type LocalAdvisorTransport } from './ollama'
import type { AdvisorModelCapabilityProfileV1, AdvisorRuntimeProbe } from './types'

export const LLAMA_SERVER_RUNTIME_ID = 'llama-server' as const
export const LLAMA_SERVER_DEFAULT_PORT = 8080

export function validLlamaServerPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65_535
}

function boundedPort(value: unknown): number {
  return validLlamaServerPort(value) ? value : LLAMA_SERVER_DEFAULT_PORT
}

export type LlamaServerTransport = LocalAdvisorTransport

function bridgeTransport(port: number): LlamaServerTransport {
  return {
    chat: (requestId, payload, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    return metrora.advisorChat(requestId, payload, LLAMA_SERVER_RUNTIME_ID, { port })
    },
    cancel: requestId => metrora.advisorCancel(requestId),
    onDelta: callback => metrora.onAdvisorDelta(callback),
  }
}

function profiles(models: string[]): AdvisorModelCapabilityProfileV1[] {
  return models.map(modelId => ({
    schemaVersion: 1,
    runtime: LLAMA_SERVER_RUNTIME_ID,
    modelId,
    discovery: 'discovered',
    conversational: 'available',
    toolCall: 'unknown',
    streaming: 'supported',
    limitation: 'Tool-call support depends on the loaded llama.cpp chat template and parser and has not been verified in this session.',
  }))
}

export async function probeLlamaServer(signal?: AbortSignal, port = LLAMA_SERVER_DEFAULT_PORT): Promise<AdvisorRuntimeProbe> {
  const selectedPort = boundedPort(port)
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  try {
    const result = await metrora.advisorProbe(LLAMA_SERVER_RUNTIME_ID, { port: selectedPort })
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    return result
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      runtime: LLAMA_SERVER_RUNTIME_ID,
      available: false,
      models: [],
      detail: 'Local llama-server is unavailable on loopback port ' + selectedPort + '.',
      discoveryState: 'runtime-unavailable',
      capabilities: [],
    }
  }
}

export class LlamaServerAdvisorRuntime extends LocalAdvisorRuntime {
  constructor(options: { model: string; port?: number; transport?: LlamaServerTransport; availability?: 'ready' | 'checking' | 'unavailable' }) {
    const port = boundedPort(options.port)
    super({
      id: 'llama-server-local',
      label: 'llama.cpp server:' + port + ' · ' + options.model,
      mode: 'llama-server-local',
      providerSupport: ['llama.cpp llama-server OpenAI-compatible local API'],
      model: options.model,
      transport: options.transport ?? bridgeTransport(port),
      availability: options.availability,
      unavailableMessage: 'Local llama-server model is not available.',
    })
  }
}

export { profiles as createLlamaServerCapabilityProfiles }
