import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { HostedAdvisorRuntime, probeHostedAdvisor } from '../advisor/hosted'
import type { AdvisorHostedProviderId } from '../advisor/types'
import { metrora } from '../lib/ipc'
import { createHostedProbeChecking, createHostedProbeFailure, presentHostedProbe, type AdvisorHostedProbePresentation, type AdvisorRuntimeChoice } from './AdvisorRuntimeControls'
import { AdvisorHostedOperationGuard, isSelectableHostedModel } from './advisor-hosted-operation-guard'
import { isAdvisorCancelled } from './useAdvisorLocalRuntime'

export type UseAdvisorHostedRuntimeOptions = {
  runtimeChoice: AdvisorRuntimeChoice
  invalidateAdvisorRequest: () => void
}

export type UseAdvisorHostedRuntimeResult = {
  hostedProvider: AdvisorHostedProviderId
  setHostedProvider: (value: AdvisorHostedProviderId) => void
  hostedModel: string | null
  setHostedModel: (value: string | null) => void
  hostedConsent: boolean
  setHostedConsent: (value: boolean) => void
  hostedProbe: AdvisorHostedProbePresentation
  hostedModelForRuntime: AdvisorHostedProbePresentation['models'][number] | null
  hostedRuntime: HostedAdvisorRuntime | null
  hostedSubmitBlockReason: string | null
  hostedOperationGuard: AdvisorHostedOperationGuard
  checkHostedRuntime: (requestedProvider?: AdvisorHostedProviderId, resetSelection?: boolean) => Promise<void>
}

export function useAdvisorHostedRuntime({ runtimeChoice, invalidateAdvisorRequest }: UseAdvisorHostedRuntimeOptions): UseAdvisorHostedRuntimeResult {
  const [hostedProvider, setHostedProvider] = useState<AdvisorHostedProviderId>('openai')
  const hostedOperationGuardRef = useRef(new AdvisorHostedOperationGuard(hostedProvider))
  const hostedOperationGuard = hostedOperationGuardRef.current
  const [hostedModel, setHostedModel] = useState<string | null>(null)
  const hostedModelRef = useRef<string | null>(null)
  hostedModelRef.current = hostedModel
  const [hostedConsent, setHostedConsent] = useState(false)
  const [hostedProbe, setHostedProbe] = useState<AdvisorHostedProbePresentation>(() => createHostedProbeChecking('openai'))
  const hostedModelForRuntime = hostedModel ? hostedProbe.models.find(model => model.id === hostedModel && isSelectableHostedModel(model)) ?? null : null
  const hostedRuntime = useMemo(() => hostedModelForRuntime ? new HostedAdvisorRuntime({ provider: hostedProvider, model: hostedModelForRuntime.id, capabilities: hostedModelForRuntime.capabilities, consent: hostedConsent }) : null, [hostedConsent, hostedModelForRuntime, hostedProvider])
  const hostedProbeController = useRef<AbortController | null>(null)

  const checkHostedRuntime = useCallback(async (requestedProvider: AdvisorHostedProviderId = hostedProvider, resetSelection = false) => {
    if (!hostedOperationGuard.isCurrentProvider(requestedProvider)) return
    invalidateAdvisorRequest()
    hostedProbeController.current?.abort()
    const requestId = hostedOperationGuard.startProbe(requestedProvider)
    if (requestId === null) return
    const controller = new AbortController()
    hostedProbeController.current = controller
    const isCurrentRequest = () => !controller.signal.aborted && hostedOperationGuard.isCurrentProbe(requestedProvider, requestId)
    setHostedProbe(current => createHostedProbeChecking(requestedProvider, current))
    try {
      const result = await probeHostedAdvisor(requestedProvider, controller.signal)
      if (!isCurrentRequest()) return
      setHostedProbe(presentHostedProbe(result))
      const selectable = result.models.find(isSelectableHostedModel)
      if (result.available && selectable) {
        const currentModel = resetSelection ? null : hostedModelRef.current
        const next = currentModel && result.models.some(model => model.id === currentModel && isSelectableHostedModel(model)) ? currentModel : selectable.id
        setHostedModel(next)
        if (next !== currentModel) setHostedConsent(false)
      } else {
        setHostedModel(null)
        setHostedConsent(false)
      }
    } catch (caught) {
      if (isCurrentRequest() && !isAdvisorCancelled(caught)) {
        setHostedModel(null)
        setHostedConsent(false)
        setHostedProbe(createHostedProbeFailure(requestedProvider))
      }
    }
  }, [hostedOperationGuard, hostedProvider, invalidateAdvisorRequest])

  useEffect(() => {
    if (runtimeChoice !== 'hosted') return
    void checkHostedRuntime()
    return () => hostedProbeController.current?.abort()
  }, [checkHostedRuntime, runtimeChoice])

  useEffect(() => {
    const subscribe = metrora.onAdvisorHostedEvent
    if (typeof subscribe !== 'function') return
    return subscribe(event => {
      if (event.provider !== hostedProvider) return
      setHostedProbe(current => {
        if (current.provider !== event.provider) return current
        const models = current.models.map(model => {
          if (model.id !== event.model) return model
          if (event.kind === 'completed') {
            return {
              ...model,
              state: 'verified' as const,
              limitation: 'A bounded Metrora Harness request completed successfully for this model.',
              capabilities: {
                conversational: 'available' as const,
                streaming: event.streamed ? 'supported' as const : model.capabilities?.streaming ?? 'unknown' as const,
                toolCall: model.capabilities?.toolCall ?? 'unknown' as const,
              },
            }
          }
          if (event.kind === 'failed' && ['response-malformed', 'tool-malformed', 'model-unavailable'].includes(event.code ?? '')) {
            return { ...model, state: 'failed-conformance' as const, limitation: 'The model failed a bounded Metrora Harness conformance request.' }
          }
          return model
        })
        if (models.every((model, index) => model === current.models[index])) return current
        return { ...current, available: true, models }
      })
    })
  }, [hostedProvider])

  const hostedSubmitBlockReason = runtimeChoice === 'hosted'
    ? !hostedRuntime
      ? hostedProbe.reachability === 'checking'
        ? 'Waiting for the hosted provider check to finish.'
        : 'Connect a hosted provider credential and select a usable model before sending a message.'
      : !hostedConsent
        ? 'Confirm the hosted-provider prompt and evidence sharing notice before sending.'
        : null
    : null

  return {
    hostedProvider,
    setHostedProvider,
    hostedModel,
    setHostedModel,
    hostedConsent,
    setHostedConsent,
    hostedProbe,
    hostedModelForRuntime,
    hostedRuntime,
    hostedSubmitBlockReason,
    hostedOperationGuard,
    checkHostedRuntime,
  }
}
