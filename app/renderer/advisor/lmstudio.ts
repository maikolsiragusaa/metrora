import { metrora } from '../lib/ipc'
import { LocalAdvisorRuntime, type LocalAdvisorTransport } from './ollama'
import type { AdvisorModelCapabilityProfileV1, AdvisorRuntimeProbe } from './types'

export const LM_STUDIO_RUNTIME_ID = 'lmstudio' as const

export type LMStudioTransport = LocalAdvisorTransport

const bridgeTransport: LMStudioTransport = {
  chat: (requestId, payload, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    return metrora.advisorChat(requestId, payload, LM_STUDIO_RUNTIME_ID)
  },
  cancel: requestId => metrora.advisorCancel(requestId),
  onDelta: callback => metrora.onAdvisorDelta(callback),
}

function profiles(models: string[]): AdvisorModelCapabilityProfileV1[] {
  return models.map(modelId => ({
    schemaVersion: 1,
    runtime: LM_STUDIO_RUNTIME_ID,
    modelId,
    discovery: 'discovered',
    conversational: 'available',
    toolCall: 'unknown',
    streaming: 'supported',
    limitation: 'Tool support varies by model and has not been verified in this session.',
  }))
}

export async function probeLMStudio(signal?: AbortSignal): Promise<AdvisorRuntimeProbe> {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  try {
    const result = await metrora.advisorProbe(LM_STUDIO_RUNTIME_ID)
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    return result
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      runtime: LM_STUDIO_RUNTIME_ID,
      available: false,
      models: [],
      detail: 'Local LM Studio is unavailable.',
      discoveryState: 'runtime-unavailable',
      capabilities: [],
    }
  }
}

export class LMStudioAdvisorRuntime extends LocalAdvisorRuntime {
  constructor(options: { model: string; transport?: LMStudioTransport; availability?: 'ready' | 'checking' | 'unavailable' }) {
    super({
      id: 'lmstudio-local',
      label: 'LM Studio · ' + options.model,
      mode: 'lmstudio-local',
      providerSupport: ['LM Studio local server'],
      model: options.model,
      transport: options.transport ?? bridgeTransport,
      availability: options.availability,
      unavailableMessage: 'Local LM Studio model is not available.',
    })
  }
}

export { profiles as createLMStudioCapabilityProfiles }
