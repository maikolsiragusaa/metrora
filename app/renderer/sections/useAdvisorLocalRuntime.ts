import { useCallback, useEffect, useRef, useState } from 'react'

import { LMStudioAdvisorRuntime, probeLMStudio } from '../advisor/lmstudio'
import { OllamaAdvisorRuntime, probeOllama } from '../advisor/ollama'
import { LLAMA_SERVER_DEFAULT_PORT, LlamaServerAdvisorRuntime, probeLlamaServer, validLlamaServerPort } from '../advisor/llama-server'
import type { AdvisorLocalRuntimeId } from '../advisor/types'
import type { HarnessRuntimeState } from '../harness/HarnessRuntimePopover'
import { loadHarnessRuntimeProfile } from '../advisor/runtime-profile'

type LocalRuntimeInstance = OllamaAdvisorRuntime | LMStudioAdvisorRuntime | LlamaServerAdvisorRuntime

function runtimeName(runtime: AdvisorLocalRuntimeId): string {
  if (runtime === 'lmstudio') return 'LM Studio'
  if (runtime === 'llama-server') return 'llama.cpp server'
  return 'Ollama'
}

function createLocalRuntime(runtime: AdvisorLocalRuntimeId, model: string, llamaServerPort: number, nativeToolCalls = false): LocalRuntimeInstance {
  if (runtime === 'lmstudio') return new LMStudioAdvisorRuntime({ model, availability: 'ready', nativeToolCalls })
  if (runtime === 'llama-server') return new LlamaServerAdvisorRuntime({ model, port: llamaServerPort, availability: 'ready', nativeToolCalls })
  return new OllamaAdvisorRuntime({ model, availability: 'ready', nativeToolCalls })
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
  runtimeState: HarnessRuntimeState
  llamaServerPort: number
  localRuntime: LocalRuntimeInstance | null
  checkLocalRuntime: (requestedRuntime?: AdvisorLocalRuntimeId) => Promise<void>
  setLocalModel: (model: string) => void
  setLlamaServerPort: (value: number) => void
} {
  const [runtimeId, setRuntimeId] = useState<AdvisorLocalRuntimeId>(() => loadHarnessRuntimeProfile().localRuntime)
  const [runtimeModel, setRuntimeModel] = useState<string | null>(() => {
    const profile = loadHarnessRuntimeProfile()
    return profile.localModels[profile.localRuntime] ?? null
  })
  const [llamaServerPort, setLlamaServerPortState] = useState<number>(() => {
    const stored = loadHarnessRuntimeProfile().llamaServerPort
    return validLlamaServerPort(stored) ? stored : LLAMA_SERVER_DEFAULT_PORT
  })
  const [runtimeState, setRuntimeState] = useState<HarnessRuntimeState>(() => {
    const initialRuntime = loadHarnessRuntimeProfile().localRuntime
    return { runtime: initialRuntime, status: 'checking', detail: 'Checking for a local ' + runtimeName(initialRuntime) + ' model…', models: [], modelLabels: {}, modelState: 'unavailable', toolCall: 'unknown' }
  })
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
        const storedModel = loadHarnessRuntimeProfile().localModels[requestedRuntime]
        const currentModel = requestedRuntime === runtimeId ? runtimeModel : null
        const selected = currentModel && result.models.includes(currentModel)
          ? currentModel
          : storedModel && result.models.includes(storedModel)
            ? storedModel
            : result.models[0]
        const capabilityProfiles = (result as { capabilities?: Array<{ modelId: string; toolCall: HarnessRuntimeState['toolCall'] }> }).capabilities ?? []
        const capability = capabilityProfiles.find(profile => profile.modelId === selected)
        setRuntimeModel(selected)
        setLocalRuntime(createLocalRuntime(requestedRuntime, selected, llamaServerPort, capability?.toolCall === 'supported'))
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
    // Manual model selection is not evidence that this model supports native
    // Tool calls. Keep the safe structured fallback until discovery/conformance
    // provides an exact positive capability.
    setLocalRuntime(createLocalRuntime(runtimeId, model, llamaServerPort, false))
  }, [llamaServerPort, runtimeId])

  const setLlamaServerPort = useCallback((value: number) => {
    if (!validLlamaServerPort(value)) return
    setLlamaServerPortState(value)
    if (runtimeId === 'llama-server') {
      // Do not let a runtime instance connected to the previous port remain
      // selectable while the new endpoint is being probed.
      setLocalRuntime(null)
      setRuntimeModel(null)
      setRuntimeState(current => ({
        ...current,
        runtime: 'llama-server',
        status: 'checking',
        detail: 'Checking llama.cpp server on port ' + value + '…',
        models: [],
        modelLabels: {},
        modelState: 'unavailable',
        toolCall: 'unknown',
      }))
    }
  }, [runtimeId])

  return { runtimeId, setRuntimeId, runtimeModel, setRuntimeModel, runtimeState, llamaServerPort, localRuntime, checkLocalRuntime, setLocalModel, setLlamaServerPort }
}
