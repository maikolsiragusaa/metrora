import { useCallback, useEffect, useRef, useState } from 'react'

import { LMStudioAdvisorRuntime, probeLMStudio } from '../advisor/lmstudio'
import { OllamaAdvisorRuntime, probeOllama } from '../advisor/ollama'
import { LlamaServerAdvisorRuntime, probeLlamaServer } from '../advisor/llama-server'
import type { AdvisorLocalRuntimeId } from '../advisor/types'
import { LLAMA_SERVER_DEFAULT_PORT, validLlamaServerPort } from '../advisor/llama-server'
import type { AdvisorRuntimeState } from './AdvisorRuntimeControls'

type LocalRuntimeInstance = OllamaAdvisorRuntime | LMStudioAdvisorRuntime | LlamaServerAdvisorRuntime

function runtimeName(runtime: AdvisorLocalRuntimeId): string {
  if (runtime === 'lmstudio') return 'LM Studio'
  if (runtime === 'llama-server') return 'llama.cpp server'
  return 'Ollama'
}

function createLocalRuntime(runtime: AdvisorLocalRuntimeId, model: string, llamaServerPort: number): LocalRuntimeInstance {
  if (runtime === 'lmstudio') return new LMStudioAdvisorRuntime({ model, availability: 'ready' })
  if (runtime === 'llama-server') return new LlamaServerAdvisorRuntime({ model, port: llamaServerPort, availability: 'ready' })
  return new OllamaAdvisorRuntime({ model, availability: 'ready' })
}

export function isAdvisorCancelled(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError' || error.name === 'AdvisorCancelledError' || /cancel|abort/i.test(error.message)
  if (error && typeof error === 'object') {
    const item = error as { kind?: unknown; message?: unknown }
    return item.kind === 'cancelled' || (typeof item.message === 'string' && /cancel|abort/i.test(item.message))
  }
  return false
}

export function useAdvisorLocalRuntime(): {
  runtimeId: AdvisorLocalRuntimeId
  setRuntimeId: (value: AdvisorLocalRuntimeId) => void
  runtimeModel: string | null
  setRuntimeModel: (value: string | null) => void
  runtimeState: AdvisorRuntimeState
  llamaServerPort: number
  localRuntime: LocalRuntimeInstance | null
  checkLocalRuntime: (requestedRuntime?: AdvisorLocalRuntimeId) => Promise<void>
  setLocalModel: (model: string) => void
  setLlamaServerPort: (value: number) => void
} {
  const [runtimeId, setRuntimeId] = useState<AdvisorLocalRuntimeId>('ollama')
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null)
  const [llamaServerPort, setLlamaServerPortState] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem('metrora.llama-server.port'))
      return validLlamaServerPort(stored) ? stored : LLAMA_SERVER_DEFAULT_PORT
    } catch { return LLAMA_SERVER_DEFAULT_PORT }
  })
  const [runtimeState, setRuntimeState] = useState<AdvisorRuntimeState>({ runtime: 'ollama', status: 'checking', detail: 'Checking for a local Ollama model…', models: [], modelLabels: {}, modelState: 'unavailable', toolCall: 'unknown' })
  const [localRuntime, setLocalRuntime] = useState<LocalRuntimeInstance | null>(null)
  const probeController = useRef<AbortController | null>(null)

  const checkLocalRuntime = useCallback(async (requestedRuntime: AdvisorLocalRuntimeId = runtimeId) => {
    probeController.current?.abort()
    const controller = new AbortController()
    probeController.current = controller
    setRuntimeState({ runtime: requestedRuntime, status: 'checking', detail: 'Checking for a local ' + runtimeName(requestedRuntime) + ' model…', models: [], modelLabels: {}, modelState: 'unavailable', toolCall: 'unknown' })
    try {
      const result = requestedRuntime === 'lmstudio'
        ? await probeLMStudio(controller.signal)
        : requestedRuntime === 'llama-server'
          ? await probeLlamaServer(controller.signal, llamaServerPort)
          : await probeOllama(controller.signal)
      if (controller.signal.aborted) return
      if (result.available && result.models[0]) {
        const selected = runtimeModel && result.models.includes(runtimeModel) ? runtimeModel : result.models[0]
        setRuntimeModel(selected)
        setLocalRuntime(createLocalRuntime(requestedRuntime, selected, llamaServerPort))
        const capabilityProfiles = (result as { capabilities?: Array<{ modelId: string; toolCall: AdvisorRuntimeState['toolCall'] }> }).capabilities ?? []
        const capability = capabilityProfiles.find(profile => profile.modelId === selected)
        setRuntimeState({ runtime: requestedRuntime, status: 'ready', detail: result.detail, models: result.models, modelLabels: result.modelLabels ?? {}, modelState: 'discovered', toolCall: capability?.toolCall ?? 'unknown' })
      } else {
        setRuntimeModel(null)
        setLocalRuntime(null)
        setRuntimeState({ runtime: requestedRuntime, status: 'unavailable', detail: result.detail, models: [], modelLabels: {}, modelState: 'unavailable', toolCall: 'unknown' })
      }
    } catch (error) {
      if (!isAdvisorCancelled(error)) setRuntimeState({ runtime: requestedRuntime, status: 'unavailable', detail: 'Local runtime probe was cancelled or failed.', models: [], modelLabels: {}, modelState: 'unavailable', toolCall: 'unknown' })
    }
  }, [llamaServerPort, runtimeId, runtimeModel])

  useEffect(() => {
    void checkLocalRuntime()
    return () => probeController.current?.abort()
  }, [checkLocalRuntime])

  const setLocalModel = useCallback((model: string) => {
    setRuntimeModel(model)
    setLocalRuntime(createLocalRuntime(runtimeId, model, llamaServerPort))
  }, [llamaServerPort, runtimeId])

  const setLlamaServerPort = useCallback((value: number) => {
    if (!validLlamaServerPort(value)) return
    setLlamaServerPortState(value)
    try { window.localStorage.setItem('metrora.llama-server.port', String(value)) } catch { /* unavailable in restricted contexts */ }
  }, [])

  return { runtimeId, setRuntimeId, runtimeModel, setRuntimeModel, runtimeState, llamaServerPort, localRuntime, checkLocalRuntime, setLocalModel, setLlamaServerPort }
}
