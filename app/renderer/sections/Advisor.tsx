import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { createAdvisorDataSource } from '../advisor/source'
import { createAdvisorKernel } from '../advisor/kernel'
import { createAdvisorOverviewSnapshot } from '../advisor/tools'
import { resolveAdvisorQuestion } from '../advisor/comprehension'
import { advisorReadToolNamesForPlan } from '../advisor/required-reads'
import { advisorContextualSurfaceLabel, advisorScopeFromContextualLaunch, normalizeAdvisorContextualLaunch, type AdvisorContextualLaunchV1, type AdvisorContextualScopeMode } from '../advisor/context'
import { advisorScopeForRequestedPeriod, advisorScopeForTurn, advisorTaskContextForTurn } from '../advisor/turn-plan'
import { advisorConversationScopeCompatible, advisorHarnessContext, advisorPinnedHarnessContext, advisorScopeFingerprint, UNPINNED_ADVISOR_HARNESS_CONTEXT, type AdvisorAnswer, type AdvisorConversationTurn, type AdvisorEvidenceDomain, type AdvisorHarnessTaskContextV1, type AdvisorScope, type AdvisorScopeConflictOptionV1, type AdvisorScopeConflictV1 } from '../advisor/types'
import { contextualScopeLabel } from './advisor-scope-labels'
import { createHarnessCompletedWorkTrace, harnessToolCheckedLabel, harnessToolLabel, type HarnessCompletedWorkTrace, type HarnessToolActivity } from '../harness/HarnessWorkTrace'
import { HarnessSurface } from '../harness/HarnessSurface'
import { isSwarmExperimentalEnabled } from '../swarm/feature-gate'
import { useSwarmRun } from '../swarm/useSwarmRun'
import type { MetroraAgentLoopEvent } from '../agent-loop/contracts'
import { isAdvisorCancelled } from './useAdvisorLocalRuntime'
import { useAdvisorRuntimeController } from './useAdvisorRuntimeController'
type DetectedProvider = { id: string; label: string }
type AdvisorMessage = { id: string; role: 'user' | 'assistant'; text?: string; answer?: AdvisorAnswer; scopeFingerprint: string; workTrace?: HarnessCompletedWorkTrace }
type AdvisorConversation = { id: string; title: string; messages: AdvisorMessage[]; taskContext?: AdvisorHarnessTaskContextV1 }
type AdvisorFailedRequest = { question: string; scope: AdvisorScope; conversationId: string; conversation: AdvisorConversationTurn[]; taskContext?: AdvisorHarnessTaskContextV1 }

function makeId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

function copyAdvisorScope(scope: AdvisorScope): AdvisorScope {
  return {
    ...scope,
    range: scope.range ? { ...scope.range } : null,
    ...(scope.harnessContext ? { harnessContext: { ...scope.harnessContext, pins: [...scope.harnessContext.pins] } } : {}),
  }
}

function taskContextAfterAnswer(
  sourceTurnId: string,
  question: string,
  scope: AdvisorScope,
  previous: AdvisorHarnessTaskContextV1 | undefined,
  answer: AdvisorAnswer,
  history: AdvisorConversationTurn[],
): AdvisorHarnessTaskContextV1 | undefined {
  const resolved = resolveAdvisorQuestion(question, scope, history, previous)
  if (resolved.plan.turnKind !== 'investigate') return undefined
  const availableToolNames = advisorReadToolNamesForPlan(resolved, question, previous)
  if (!availableToolNames.length && !answer.evidence.length && !answer.runtimeFailure) return undefined
  const checkedDomains = answer.evidence.length
    ? Array.from(new Set<AdvisorEvidenceDomain>([...(previous?.checkedDomains ?? []), ...resolved.plan.requestedEvidenceDomains])).slice(0, 16)
    : [...(previous?.checkedDomains ?? [])].slice(0, 16)
  return {
    contractVersion: 'advisor-harness-task-context-v1',
    schemaVersion: 1,
    sourceTurnId: previous?.sourceTurnId ?? sourceTurnId,
    kind: resolved.intent === 'unknown' ? 'investigative' : 'factual',
    originalRequest: (previous?.originalRequest ?? question).slice(0, 1_000),
    scope: copyAdvisorScope(scope),
    checkedDomains,
    status: answer.runtimeFailure ? 'failed' : answer.evidence.length ? 'completed' : 'active',
    availableToolNames: availableToolNames.slice(0, 7),
  }
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
    // The normal Harness surface is conversation-first. These compatibility
    // fields are retained for the canonical Tool contract, but desktop
    // dashboard filters must not become an implicit Harness pin.
    range: null,
    provider: 'all',
    projectId: 'all',
    projectName: 'All projects',
    model: null,
    harnessContext: UNPINNED_ADVISOR_HARNESS_CONTEXT,
  }))
  useEffect(() => {
    if (scope.model && !modelOptions.includes(scope.model)) setScope(current => ({ ...current, model: null }))
  }, [modelOptions, scope.model])
  const source = useMemo(() => createAdvisorDataSource(metrora), [])
  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null)
  const [streamPreview, setStreamPreview] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [toolActivity, setToolActivity] = useState<HarnessToolActivity[]>([])
  const toolActivityRef = useRef<HarnessToolActivity[]>([])
  const agentEventsRef = useRef<MetroraAgentLoopEvent[]>([])
  const [agentEvents, setAgentEvents] = useState<MetroraAgentLoopEvent[]>([])
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
    toolActivityRef.current = []
    agentEventsRef.current = []
    setAgentEvents([])
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
  const pendingSwarmConflictRef = useRef<{ question: string; workerCount: number } | null>(null)
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
  useEffect(() => {
    // A contextual launch is the only place where the Harness inherits a
    // scoped factual surface. When it closes, return to a fresh unpinned
    // conversation context instead of retaining a hidden dashboard filter.
    if (normalizedContextualLaunch) return
    setScope(current => {
      if (current.harnessContext?.mode === 'unpinned' && current.range === null && current.provider === 'all' && current.projectId === 'all' && current.model === null) return current
      return {
        ...current,
        period,
        range: null,
        provider: 'all',
        projectId: 'all',
        projectName: 'All projects',
        model: null,
        harnessContext: UNPINNED_ADVISOR_HARNESS_CONTEXT,
      }
    })
  }, [normalizedContextualLaunch])
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId) ?? conversations[0]!
  const messages = activeConversation.messages
  const updateConversation = useCallback((conversationId: string, update: (conversation: AdvisorConversation) => AdvisorConversation) => {
    setConversations(current => current.map(conversation => conversation.id === conversationId ? update(conversation) : conversation))
  }, [])
  const ask = useCallback(async (rawQuestion: string, retryRequest?: AdvisorFailedRequest, scopeOverride?: AdvisorScope) => {
    const question = rawQuestion.trim()
    if (!question || loadingQuestion) return
    const baseScope = retryRequest?.scope ?? scopeOverride ?? scope
    const conversationId = retryRequest?.conversationId ?? activeConversationId
    const targetConversation = conversations.find(conversation => conversation.id === conversationId)
    if (!targetConversation) return
    // A supplied scope override represents an explicit user choice for this
    // turn (for example, resolving a pinned-period conflict). Do not let the
    // prior task context reintroduce the conflict; retries carry their task
    // context explicitly through retryRequest.
    const taskContext = advisorTaskContextForTurn(baseScope, retryRequest?.taskContext ?? (scopeOverride ? undefined : targetConversation.taskContext))
    const requestedScope = advisorScopeForTurn(baseScope, question, taskContext)
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
    const sourceTurnId = makeId('turn')
    const history: AdvisorConversationTurn[] = retryRequest?.conversation ?? targetConversation.messages
      .map(message => ({ role: message.role, content: message.role === 'user' ? message.text ?? '' : message.answer?.conclusion ?? '', scopeFingerprint: message.scopeFingerprint }))
      .filter(turn => advisorConversationScopeCompatible(requestedScope, turn.scopeFingerprint))
    if (!retryRequest) {
      const userMessage: AdvisorMessage = { id: sourceTurnId, role: 'user', text: question, scopeFingerprint: requestedScopeFingerprint }
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
    toolActivityRef.current = []
    try {
      let answer = await kernel.investigate({
        question,
        scope: requestedScope,
        taskContext,
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
          agentEventsRef.current = [...agentEventsRef.current, { type: event.type, turnId: event.turnId, ...(event.step !== undefined ? { step: event.step } : {}), ...(event.tool ? { tool: event.tool } : {}), at: event.at }].slice(-128)
          setAgentEvents([...agentEventsRef.current])
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
          const nextActivity = [...toolActivityRef.current.filter(item => item.name !== event.name), event].slice(-4)
          toolActivityRef.current = nextActivity
          setToolActivity(nextActivity)
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
      const nextTaskContext = taskContextAfterAnswer(sourceTurnId, question, requestedScope, taskContext, answer, history)
      const assistantMessage: AdvisorMessage = { id: makeId('assistant'), role: 'assistant', answer, scopeFingerprint: requestedScopeFingerprint, workTrace: createHarnessCompletedWorkTrace(toolActivityRef.current, agentEventsRef.current) }
      updateConversation(conversationId, conversation => ({ ...conversation, taskContext: nextTaskContext, messages: [...conversation.messages, assistantMessage] }))
      setSelectedAnswerId(assistantMessage.id)
    } catch (caught) {
      if (!isCurrentRequest()) return
      if (isAdvisorCancelled(caught)) setNotice('Request cancelled. Your conversation stays local to this session.')
      else {
        setFailedRequest({
          question,
          scope: copyAdvisorScope(requestedScope),
          conversationId,
          conversation: history.map(turn => ({ ...turn })),
          taskContext: taskContext
            ? { ...taskContext, status: 'failed', scope: copyAdvisorScope(taskContext.scope), checkedDomains: [...taskContext.checkedDomains], availableToolNames: [...taskContext.availableToolNames] }
            : taskContextAfterAnswer(sourceTurnId, question, requestedScope, undefined, {
                conclusion: '',
                scopeLabel: '',
                periodLabel: '',
                evidence: [],
                coverage: { level: 'unavailable', label: 'Unavailable', detail: 'The selected runtime failed.' },
                assumptions: [],
                unknown: [],
                nextInvestigations: [],
                details: [],
                runtime: { id: activeRuntime.id, label: activeRuntime.label, mode: activeRuntime.mode },
                runtimeFailure: true,
              }, history),
        })
        if (taskContext) updateConversation(conversationId, conversation => ({ ...conversation, taskContext: { ...taskContext, status: 'failed', scope: copyAdvisorScope(taskContext.scope), checkedDomains: [...taskContext.checkedDomains], availableToolNames: [...taskContext.availableToolNames] } }))
        setError(caught instanceof Error ? caught.message : 'Harness could not complete this request.')
      }
    } finally {
      if (requestGenerationRef.current !== requestId) return
      if (requestController.current === controller) requestController.current = null
      setLoadingQuestion(null)
      setStreamPreview('')
      setToolStatus(null)
    }
  }, [activeConversationId, activeRuntime, contextualScopeMode, conversations, hostedModel, hostedProvider, hostedSubmitBlockReason, invalidateAdvisorRequest, kernel, loadingQuestion, markHostedModelVerified, normalizedContextualLaunch, overview.data, overview.loading, overview.switching, period, projectScopeId, provider, range?.from, range?.to, runtimeChoice, runtimeModel, scope, updateConversation])
  const handleScopeConflictOption = useCallback((question: string, conflict: AdvisorScopeConflictV1, option: AdvisorScopeConflictOptionV1) => {
    if (loadingQuestion) return
    const retainedPins = advisorHarnessContext(scope).pins.filter(pin => pin !== 'period' && pin !== 'range')
    const requestedScope = advisorScopeForRequestedPeriod(scope, conflict.requestedPeriod, new Date(), advisorPinnedHarnessContext(...retainedPins))
    const changedScope = advisorScopeForRequestedPeriod(scope, conflict.requestedPeriod, new Date(), advisorPinnedHarnessContext(...retainedPins, 'period'))
    const pendingSwarm = pendingSwarmConflictRef.current
    if (pendingSwarm?.question === question) {
      pendingSwarmConflictRef.current = null
      if (option.id === 'change-scope') {
        invalidateAdvisorRequest()
        setScope(changedScope)
        setNotice('Scope changed. Review the selected context, then run Swarm again.')
        return
      }
      setNotice(null)
      swarm.run(question, pendingSwarm.workerCount, requestedScope)
      return
    }
    if (option.id === 'change-scope') {
      invalidateAdvisorRequest()
      setScope(changedScope)
      setNotice('Scope changed. Review the selected context, then ask the question again.')
      return
    }
    void ask(question, undefined, requestedScope)
  }, [ask, invalidateAdvisorRequest, loadingQuestion, scope, swarm.run])
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
    pendingSwarmConflictRef.current = null
    setScope(current => ({
      ...current,
      period,
      range: null,
      provider: 'all',
      projectId: 'all',
      projectName: 'All projects',
      model: null,
      harnessContext: UNPINNED_ADVISOR_HARNESS_CONTEXT,
    }))
    setConversations(current => [next, ...current])
    setActiveConversationId(next.id)
    setSwarmConversationId(null)
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
  const runSwarm = useCallback((rawTask: string, workerCount = 2, scopeOverride?: AdvisorScope): boolean => {
    const task = rawTask.trim()
    if (!task || !swarmExperimentalEnabled || swarm.state.running) return false
    if (runtimeChoice === 'hosted' && hostedSubmitBlockReason) {
      setNotice(hostedSubmitBlockReason)
      return false
    }
    const conversationId = activeConversationId
    const targetConversation = conversations.find(conversation => conversation.id === conversationId)
    const effectiveBaseScope = scopeOverride ?? scope
    const taskContext = advisorTaskContextForTurn(effectiveBaseScope, targetConversation?.taskContext)
    const effectiveScope = advisorScopeForTurn(effectiveBaseScope, task, taskContext)
    const requestedScopeFingerprint = advisorScopeFingerprint(effectiveScope)
    const swarmConversation = targetConversation?.messages
      .map(message => ({ role: message.role, content: message.role === 'user' ? message.text ?? '' : message.answer?.conclusion ?? '', scopeFingerprint: message.scopeFingerprint } as AdvisorConversationTurn))
      .filter(turn => advisorConversationScopeCompatible(effectiveScope, turn.scopeFingerprint)) ?? []
    const plan = resolveAdvisorQuestion(task, effectiveScope, swarmConversation, taskContext)
    if (plan.plan.scopeConflict) {
      pendingSwarmConflictRef.current = { question: task, workerCount }
      setSwarmConversationId(conversationId)
      void ask(task, undefined, effectiveScope)
      return true
    }
    pendingSwarmConflictRef.current = null
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
    return swarm.run(task, workerCount, effectiveScope)
  }, [activeConversationId, ask, conversations, hostedSubmitBlockReason, runtimeChoice, scope, swarm, swarmExperimentalEnabled, updateConversation])
  const changeMode = (next: 'chat' | 'swarm') => {
    if (next === 'swarm' && !swarmExperimentalEnabled) return
    if (next === mode) return
    pendingSwarmConflictRef.current = null
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
      onScopeChange={update => {
        pendingSwarmConflictRef.current = null
        setScope(update)
      }}
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
      agentEvents={agentEvents}
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
