import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { metrora } from '../lib/ipc'
import { HostedAdvisorRuntime, probeHostedAdvisor } from '../advisor/hosted'
import { createAdvisorRuntime } from '../advisor/runtime'
import type { AdvisorHostedProviderId, AdvisorLocalRuntimeId, AdvisorReasoningEffort } from '../advisor/types'
import {
  createHostedProbeChecking,
  createHostedProbeFailure,
  presentHostedProbe,
  type HarnessHostedProbePresentation,
  type HarnessRuntimeChoice,
} from '../harness/HarnessRuntimePopover'
import { AdvisorHostedOperationGuard, isSelectableHostedModel } from './advisor-hosted-operation-guard'
import { isAdvisorCancelled, useAdvisorLocalRuntime } from './useAdvisorLocalRuntime'
import { loadHarnessRuntimeProfile, runtimeReasoningKey, saveHarnessRuntimeProfile, hostedConsentKey, type HarnessRuntimeProfile } from '../advisor/runtime-profile'

const DEFAULT_REASONING_EFFORTS: readonly AdvisorReasoningEffort[] = ['default']
const REASONING_EFFORT_STORAGE_KEY = 'metrora.harness.reasoning-effort'
const PERSISTED_REASONING_EFFORTS = new Set<AdvisorReasoningEffort>(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

function storedReasoningEffort(profile: HarnessRuntimeProfile, key: string): AdvisorReasoningEffort {
  const scoped = profile.reasoningEfforts[key]
  if (PERSISTED_REASONING_EFFORTS.has(scoped)) return scoped
  try {
    const value = window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY)
    return PERSISTED_REASONING_EFFORTS.has(value as AdvisorReasoningEffort) ? value as AdvisorReasoningEffort : 'default'
  } catch { return 'default' }
}

function storedScopedReasoningEffort(profile: HarnessRuntimeProfile, key: string): AdvisorReasoningEffort {
  const scoped = profile.reasoningEfforts[key]
  return PERSISTED_REASONING_EFFORTS.has(scoped) ? scoped : 'default'
}

type UseAdvisorRuntimeControllerOptions = {
  invalidateAdvisorRequest: () => void
  setNotice: (notice: string | null) => void
}

export function useAdvisorRuntimeController({ invalidateAdvisorRequest, setNotice }: UseAdvisorRuntimeControllerOptions) {
  const initialProfile = useMemo(() => loadHarnessRuntimeProfile(), [])
  const fallbackRuntime = useMemo(() => createAdvisorRuntime(), [])
  const [runtimeChoice, setRuntimeChoice] = useState<HarnessRuntimeChoice>(initialProfile.runtimeChoice)
  const [hostedProvider, setHostedProvider] = useState<AdvisorHostedProviderId>(initialProfile.hostedProvider)
  const hostedOperationGuardRef = useRef(new AdvisorHostedOperationGuard(hostedProvider))
  const initialHostedModel = initialProfile.hostedModels[initialProfile.hostedProvider] ?? null
  const [hostedModel, setHostedModel] = useState<string | null>(initialHostedModel)
  const hostedModelRef = useRef<string | null>(null)
  hostedModelRef.current = hostedModel
  const [hostedConsent, setHostedConsent] = useState(() => initialHostedModel ? initialProfile.hostedConsent[hostedConsentKey(initialProfile.hostedProvider, initialHostedModel)] === true : false)
  const initialReasoningKey = runtimeReasoningKey(
    initialProfile.runtimeChoice,
    initialProfile.hostedProvider,
    initialHostedModel,
    initialProfile.localRuntime,
    initialProfile.localModels[initialProfile.localRuntime] ?? null,
  )
  const [reasoningEffort, setReasoningEffort] = useState<AdvisorReasoningEffort>(() => storedReasoningEffort(initialProfile, initialReasoningKey))
  const [hostedProbe, setHostedProbe] = useState<HarnessHostedProbePresentation>(() => createHostedProbeChecking(initialProfile.hostedProvider))
  const hostedModelForRuntime = hostedModel ? hostedProbe.models.find(model => model.id === hostedModel && isSelectableHostedModel(model)) ?? null : null
  const hostedRuntime = useMemo(() => hostedModelForRuntime ? new HostedAdvisorRuntime({ provider: hostedProvider, model: hostedModelForRuntime.id, capabilities: hostedModelForRuntime.capabilities, reasoningEffort, consent: hostedConsent }) : null, [hostedConsent, hostedModelForRuntime, hostedProvider, reasoningEffort])
  const markHostedModelVerified = useCallback((provider: AdvisorHostedProviderId, model: string) => {
    if (!hostedOperationGuardRef.current.isCurrentProvider(provider) || hostedModelRef.current !== model) return
    setHostedProbe(current => current.provider !== provider ? current : {
      ...current,
      models: current.models.map(item => item.id === model && item.state !== 'unsupported' && item.state !== 'failed-conformance'
        ? {
            ...item,
            state: 'verified',
            limitation: 'This exact model passed a bounded Metrora Harness request; deterministic evidence retrieval remains authoritative.',
          }
        : item),
    })
  }, [])
  const [configureOpen, setConfigureOpen] = useState(false)
  const { runtimeId, setRuntimeId, runtimeModel, setRuntimeModel, runtimeState, llamaServerPort, localRuntime, checkLocalRuntime, setLocalModel, setLlamaServerPort } = useAdvisorLocalRuntime()
  const activeRuntime = runtimeChoice === 'hosted'
    ? hostedRuntime ?? fallbackRuntime
    : localRuntime ?? fallbackRuntime
  const reasoningEfforts = activeRuntime.reasoningEfforts ?? DEFAULT_REASONING_EFFORTS
  const effectiveReasoningEffort = reasoningEfforts.includes(reasoningEffort) ? reasoningEffort : 'default'
  const selectedReasoningKey = runtimeReasoningKey(runtimeChoice, hostedProvider, hostedModel, runtimeId, runtimeModel)
  const reasoningKeyRef = useRef(selectedReasoningKey)
  const reasoningKeyChangingRef = useRef(false)
  useEffect(() => {
    if (reasoningKeyRef.current === selectedReasoningKey) return
    reasoningKeyChangingRef.current = true
    reasoningKeyRef.current = selectedReasoningKey
    setReasoningEffort(storedScopedReasoningEffort(loadHarnessRuntimeProfile(), selectedReasoningKey))
  }, [selectedReasoningKey])
  useEffect(() => {
    if (reasoningKeyChangingRef.current) {
      reasoningKeyChangingRef.current = false
      return
    }
    const current = loadHarnessRuntimeProfile()
    const hostedModels = hostedModel
      ? { ...current.hostedModels, [hostedProvider]: hostedModel }
      : current.hostedModels
    const localModels = runtimeModel
      ? { ...current.localModels, [runtimeId]: runtimeModel }
      : current.localModels
    saveHarnessRuntimeProfile({
      ...current,
      runtimeChoice,
      localRuntime: runtimeId,
      hostedProvider,
      hostedModels,
      localModels,
      llamaServerPort,
      reasoningEfforts: { ...current.reasoningEfforts, [selectedReasoningKey]: effectiveReasoningEffort },
      hostedConsent: hostedModel
        ? { ...current.hostedConsent, [hostedConsentKey(hostedProvider, hostedModel)]: hostedConsent }
        : current.hostedConsent,
    })
  }, [effectiveReasoningEffort, hostedConsent, hostedModel, hostedProvider, llamaServerPort, runtimeChoice, runtimeId, runtimeModel, selectedReasoningKey])
  useEffect(() => {
    try { window.localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, reasoningEffort) } catch { /* unavailable in restricted contexts */ }
  }, [reasoningEffort])
  const hostedProbeController = useRef<AbortController | null>(null)
  const checkHostedRuntime = useCallback(async (requestedProvider: AdvisorHostedProviderId = hostedProvider, resetSelection = false) => {
    if (!hostedOperationGuardRef.current.isCurrentProvider(requestedProvider)) return
    invalidateAdvisorRequest()
    hostedProbeController.current?.abort()
    const requestId = hostedOperationGuardRef.current.startProbe(requestedProvider)
    if (requestId === null) return
    const controller = new AbortController()
    hostedProbeController.current = controller
    const isCurrentRequest = () => !controller.signal.aborted && hostedOperationGuardRef.current.isCurrentProbe(requestedProvider, requestId)
    setHostedProbe(current => createHostedProbeChecking(requestedProvider, current))
    try {
      const result = await probeHostedAdvisor(requestedProvider, controller.signal)
      if (!isCurrentRequest()) return
      setHostedProbe(presentHostedProbe(result))
      const selectable = result.models.find(isSelectableHostedModel)
      if (result.available && selectable) {
        const savedProfile = loadHarnessRuntimeProfile()
        const savedModel = savedProfile.hostedModels[requestedProvider] ?? null
        const currentModel = resetSelection ? null : hostedModelRef.current
        const next = currentModel && result.models.some(model => model.id === currentModel && isSelectableHostedModel(model))
          ? currentModel
          : savedModel && result.models.some(model => model.id === savedModel && isSelectableHostedModel(model))
            ? savedModel
            : selectable.id
        setHostedModel(next)
        setHostedConsent(savedProfile.hostedConsent[hostedConsentKey(requestedProvider, next)] === true)
        setReasoningEffort(storedScopedReasoningEffort(savedProfile, runtimeReasoningKey('hosted', requestedProvider, next, runtimeId, runtimeModel)))
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
  }, [hostedProvider, invalidateAdvisorRequest])
  useEffect(() => {
    if (runtimeChoice !== 'hosted') return
    void checkHostedRuntime()
    return () => hostedProbeController.current?.abort()
  }, [checkHostedRuntime, runtimeChoice])
  const hostedConfigRef = useRef({ runtimeChoice, hostedRuntime, hostedConsent })
  hostedConfigRef.current = { runtimeChoice, hostedRuntime, hostedConsent }
  const hostedSubmitBlockReason = runtimeChoice === 'hosted'
    ? !hostedRuntime
      ? hostedProbe.reachability === 'checking'
        ? 'Waiting for the hosted provider check to finish.'
        : 'Connect a hosted provider credential and select a usable model before sending a message.'
      : !hostedConsent
        ? 'Confirm the hosted-provider prompt and evidence sharing notice before sending.'
        : null
    : null
  const [credentialEntry, setCredentialEntry] = useState('')
  const [credentialSaving, setCredentialSaving] = useState(false)
  useEffect(() => { setCredentialEntry('') }, [hostedProvider])

  const activateHosted = () => {
    invalidateAdvisorRequest()
    setRuntimeChoice('hosted')
    const profile = loadHarnessRuntimeProfile()
    setHostedConsent(hostedModel ? profile.hostedConsent[hostedConsentKey(hostedProvider, hostedModel)] === true : false)
    setReasoningEffort(storedScopedReasoningEffort(profile, runtimeReasoningKey('hosted', hostedProvider, hostedModel, runtimeId, runtimeModel)))
    void checkHostedRuntime()
  }
  const activateLocal = () => {
    invalidateAdvisorRequest()
    setRuntimeChoice(runtimeId)
    setHostedConsent(false)
  }
  const updateHostedConsent = (consent: boolean) => {
    invalidateAdvisorRequest()
    setHostedConsent(consent)
  }
  const updateReasoningEffort = (effort: AdvisorReasoningEffort) => {
    if (!reasoningEfforts.includes(effort)) return
    invalidateAdvisorRequest()
    setReasoningEffort(effort)
  }
  const updateHostedProvider = (next: AdvisorHostedProviderId) => {
    const profile = loadHarnessRuntimeProfile()
    const savedModel = profile.hostedModels[next] ?? null
    invalidateAdvisorRequest()
    hostedOperationGuardRef.current.setProvider(next)
    hostedProbeController.current?.abort()
    setHostedProvider(next)
    setHostedModel(null)
    setHostedConsent(savedModel ? profile.hostedConsent[hostedConsentKey(next, savedModel)] === true : false)
    setReasoningEffort(storedScopedReasoningEffort(profile, runtimeReasoningKey('hosted', next, savedModel, runtimeId, runtimeModel)))
    setCredentialSaving(false)
    void checkHostedRuntime(next, true)
  }
  const updateHostedModel = (model: string) => {
    const profile = loadHarnessRuntimeProfile()
    invalidateAdvisorRequest()
    setHostedModel(model)
    setHostedConsent(profile.hostedConsent[hostedConsentKey(hostedProvider, model)] === true)
    setReasoningEffort(storedScopedReasoningEffort(profile, runtimeReasoningKey('hosted', hostedProvider, model, runtimeId, runtimeModel)))
  }
  const updateLocalRuntime = (next: AdvisorLocalRuntimeId) => {
    const profile = loadHarnessRuntimeProfile()
    const savedModel = profile.localModels[next] ?? null
    invalidateAdvisorRequest()
    setRuntimeId(next)
    setRuntimeModel(null)
    setHostedConsent(false)
    setReasoningEffort(storedScopedReasoningEffort(profile, runtimeReasoningKey(next, hostedProvider, hostedModel, next, savedModel)))
    void checkLocalRuntime(next)
  }
  const updateLocalModel = (model: string) => {
    const profile = loadHarnessRuntimeProfile()
    invalidateAdvisorRequest()
    setLocalModel(model)
    setReasoningEffort(storedScopedReasoningEffort(profile, runtimeReasoningKey(runtimeChoice, hostedProvider, hostedModel, runtimeId, model)))
  }
  const saveHostedCredential = async () => {
    if (!credentialEntry.trim() || credentialSaving) return
    const requestedProvider = hostedProvider
    const operationId = hostedOperationGuardRef.current.startCredential(requestedProvider)
    if (operationId === null) return
    setCredentialSaving(true)
    try {
      const status = await metrora.advisorCredentialSet(requestedProvider, credentialEntry)
      if (!hostedOperationGuardRef.current.isCurrentCredential(requestedProvider, operationId)) return
      invalidateAdvisorRequest()
      setNotice(status.state === 'ready' ? 'Provider credential saved in protected local storage.' : 'Provider credential was not saved: ' + status.state + '.')
      await checkHostedRuntime(requestedProvider)
    } catch {
      if (hostedOperationGuardRef.current.isCurrentCredential(requestedProvider, operationId)) setNotice('Provider credential could not be saved. Enter it again.')
    } finally {
      if (hostedOperationGuardRef.current.isCurrentCredential(requestedProvider, operationId)) {
        setCredentialEntry('')
        setCredentialSaving(false)
      }
    }
  }
  const clearHostedCredential = async () => {
    const requestedProvider = hostedProvider
    const operationId = hostedOperationGuardRef.current.startCredential(requestedProvider)
    if (operationId === null) return
    try {
      await metrora.advisorCredentialClear(requestedProvider)
      if (!hostedOperationGuardRef.current.isCurrentCredential(requestedProvider, operationId)) return
      invalidateAdvisorRequest()
      setHostedConsent(false)
      setNotice('Provider credential removed from this device.')
      await checkHostedRuntime(requestedProvider)
    } catch {
      if (hostedOperationGuardRef.current.isCurrentCredential(requestedProvider, operationId)) setNotice('Provider credential could not be removed.')
    }
  }
  const runtimeControls = {
    runtimeChoice,
    runtimeId,
    runtimeModel,
    llamaServerPort,
    runtimeState,
    hostedProvider,
    hostedModel,
    hostedProbe,
    hostedConsent,
    reasoningEffort: effectiveReasoningEffort,
    reasoningEfforts,
    hasHostedRuntime: Boolean(hostedRuntime),
    configureOpen,
    credentialEntry,
    credentialSaving,
    onToggleConfigure: () => setConfigureOpen(current => !current),
    onCheckHostedRuntime: () => void checkHostedRuntime(),
    onActivateLocal: activateLocal,
    onHostedProviderChange: updateHostedProvider,
    onHostedModelChange: updateHostedModel,
    onHostedConsentChange: updateHostedConsent,
    onReasoningEffortChange: updateReasoningEffort,
    onCredentialEntryChange: setCredentialEntry,
    onSaveHostedCredential: () => void saveHostedCredential(),
    onClearHostedCredential: () => void clearHostedCredential(),
    onCheckLocalRuntime: () => void checkLocalRuntime(),
    onLlamaServerPortChange: setLlamaServerPort,
    onActivateHosted: activateHosted,
    onLocalRuntimeChange: updateLocalRuntime,
    onLocalModelChange: updateLocalModel,
  }

  return {
    activeRuntime,
    runtimeChoice,
    hostedProvider,
    hostedModel,
    hostedModelForRuntime,
    hostedRuntime,
    hostedConsent,
    hostedConfigRef,
    hostedSubmitBlockReason,
    runtimeId,
    runtimeModel,
    runtimeState,
    setRuntimeModel,
    setLlamaServerPort,
    reasoningEffort,
    reasoningEfforts,
    effectiveReasoningEffort,
    checkHostedRuntime,
    checkLocalRuntime,
    markHostedModelVerified,
    runtimeControls,
    activateHosted,
    activateLocal,
    updateHostedProvider,
    updateHostedModel,
    updateHostedConsent,
    updateReasoningEffort,
    updateLocalRuntime,
    updateLocalModel,
  }
}
