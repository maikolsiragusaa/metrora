import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import { createAdvisorDataSource } from '../advisor/source'
import { createAdvisorKernel } from '../advisor/kernel'
import { createAdvisorRuntime } from '../advisor/runtime'
import { HostedAdvisorRuntime, probeHostedAdvisor } from '../advisor/hosted'
import { periodLabel, scopeLabel } from '../advisor/evidence'
import { advisorContextualSurfaceLabel, advisorScopeFromContextualLaunch, normalizeAdvisorContextualLaunch, type AdvisorContextualLaunchV1, type AdvisorContextualScopeMode } from '../advisor/context'
import { advisorScopeFingerprint, type AdvisorConversationTurn, type AdvisorHostedProviderId, type AdvisorLocalRuntimeId, type AdvisorScope } from '../advisor/types'
import { createHostedProbeChecking, createHostedProbeFailure, presentHostedProbe, type HarnessHostedProbePresentation, type HarnessRuntimeChoice } from '../harness/HarnessRuntimePopover'
import { AdvisorHostedOperationGuard, isSelectableHostedModel } from './advisor-hosted-operation-guard'
import { harnessToolLabel, type HarnessToolActivity } from '../harness/HarnessWorkTrace'
import { HarnessSurface } from '../harness/HarnessSurface'
import { isSwarmExperimentalEnabled } from '../swarm/feature-gate'
import { useSwarmRun } from '../swarm/useSwarmRun'
import { isAdvisorCancelled, useAdvisorLocalRuntime } from './useAdvisorLocalRuntime'
import { useHarnessConversationState, type AdvisorConversation, type AdvisorMessage } from './useHarnessConversationState'
type DetectedProvider = { id: string; label: string }; type AdvisorFailedRequest = { question: string; scope: AdvisorScope; conversationId: string; conversation: AdvisorConversationTurn[] }
function makeId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}
function providerLabel(provider: string): string {
  if (provider === 'all') return 'All providers'
  return provider.split(/[-\s]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
function contextualScopeLabel(scope: AdvisorScope, mode: AdvisorContextualScopeMode | null): string {
  if (mode === 'capacity') return 'Provider-reported current capacity · All providers'
  if (mode === 'compare') return `Compare page scope · ${periodLabel(scope)} · ${providerLabel(scope.provider)}`
  return scopeLabel(scope)
}
export function Advisor({
  period,
  provider,
  projectScopeId = 'all',
  range = null,
  overview,
  detectedProviders,
  contextualLaunch = null,
}: {
  period: Period
  provider: string
  projectScopeId?: string
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  detectedProviders: DetectedProvider[]
  contextualLaunch?: AdvisorContextualLaunchV1 | null
}) {
  const projectOptions = overview.data?.projectScope?.options ?? []
  const projectName = projectScopeId === 'all'
    ? 'All projects'
    : projectOptions.find(option => option.id === projectScopeId)?.name ?? projectScopeId
  const modelOptions = [...new Set([
    ...(overview.data?.current.modelAccounting?.rows.map(row => row.name) ?? []),
    ...(overview.data?.current.topModels.map(row => row.name) ?? []),
  ])].filter(Boolean).slice(0, 40)
  const providerOptions = [{ id: 'all', label: 'All providers' }, ...detectedProviders.filter(item => item.id !== 'all')]
  const normalizedContextualLaunch = useMemo(
    () => contextualLaunch ? normalizeAdvisorContextualLaunch(contextualLaunch) : null,
    [contextualLaunch],
  )
  const contextualScope = useMemo(
    () => normalizedContextualLaunch ? advisorScopeFromContextualLaunch(normalizedContextualLaunch) : null,
    [normalizedContextualLaunch],
  )
  const contextualScopeMode = normalizedContextualLaunch?.scopeMode ?? null
  const [scope, setScope] = useState<AdvisorScope>(() => contextualScope ?? ({
    period,
    range,
    provider,
    projectId: projectScopeId,
    projectName,
    model: null,
  }))
  useEffect(() => {
    if (normalizedContextualLaunch) return
    setScope(current => ({ ...current, period, range, provider, projectId: projectScopeId, projectName }))
  }, [normalizedContextualLaunch, period, provider, projectScopeId, projectName, range])
  useEffect(() => {
    if (scope.model && !modelOptions.includes(scope.model)) setScope(current => ({ ...current, model: null }))
  }, [modelOptions, scope.model])
  const source = useMemo(() => createAdvisorDataSource(metrora), [])
  const fallbackRuntime = useMemo(() => createAdvisorRuntime(), [])
  const [runtimeChoice, setRuntimeChoice] = useState<HarnessRuntimeChoice>('ollama')
  const [hostedProvider, setHostedProvider] = useState<AdvisorHostedProviderId>('openai')
  const hostedOperationGuardRef = useRef(new AdvisorHostedOperationGuard(hostedProvider))
  const [hostedModel, setHostedModel] = useState<string | null>(null)
  const hostedModelRef = useRef<string | null>(null)
  hostedModelRef.current = hostedModel
  const [hostedConsent, setHostedConsent] = useState(false)
  const [hostedProbe, setHostedProbe] = useState<HarnessHostedProbePresentation>(() => createHostedProbeChecking('openai'))
  const hostedModelForRuntime = hostedModel ? hostedProbe.models.find(model => model.id === hostedModel && isSelectableHostedModel(model)) ?? null : null
  const hostedRuntime = useMemo(() => hostedModelForRuntime ? new HostedAdvisorRuntime({ provider: hostedProvider, model: hostedModelForRuntime.id, capabilities: hostedModelForRuntime.capabilities, consent: hostedConsent }) : null, [hostedConsent, hostedModelForRuntime, hostedProvider])
  const [configureOpen, setConfigureOpen] = useState(false)
  const { runtimeId, setRuntimeId, runtimeModel, setRuntimeModel, runtimeState, localRuntime, checkLocalRuntime, setLocalModel } = useAdvisorLocalRuntime()
  const activeRuntime = runtimeChoice === 'hosted'
    ? hostedRuntime ?? fallbackRuntime
    : localRuntime ?? fallbackRuntime
  const kernel = useMemo(() => createAdvisorKernel(source, activeRuntime), [activeRuntime, source])
  const swarmExperimentalEnabled = isSwarmExperimentalEnabled()
  const [mode, setMode] = useState<'chat' | 'swarm'>('chat')
  const [swarmConversationId, setSwarmConversationId] = useState<string | null>(null)
  const swarm = useSwarmRun({
    source,
    runtime: activeRuntime,
    scope,
    overview: !overview.loading && !overview.switching ? overview.data ?? null : null,
    modelId: runtimeChoice === 'hosted' ? hostedModel ?? activeRuntime.id : runtimeModel ?? activeRuntime.id,
    modelLabel: runtimeChoice === 'hosted' ? hostedModelForRuntime?.label ?? activeRuntime.label : runtimeModel ?? activeRuntime.label,
    enabled: swarmExperimentalEnabled,
  })
  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null)
  const [streamPreview, setStreamPreview] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [toolActivity, setToolActivity] = useState<HarnessToolActivity[]>([])
  const requestController = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)
  const invalidateAdvisorRequest = useCallback(() => {
    requestGenerationRef.current += 1
    requestController.current?.abort()
    requestController.current = null
    setLoadingQuestion(null)
    setStreamPreview('')
    setToolStatus(null)
    setToolActivity([])
  }, [])
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
  }, [hostedProvider, invalidateAdvisorRequest])
  useEffect(() => {
    if (runtimeChoice !== 'hosted') return
    void checkHostedRuntime()
    return () => hostedProbeController.current?.abort()
  }, [checkHostedRuntime, runtimeChoice])
  const [historyQuery, setHistoryQuery] = useState('')
  const [composer, setComposer] = useState('')
  const [credentialEntry, setCredentialEntry] = useState('')
  const [credentialSaving, setCredentialSaving] = useState(false)
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
  useEffect(() => { setCredentialEntry('') }, [hostedProvider])
  const [error, setError] = useState<string | null>(null); const [failedRequest, setFailedRequest] = useState<AdvisorFailedRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null); const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)
  const [harnessActionBusyId, setHarnessActionBusyId] = useState<string | null>(null)
  const { conversations, setConversations, activeConversationId, setActiveConversationId, harnessActions, setHarnessActions } = useHarnessConversationState(scope, loadingQuestion, setToolStatus)
  useEffect(() => () => invalidateAdvisorRequest(), [invalidateAdvisorRequest])
  useEffect(() => {
    if (!normalizedContextualLaunch || !contextualScope) return
    setScope(contextualScope)
    setComposer(normalizedContextualLaunch.suggestedPrompt ?? '')
    setNotice(`Context from ${advisorContextualSurfaceLabel(normalizedContextualLaunch.originatingSection)} loaded. Review the suggested question before sending.`)
    setSelectedAnswerId(null)
  }, [contextualScope, normalizedContextualLaunch])
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId) ?? conversations[0]!; const messages = activeConversation.messages
  const updateConversation = useCallback((conversationId: string, update: (conversation: AdvisorConversation) => AdvisorConversation) => {
    setConversations(current => current.map(conversation => conversation.id === conversationId ? update(conversation) : conversation))
  }, [])
  const ask = useCallback(async (rawQuestion: string, retryRequest?: AdvisorFailedRequest) => {
    const question = rawQuestion.trim()
    if (!question || loadingQuestion) return
    const requestedScope = retryRequest?.scope ?? scope
    const conversationId = retryRequest?.conversationId ?? activeConversationId
    const targetConversation = conversations.find(conversation => conversation.id === conversationId)
    if (!targetConversation) return
    const currentHosted = hostedConfigRef.current
    if (currentHosted.runtimeChoice === 'hosted' && hostedSubmitBlockReason) {
      setNotice(hostedSubmitBlockReason)
      return
    }
    invalidateAdvisorRequest()
    const controller = new AbortController()
    requestController.current = controller
    const requestId = requestGenerationRef.current
    const isCurrentRequest = () => !controller.signal.aborted && requestGenerationRef.current === requestId
    const requestedScopeFingerprint = advisorScopeFingerprint(requestedScope)
    const history: AdvisorConversationTurn[] = retryRequest?.conversation ?? targetConversation.messages
      .map(message => ({ role: message.role, content: message.role === 'user' ? message.text ?? '' : message.answer?.conclusion ?? '', scopeFingerprint: message.scopeFingerprint }))
      .filter(turn => turn.scopeFingerprint === requestedScopeFingerprint)
    if (!retryRequest) {
      const userMessage: AdvisorMessage = { id: makeId('user'), role: 'user', text: question, scopeFingerprint: requestedScopeFingerprint }
      updateConversation(conversationId, conversation => ({
        ...conversation,
        title: conversation.messages.length === 0 ? question.slice(0, 42) : conversation.title,
        messages: [...conversation.messages, userMessage],
      }))
    }
    setComposer('')
    setError(null)
    setFailedRequest(null)
    setNotice(null)
    setLoadingQuestion(question)
    setStreamPreview('')
    setToolStatus(null)
    setToolActivity([])
    try {
      const durableSend = metrora.harnessSendMessage
      if (runtimeChoice !== 'hosted' && runtimeModel && typeof durableSend === 'function') {
        const result = await durableSend({
          conversationId,
          runtime: runtimeId,
          model: runtimeModel,
          scope: requestedScope,
          question,
          requestId: String(requestId),
        })
        if (!isCurrentRequest()) return
        const assistantMessage: AdvisorMessage = {
          id: result.message.id || makeId('assistant'),
          role: 'assistant',
          text: result.message.text,
          scopeFingerprint: requestedScopeFingerprint,
        }
        updateConversation(conversationId, conversation => ({ ...conversation, messages: [...conversation.messages, assistantMessage] }))
        setSelectedAnswerId(assistantMessage.id)
        return
      }
      let answer = await kernel.investigate({
        question,
        scope: requestedScope,
        overview: contextualScopeMode !== 'capacity'
          && requestedScope.period === period
          && requestedScope.provider === provider
          && requestedScope.projectId === projectScopeId
          && requestedScope.range?.from === range?.from
          && requestedScope.range?.to === range?.to
          && requestedScope.model === null
          && !overview.loading
          && !overview.switching ? overview.data : null,
        conversation: history,
        uiContext: {
          contractVersion: 'advisor-ui-context-v1',
          schemaVersion: 1,
          currentSurface: normalizedContextualLaunch?.originatingSection ?? 'Harness',
          period: requestedScope.period,
          provider: requestedScope.provider,
          project: requestedScope.projectName,
          model: requestedScope.model,
          relevantReferences: normalizedContextualLaunch?.suggestedPrompt ? [normalizedContextualLaunch.suggestedPrompt] : [],
        },
        signal: controller.signal,
        onToolEvent: event => {
          if (!isCurrentRequest()) return
          setToolActivity(current => [...current.filter(item => item.name !== event.name), event].slice(-4))
          setToolStatus(event.status === 'started' || event.status === 'queued' ? harnessToolLabel(event.name, requestedScope) + '…' : event.status === 'completed' ? 'Evidence ready' : event.status === 'unavailable' ? 'Evidence unavailable' : event.status === 'cancelled' ? 'Request cancelled' : 'Evidence read failed')
        },
        onDelta: text => { if (isCurrentRequest()) setStreamPreview(current => (current + text).slice(0, 4_000)) },
      })
      if (!isCurrentRequest()) return
      if (answer.actionProposal?.kind === 'run-core-compatibility' && !answer.actionProposal.harnessAction) {
        const bridge = metrora.harnessProposeCoreCompatibility
        if (runtimeChoice !== 'ollama' || !runtimeModel || typeof bridge !== 'function') {
          answer = {
            ...answer,
            materialLimits: [
              ...(answer.materialLimits ?? []),
              typeof bridge !== 'function'
                ? 'This desktop build has no trusted Core Compatibility action bridge; no action was prepared.'
                : 'Core Compatibility needs an explicitly selected Ollama model; no action was prepared.',
            ],
          }
        } else {
          try {
            const proposal = await bridge(runtimeModel)
            if (!isCurrentRequest()) return
            setHarnessActions(current => ({ ...current, [proposal.actionId]: proposal }))
            answer = {
              ...answer,
              actionProposal: {
                ...answer.actionProposal,
                harnessAction: {
                  actionId: proposal.actionId,
                  proposalDigest: proposal.proposalDigest,
                  model: proposal.model,
                  status: proposal.status,
                },
              },
            }
          } catch {
            answer = {
              ...answer,
              materialLimits: [...(answer.materialLimits ?? []), 'The Core Compatibility proposal could not be prepared; no action was executed.'],
            }
          }
        }
      }
      if (!isCurrentRequest()) return
      const assistantMessage: AdvisorMessage = { id: makeId('assistant'), role: 'assistant', answer, scopeFingerprint: requestedScopeFingerprint }
      updateConversation(conversationId, conversation => ({ ...conversation, messages: [...conversation.messages, assistantMessage] }))
      setSelectedAnswerId(assistantMessage.id)
    } catch (caught) {
      if (!isCurrentRequest()) return
      if (isAdvisorCancelled(caught)) setNotice('Request cancelled. Your conversation stays local to this session.')
      else {
        setFailedRequest({
          question,
          scope: { ...requestedScope, range: requestedScope.range ? { ...requestedScope.range } : null },
          conversationId,
          conversation: history.map(turn => ({ ...turn })),
        })
        setError(caught instanceof Error ? caught.message : 'Harness could not complete this request.')
      }
    } finally {
      if (requestGenerationRef.current !== requestId) return
      if (requestController.current === controller) requestController.current = null
      setLoadingQuestion(null)
      setStreamPreview('')
      setToolStatus(null)
    }
  }, [activeConversationId, contextualScopeMode, conversations, hostedSubmitBlockReason, invalidateAdvisorRequest, kernel, loadingQuestion, normalizedContextualLaunch, overview.data, overview.loading, overview.switching, period, projectScopeId, provider, range?.from, range?.to, runtimeChoice, runtimeId, runtimeModel, scope, updateConversation])
  const confirmHarnessAction = useCallback(async (actionId: string, digest: string) => {
    if (harnessActionBusyId || typeof metrora.harnessApproveCoreCompatibility !== 'function') {
      if (!harnessActionBusyId) setNotice('This desktop build cannot confirm a Core Compatibility action.')
      return
    }
    setHarnessActionBusyId(actionId)
    try {
      const event = await metrora.harnessApproveCoreCompatibility(actionId, digest)
      setHarnessActions(current => ({ ...current, [event.actionId]: event }))
      setNotice(null)
    } catch {
      setNotice('Core Compatibility confirmation was rejected or could not be completed.')
    } finally {
      setHarnessActionBusyId(current => current === actionId ? null : current)
    }
  }, [harnessActionBusyId])
  const cancelHarnessAction = useCallback(async (actionId: string) => {
    if (harnessActionBusyId || typeof metrora.harnessCancelCoreCompatibility !== 'function') {
      if (!harnessActionBusyId) setNotice('This desktop build cannot cancel a Core Compatibility action.')
      return
    }
    setHarnessActionBusyId(actionId)
    try {
      const event = await metrora.harnessCancelCoreCompatibility(actionId)
      if (event) setHarnessActions(current => ({ ...current, [event.actionId]: event }))
      setNotice(null)
    } catch {
      setNotice('Core Compatibility cancellation could not be completed.')
    } finally {
      setHarnessActionBusyId(current => current === actionId ? null : current)
    }
  }, [harnessActionBusyId])
  const cancel = () => {
    if (typeof metrora.harnessCancel === 'function') void metrora.harnessCancel(activeConversationId).catch(() => {})
    invalidateAdvisorRequest()
    setNotice('Cancelling request…')
  }
  const newConversation = () => {
    const next: AdvisorConversation = { id: makeId('chat'), title: 'New chat', messages: [] }
    setConversations(current => [next, ...current])
    setActiveConversationId(next.id)
    setSelectedAnswerId(null)
    setError(null)
    setNotice(null)
    if (runtimeChoice !== 'hosted' && runtimeModel && typeof metrora.harnessCreateConversation === 'function') {
      void metrora.harnessCreateConversation({ conversationId: next.id, runtime: runtimeId, model: runtimeModel, scope }).catch(() => {})
    }
  }
  const activateHosted = () => {
    invalidateAdvisorRequest()
    setRuntimeChoice('hosted')
    setHostedConsent(false)
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
  const updateHostedProvider = (next: AdvisorHostedProviderId) => {
    invalidateAdvisorRequest()
    hostedOperationGuardRef.current.setProvider(next)
    hostedProbeController.current?.abort()
    setHostedProvider(next)
    setHostedModel(null)
    setHostedConsent(false)
    setCredentialSaving(false)
    void checkHostedRuntime(next, true)
  }
  const updateHostedModel = (model: string) => {
    invalidateAdvisorRequest()
    setHostedModel(model)
    setHostedConsent(false)
  }
  const updateLocalRuntime = (next: AdvisorLocalRuntimeId) => {
    invalidateAdvisorRequest()
    setRuntimeId(next)
    setRuntimeModel(null)
    setHostedConsent(false)
    void checkLocalRuntime(next)
  }
  const updateLocalModel = (model: string) => {
    invalidateAdvisorRequest()
    setLocalModel(model)
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
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredConversations = conversations.filter(conversation => !normalizedHistoryQuery || [
    conversation.title,
    ...conversation.messages.map(message => message.text ?? message.answer?.conclusion ?? ''),
  ].some(value => value.toLowerCase().includes(normalizedHistoryQuery)))
  const runtimeControls = {
    runtimeChoice,
    runtimeId,
    runtimeModel,
    runtimeState,
    hostedProvider,
    hostedModel,
    hostedProbe,
    hostedConsent,
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
    onCredentialEntryChange: setCredentialEntry,
    onSaveHostedCredential: () => void saveHostedCredential(),
    onClearHostedCredential: () => void clearHostedCredential(),
    onCheckLocalRuntime: () => void checkLocalRuntime(),
    onActivateHosted: activateHosted,
    onLocalRuntimeChange: updateLocalRuntime,
    onLocalModelChange: updateLocalModel,
  }
  const retryFailedRequest = () => {
    if (failedRequest) {
      setActiveConversationId(failedRequest.conversationId)
      void ask(failedRequest.question, failedRequest)
    }
  }
  const runSwarm = useCallback((rawTask: string, workerCount = 2): boolean => {
    const task = rawTask.trim()
    if (!task || !swarmExperimentalEnabled || swarm.state.running) return false
    if (runtimeChoice === 'hosted' && hostedSubmitBlockReason) {
      setNotice(hostedSubmitBlockReason)
      return false
    }
    const conversationId = activeConversationId
    const requestedScopeFingerprint = advisorScopeFingerprint(scope)
    updateConversation(conversationId, conversation => ({
      ...conversation,
      title: conversation.messages.length === 0 ? task.slice(0, 42) : conversation.title,
      messages: [...conversation.messages, { id: makeId('user'), role: 'user', text: task, scopeFingerprint: requestedScopeFingerprint }],
    }))
    setSwarmConversationId(conversationId)
    setSelectedAnswerId(null)
    setError(null)
    setFailedRequest(null)
    setNotice(null)
    setComposer('')
    swarm.run(task, workerCount)
    return true
  }, [activeConversationId, hostedSubmitBlockReason, runtimeChoice, scope, swarm, swarmExperimentalEnabled, updateConversation])
  const changeMode = (next: 'chat' | 'swarm') => {
    if (next === 'swarm' && !swarmExperimentalEnabled) return
    if (next === mode) return
    invalidateAdvisorRequest()
    swarm.cancel()
    setMode(next)
    setNotice(null)
  }
  return (
    <HarnessSurface
      mode={mode}
      swarmExperimentalEnabled={swarmExperimentalEnabled}
      onModeChange={changeMode}
      swarm={{
        enabled: swarmExperimentalEnabled,
        runtimeLabel: activeRuntime.label,
        modelLabel: runtimeChoice === 'hosted' ? hostedModelForRuntime?.label ?? activeRuntime.label : runtimeModel ?? activeRuntime.label,
        state: swarmConversationId === null || swarmConversationId === activeConversationId ? swarm.state : { runId: null, status: 'idle', events: [], result: null, error: null, running: false },
        onRun: runSwarm,
        onCancel: swarm.cancel,
      }}
      projectOptions={projectOptions}
      modelOptions={modelOptions}
      providerOptions={providerOptions}
      scope={scope}
      contextualScopeMode={contextualScopeMode}
      contextualOrigin={normalizedContextualLaunch ? advisorContextualSurfaceLabel(normalizedContextualLaunch.originatingSection) : null}
      scopeSummary={contextualScopeLabel(scope, contextualScopeMode)}
      onScopeChange={update => setScope(update)}
      runtimeUnavailable={runtimeChoice !== 'hosted' && runtimeState.status === 'unavailable'}
      onRetryRuntime={() => void checkLocalRuntime()}
      overviewError={overview.error && !overview.data ? overview.error.message : null}
      runtimeControls={runtimeControls}
      filteredConversations={filteredConversations}
      activeConversationId={activeConversationId}
      historyQuery={historyQuery}
      onNewChat={newConversation}
      onConversationSelect={setActiveConversationId}
      onHistoryQueryChange={setHistoryQuery}
      messages={messages}
      selectedAnswerId={selectedAnswerId}
      onSelectAnswer={id => setSelectedAnswerId(id)}
      onFollowUp={next => void ask(next)}
      harnessActions={harnessActions}
      harnessActionBusyId={harnessActionBusyId}
      onConfirmHarnessAction={confirmHarnessAction}
      onCancelHarnessAction={cancelHarnessAction}
      loadingQuestion={loadingQuestion}
      toolStatus={toolStatus}
      toolActivity={toolActivity}
      streamPreview={streamPreview}
      onCancel={cancel}
      error={error}
      onRetry={retryFailedRequest}
      failedRequestPresent={Boolean(failedRequest)}
      notice={notice}
      composer={composer}
      hostedSubmitBlockReason={hostedSubmitBlockReason}
      onComposerChange={setComposer}
      onAsk={question => void ask(question)}
      onNextInvestigation={question => void ask(question)}
    />
  )
}
