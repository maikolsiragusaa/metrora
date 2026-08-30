import { metrora } from '../lib/ipc'
import { LocalAdvisorRuntime, type LocalAdvisorTransport } from './ollama'
import type { AdvisorModelCapabilityProfileV1, AdvisorRuntimeProbe } from './types'

export const LLAMA_SERVER_RUNTIME_ID = 'llama-server' as const

export type LlamaServerTransport = LocalAdvisorTransport

const bridgeTransport: LlamaServerTransport = {
  chat: (requestId, payload, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    return metrora.advisorChat(requestId, payload, LLAMA_SERVER_RUNTIME_ID)
  },
  cancel: requestId => metrora.advisorCancel(requestId),
  onDelta: callback => metrora.onAdvisorDelta(callback),
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

export async function probeLlamaServer(signal?: AbortSignal): Promise<AdvisorRuntimeProbe> {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  try {
    const result = await metrora.advisorProbe(LLAMA_SERVER_RUNTIME_ID)
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    return result
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      runtime: LLAMA_SERVER_RUNTIME_ID,
      available: false,
      models: [],
      detail: 'Local llama-server is unavailable on loopback port 8080.',
      discoveryState: 'runtime-unavailable',
      capabilities: [],
    }
  }
}

export class LlamaServerAdvisorRuntime extends LocalAdvisorRuntime {
  constructor(options: { model: string; transport?: LlamaServerTransport; availability?: 'ready' | 'checking' | 'unavailable' }) {
    super({
      id: 'llama-server-local',
      label: 'llama.cpp server · ' + options.model,
      mode: 'llama-server-local',
      providerSupport: ['llama.cpp llama-server OpenAI-compatible local API'],
      model: options.model,
      transport: options.transport ?? bridgeTransport,
      availability: options.availability,
      unavailableMessage: 'Local llama-server model is not available.',
    })
  }
}

export { profiles as createLlamaServerCapabilityProfiles }
