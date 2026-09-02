import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { createAdvisorDataSource } from '../advisor/source'
import { createAdvisorKernel } from '../advisor/kernel'
import { createAdvisorOverviewSnapshot } from '../advisor/tools'
import { advisorContextualSurfaceLabel, advisorScopeFromContextualLaunch, normalizeAdvisorContextualLaunch, type AdvisorContextualLaunchV1, type AdvisorContextualScopeMode } from '../advisor/context'
import { advisorScopeForRequestedPeriod } from '../advisor/turn-plan'
import { advisorScopeFingerprint, type AdvisorAnswer, type AdvisorConversationTurn, type AdvisorScope, type AdvisorScopeConflictOptionV1, type AdvisorScopeConflictV1 } from '../advisor/types'
import { contextualScopeLabel } from './advisor-scope-labels'
import { harnessToolCheckedLabel, harnessToolLabel, type HarnessToolActivity } from '../harness/HarnessWorkTrace'
import { HarnessSurface } from '../harness/HarnessSurface'
import { isSwarmExperimentalEnabled } from '../swarm/feature-gate'
import { useSwarmRun } from '../swarm/useSwarmRun'
import { isAdvisorCancelled } from './useAdvisorLocalRuntime'
import { useAdvisorRuntimeController } from './useAdvisorRuntimeController'
type DetectedProvider = { id: string; label: string }
type AdvisorMessage = { id: string; role: 'user' | 'assistant'; text?: string; answer?: AdvisorAnswer; scopeFingerprint: string }
type AdvisorConversation = { id: string; title: string; messages: AdvisorMessage[] }
type AdvisorFailedRequest = { question: string; scope: AdvisorScope; conversationId: string; conversation: AdvisorConversationTurn[] }

function makeId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
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
  const [notice, setNotice] = useState<string | null>(null)
  const {
    activeRuntime,
    runtimeChoice,
    hostedProvider,
    hostedModel,
    hostedModelForRuntime,
    hostedConfigRef,
    hostedSubmitBlockReason,
    runtimeModel,
    runtimeState,
    checkLocalRuntime,
    markHostedModelVerified,
    runtimeControls,
  } = useAdvisorRuntimeController({ invalidateAdvisorRequest, setNotice })
  const kernel = useMemo(() => createAdvisorKernel(source, activeRuntime), [activeRuntime, source])
  const swarmExperimentalEnabled = isSwarmExperimentalEnabled()
  const [mode, setMode] = useState<'chat' | 'swarm'>('chat')
  const [swarmConversationId, setSwarmConversationId] = useState<string | null>(null)
  const swarm = useSwarmRun({
    source,
    runtime: activeRuntime,
    scope,
    overview: !overview.loading && !overview.switching && scope.period === period && scope.provider === provider && scope.projectId === projectScopeId && scope.range?.from === range?.from && scope.range?.to === range?.to && scope.model === null && overview.data ? createAdvisorOverviewSnapshot(scope, overview.data) : null,
    modelId: runtimeChoice === 'hosted' ? hostedModel ?? activeRuntime.id : runtimeModel ?? activeRuntime.id,
    modelLabel: runtimeChoice === 'hosted' ? hostedModelForRuntime?.label ?? activeRuntime.label : runtimeModel ?? activeRuntime.label,
    enabled: swarmExperimentalEnabled,
  })
  const [conversations, setConversations] = useState<AdvisorConversation[]>(() => [{ id: makeId('chat'), title: 'New chat', messages: [] }])
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0]!.id)
  const [historyQuery, setHistoryQuery] = useState('')
  const [composer, setComposer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [failedRequest, setFailedRequest] = useState<AdvisorFailedRequest | null>(null)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)
  const [harnessActions, setHarnessActions] = useState<Record<string, MetroraHarnessActionEvent>>({})
  const [harnessActionBusyId, setHarnessActionBusyId] = useState<string | null>(null)
  useEffect(() => {
    const subscribe = metrora.onHarnessActionEvent
    if (typeof subscribe !== 'function') return
    return subscribe(event => setHarnessActions(current => ({ ...current, [event.actionId]: event })))
  }, [])
  useEffect(() => () => invalidateAdvisorRequest(), [invalidateAdvisorRequest])
  useEffect(() => {
    if (!normalizedContextualLaunch || !contextualScope) return
    setScope(contextualScope)
    setComposer(normalizedContextualLaunch.suggestedPrompt ?? '')
    setNotice(`Context from ${advisorContextualSurfaceLabel(normalizedContextualLaunch.originatingSection)} loaded. Review the suggested question before sending.`)
    setSelectedAnswerId(null)
  }, [contextualScope, normalizedContextualLaunch])
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId) ?? conversations[0]!
  const messages = activeConversation.messages
  const updateConversation = useCallback((conversationId: string, update: (conversation: AdvisorConversation) => AdvisorConversation) => {
    setConversations(current => current.map(conversation => conversation.id === conversationId ? update(conversation) : conversation))
  }, [])
  const ask = useCallback(async (rawQuestion: string, retryRequest?: AdvisorFailedRequest, scopeOverride?: AdvisorScope) => {
    const question = rawQuestion.trim()
    if (!question || loadingQuestion) return
    const requestedScope = retryRequest?.scope ?? scopeOverride ?? scope
    const conversationId = retryRequest?.conversationId ?? activeConversationId
    const targetConversation = conversations.find(conversation => conversation.id === conversationId)
    if (!targetConversation) return
    const currentHosted = hostedConfigRef.current
    const hostedRequest = currentHosted.runtimeChoice === 'hosted' && hostedModel
      ? { provider: hostedProvider, model: hostedModel }
      : null
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
          && !overview.switching
          && overview.data ? createAdvisorOverviewSnapshot(requestedScope, overview.data) : null,
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
        onConformance: () => {
          if (isCurrentRequest() && hostedRequest) markHostedModelVerified(hostedRequest.provider, hostedRequest.model)
        },
        onAgentEvent: event => {
          if (!isCurrentRequest()) return
          if (event.type === 'turn-started' || event.type === 'model-started' || (event.type === 'model-completed' && event.detail === 'tool-calls')) {
            setToolStatus('Thinking…')
          } else if (event.type === 'tool-queued' || event.type === 'tool-started') {
            setToolStatus(event.tool ? harnessToolLabel(event.tool, requestedScope) + '…' : 'Thinking…')
          } else if (event.type === 'tool-completed') {
            setToolStatus(event.tool ? harnessToolCheckedLabel(event.tool) : 'Sources checked')
          } else if (event.type === 'tool-unavailable' || event.type === 'tool-failed' || event.type === 'turn-failed' || event.type === 'turn-timeout') {
            setToolStatus('Failed')
          } else if (event.type === 'turn-cancelled') {
            setToolStatus('Request cancelled')
          } else if (event.type === 'turn-completed') {
            setToolStatus('Preparing answer…')
          }
        },
        onToolEvent: event => {
          if (!isCurrentRequest()) return
          setToolActivity(current => [...current.filter(item => item.name !== event.name), event].slice(-4))
          setToolStatus(event.status === 'started' || event.status === 'queued' ? harnessToolLabel(event.name, requestedScope) + '…' : event.status === 'completed' ? harnessToolCheckedLabel(event.name) : event.status === 'unavailable' ? 'Failed' : event.status === 'cancelled' ? 'Request cancelled' : 'Failed')
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
  }, [activeConversationId, contextualScopeMode, conversations, hostedModel, hostedProvider, hostedSubmitBlockReason, invalidateAdvisorRequest, kernel, loadingQuestion, markHostedModelVerified, normalizedContextualLaunch, overview.data, overview.loading, overview.switching, period, projectScopeId, provider, range?.from, range?.to, runtimeChoice, runtimeModel, scope, updateConversation])
  const handleScopeConflictOption = useCallback((question: string, conflict: AdvisorScopeConflictV1, option: AdvisorScopeConflictOptionV1) => {
    if (loadingQuestion) return
    const requestedScope = advisorScopeForRequestedPeriod(scope, conflict.requestedPeriod)
    if (option.id === 'change-scope') {
      invalidateAdvisorRequest()
      setScope(requestedScope)
      setNotice('Scope changed. Review the selected context, then ask the question again.')
      return
    }
    void ask(question, undefined, requestedScope)
  }, [ask, invalidateAdvisorRequest, loadingQuestion, scope])
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
  }
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredConversations = conversations.filter(conversation => !normalizedHistoryQuery || [
    conversation.title,
    ...conversation.messages.map(message => message.text ?? message.answer?.conclusion ?? ''),
  ].some(value => value.toLowerCase().includes(normalizedHistoryQuery)))
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
      onScopeConflictOption={handleScopeConflictOption}
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
