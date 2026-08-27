import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import { PERIOD_OPTIONS } from '../components/TopBar'
import { createAdvisorDataSource } from '../advisor/source'
import { createAdvisorKernel } from '../advisor/kernel'
import { createAdvisorRuntime } from '../advisor/runtime'
import { LMStudioAdvisorRuntime, probeLMStudio } from '../advisor/lmstudio'
import { OllamaAdvisorRuntime, probeOllama } from '../advisor/ollama'
import { HostedAdvisorRuntime, probeHostedAdvisor } from '../advisor/hosted'
import { periodLabel, scopeLabel } from '../advisor/evidence'
import { advisorContextualSurfaceLabel, advisorScopeFromContextualLaunch, normalizeAdvisorContextualLaunch, type AdvisorContextualLaunchV1, type AdvisorContextualScopeMode } from '../advisor/context'
import { advisorScopeFingerprint, type AdvisorAnswer, type AdvisorConversationTurn, type AdvisorHostedProviderId, type AdvisorLocalRuntimeId, type AdvisorPresentationBlockV1, type AdvisorScope } from '../advisor/types'
import { AdvisorRuntimeControls, createHostedProbeChecking, createHostedProbeFailure, presentHostedProbe, type AdvisorHostedProbePresentation, type AdvisorRuntimeChoice, type AdvisorRuntimeState } from './AdvisorRuntimeControls'
import { AdvisorHostedOperationGuard, isSelectableHostedModel } from './advisor-hosted-operation-guard'
import { AdvisorChartBlock } from './advisor-chart'
type DetectedProvider = { id: string; label: string }
type AdvisorMessage = { id: string; role: 'user' | 'assistant'; text?: string; answer?: AdvisorAnswer; scopeFingerprint: string }
type AdvisorConversation = { id: string; title: string; messages: AdvisorMessage[] }
type AdvisorFailedRequest = { question: string; scope: AdvisorScope; conversationId: string; conversation: AdvisorConversationTurn[] }
const PERIODS: Array<{ value: Period; label: string }> = PERIOD_OPTIONS.map(option => ({ value: option.value as Period, label: option.label }))
const PROMPTS = [
  { eyebrow: 'Spend changes', label: 'What changed in my spend recently?', question: 'What changed in my spend recently?' },
  { eyebrow: 'Model efficiency', label: 'Which model has the lowest observed cost per call?', question: 'Which model has the lowest observed cost per call?' },
  { eyebrow: 'Capacity', label: 'What quota remains and when does it reset?', question: 'What provider quota remains and when does it reset?' },
  { eyebrow: 'Projects', label: 'Which Project drove the most spend?', question: 'Which Project drove the most spend in this scope?' },
]
function makeId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}
function isCancelled(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError' || error.name === 'AdvisorCancelledError' || /cancel|abort/i.test(error.message)
  if (error && typeof error === 'object') {
    const item = error as { kind?: unknown; message?: unknown }
    return item.kind === 'cancelled' || (typeof item.message === 'string' && /cancel|abort/i.test(item.message))
  }
  return false
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
function displayAnswer(answer: AdvisorAnswer): string {
  return answer.conclusion
}
function answerForMessage(messages: AdvisorMessage[], id: string | null): AdvisorAnswer | null {
  if (id) {
    const selected = messages.find(message => message.id === id)
    if (selected?.answer) return selected.answer
  }
  return [...messages].reverse().find(message => message.answer)?.answer ?? null
}
function PresentationBlocks({ blocks }: { blocks: AdvisorPresentationBlockV1[] }) {
  return <div className="advisor-presentation">{blocks.map((block, index) => {
    if (block.kind === 'text') return <p className="advisor-presentation-text" key={index}>{block.text}</p>
    if (block.kind === 'metric-cards') return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><div className="advisor-metric-grid">{block.cards.map(card => <div className="advisor-metric-card" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.unit}</small><p>{card.detail}</p></div>)}</div></section>
    if (block.kind === 'line-chart' || block.kind === 'bar-chart') return <AdvisorChartBlock block={block} key={index} />
    if (block.kind === 'comparison-table') return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="advisor-presentation-summary">{block.summary}</p><div className="advisor-table-wrap"><table><caption className="sr-only">{block.title}</caption><thead><tr>{block.table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{block.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></section>
    if (block.kind === 'quota-card') return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="advisor-presentation-summary">{block.summary}</p><div className="advisor-quota-grid">{block.providers.map(provider => <div className="advisor-quota-item" key={provider.provider}><strong>{provider.provider}</strong>{provider.planLabel ? <span>{provider.planLabel}</span> : null}{provider.windows.map(window => <span key={window.id}>{window.label} · {window.remainingPercent}% remaining{window.resetsAt ? ' · reset ' + window.resetsAt : ''}</span>)}{provider.creditsUSD !== null ? <span>Credits · ${provider.creditsUSD.toFixed(2)}</span> : null}</div>)}</div></section>
    if (block.kind === 'bench-summary') return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="advisor-presentation-summary">{block.summary}</p>{block.run ? <div className="advisor-bench-summary"><strong>{block.run.model.selected}</strong><span>{block.run.aggregate.passed}/{block.run.aggregate.planned} planned tasks passed</span><span>{block.run.aggregate.scoreValue === null ? 'Score unavailable' : (block.run.aggregate.scoreValue * 100).toFixed(1) + '% score'}</span><span>Status · {block.run.status}</span></div> : <p className="advisor-muted-line">No completed controlled run is available.</p>}</section>
    if (block.kind === 'warning' || block.kind === 'evidence-disclosure') return <section className="advisor-presentation-block advisor-presentation-warning" key={index}><h4>{block.title}</h4><p>{block.text}</p></section>
    return null
  })}</div>
}

function AnswerCard({ answer, selected, onSelect, onFollowUp }: {
  answer: AdvisorAnswer
  selected: boolean
  onSelect: () => void
  onFollowUp: (next: string) => void
}) {
  const why = answer.why ?? []
  const limits = answer.materialLimits ?? []
  return (
    <article className={selected ? 'advisor-message assistant-message selected' : 'advisor-message assistant-message'} onClick={onSelect}>
      <div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Advisor <small>{answer.generatedByModel ? 'model-assisted investigation' : 'offline evidence'}</small></div>
      <p className="advisor-conclusion">{displayAnswer(answer)}</p>
      <div className="advisor-answer-meta"><span className={'advisor-coverage ' + answer.coverage.level}>{answer.coverage.label}</span><span>{answer.scopeLabel}</span></div>
      {answer.presentation?.length ? <PresentationBlocks blocks={answer.presentation} /> : null}
      {why.length ? <section className="advisor-answer-section"><h4>Why</h4>{why.slice(0, 2).map((item, index) => <p key={index}>{item}</p>)}</section> : null}
      {limits.length ? <section className="advisor-answer-section advisor-answer-limit"><h4>Important limit</h4>{limits.slice(0, 2).map((item, index) => <p key={index}>{item}</p>)}</section> : null}
      {answer.nextInvestigations.length ? <div className="advisor-followups"><span>Next step</span>{answer.nextInvestigations.map(next => <button type="button" key={next} onClick={event => { event.stopPropagation(); onFollowUp(next) }}>{next}</button>)}</div> : null}
      <details onClick={event => event.stopPropagation()}>
        <summary>Evidence & details</summary>
        <div className="advisor-details">{answer.details.map((detail, index) => <div key={index}>{detail}</div>)}</div>
        <div className="advisor-limits"><strong>Unknown</strong>{answer.unknown.map((item, index) => <div key={index}>{item}</div>)}</div>
      </details>
    </article>
  )
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
  const [runtimeId, setRuntimeId] = useState<AdvisorLocalRuntimeId>('ollama')
  const [runtimeChoice, setRuntimeChoice] = useState<AdvisorRuntimeChoice>('ollama')
  const [hostedProvider, setHostedProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai')
  const hostedOperationGuardRef = useRef(new AdvisorHostedOperationGuard(hostedProvider))
  const [hostedModel, setHostedModel] = useState<string | null>(null)
  const hostedModelRef = useRef<string | null>(null)
  hostedModelRef.current = hostedModel
  const [hostedConsent, setHostedConsent] = useState(false)
  const [hostedProbe, setHostedProbe] = useState<AdvisorHostedProbePresentation>(() => createHostedProbeChecking('openai'))
  const hostedModelForRuntime = hostedModel && hostedProbe.models.some(model => model.id === hostedModel && isSelectableHostedModel(model)) ? hostedModel : null
  const hostedRuntime = useMemo(() => hostedModelForRuntime ? new HostedAdvisorRuntime({ provider: hostedProvider, model: hostedModelForRuntime, consent: hostedConsent }) : null, [hostedConsent, hostedModelForRuntime, hostedProvider])
  const [runtimeState, setRuntimeState] = useState<AdvisorRuntimeState>({ runtime: 'ollama', status: 'checking', detail: 'Checking for a local Ollama model…', models: [], modelState: 'unavailable', toolCall: 'unknown' })
  const [configureOpen, setConfigureOpen] = useState(false)
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null)
  const [ollamaRuntime, setOllamaRuntime] = useState<OllamaAdvisorRuntime | null>(null)
  const [lmStudioRuntime, setLMStudioRuntime] = useState<LMStudioAdvisorRuntime | null>(null)
  const activeRuntime = runtimeChoice === 'hosted' ? hostedRuntime ?? fallbackRuntime : (runtimeId === 'lmstudio' ? lmStudioRuntime : ollamaRuntime) ?? fallbackRuntime
  const kernel = useMemo(() => createAdvisorKernel(source, activeRuntime), [activeRuntime, source])
  const probeController = useRef<AbortController | null>(null)

  const checkLocalRuntime = useCallback(async (requestedRuntime: AdvisorLocalRuntimeId = runtimeId) => {
    probeController.current?.abort()
    const controller = new AbortController()
    probeController.current = controller
    const runtimeName = requestedRuntime === 'lmstudio' ? 'LM Studio' : 'Ollama'
    setRuntimeState({ runtime: requestedRuntime, status: 'checking', detail: 'Checking for a local ' + runtimeName + ' model…', models: [], modelState: 'unavailable', toolCall: 'unknown' })
    try {
      const result = requestedRuntime === 'lmstudio' ? await probeLMStudio(controller.signal) : await probeOllama(controller.signal)
      if (controller.signal.aborted) return
      if (result.available && result.models[0]) {
        const selected = runtimeModel && result.models.includes(runtimeModel) ? runtimeModel : result.models[0]
        setRuntimeModel(selected)
        if (requestedRuntime === 'lmstudio') {
          setLMStudioRuntime(new LMStudioAdvisorRuntime({ model: selected, availability: 'ready' }))
          setOllamaRuntime(null)
        } else {
          setOllamaRuntime(new OllamaAdvisorRuntime({ model: selected, availability: 'ready' }))
          setLMStudioRuntime(null)
        }
        const capabilityProfiles = (result as { capabilities?: Array<{ modelId: string; toolCall: AdvisorRuntimeState['toolCall'] }> }).capabilities ?? []
        const capability = capabilityProfiles.find(profile => profile.modelId === selected)
        setRuntimeState({ runtime: requestedRuntime, status: 'ready', detail: result.detail, models: result.models, modelState: 'discovered', toolCall: capability?.toolCall ?? 'unknown' })
      } else {
        setRuntimeModel(null)
        if (requestedRuntime === 'lmstudio') setLMStudioRuntime(null)
        else setOllamaRuntime(null)
        setRuntimeState({ runtime: requestedRuntime, status: 'unavailable', detail: result.detail, models: [], modelState: 'unavailable', toolCall: 'unknown' })
      }
    } catch (error) {
      if (!isCancelled(error)) setRuntimeState({ runtime: requestedRuntime, status: 'unavailable', detail: 'Local runtime probe was cancelled or failed.', models: [], modelState: 'unavailable', toolCall: 'unknown' })
    }
  }, [runtimeId, runtimeModel])
  useEffect(() => {
    void checkLocalRuntime()
    return () => probeController.current?.abort()
  }, [checkLocalRuntime])

  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null)
  const [streamPreview, setStreamPreview] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const requestController = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)
  const invalidateAdvisorRequest = useCallback(() => {
    requestGenerationRef.current += 1
    requestController.current?.abort()
    requestController.current = null
    setLoadingQuestion(null)
    setStreamPreview('')
    setToolStatus(null)
  }, [])
  const hostedProbeController = useRef<AbortController | null>(null)
  const checkHostedRuntime = useCallback(async (requestedProvider: 'openai' | 'anthropic' | 'gemini' = hostedProvider, resetSelection = false) => {
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
      if (isCurrentRequest() && !isCancelled(caught)) {
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
  const [conversations, setConversations] = useState<AdvisorConversation[]>(() => [{ id: makeId('chat'), title: 'New investigation', messages: [] }])
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0]!.id)
  const [historyQuery, setHistoryQuery] = useState('')
  const [composer, setComposer] = useState('')
  const [credentialEntry, setCredentialEntry] = useState('')
  const [credentialSaving, setCredentialSaving] = useState(false)
  const hostedConfigRef = useRef({ runtimeChoice, hostedRuntime, hostedConsent })
  hostedConfigRef.current = { runtimeChoice, hostedRuntime, hostedConsent }
  useEffect(() => { setCredentialEntry('') }, [hostedProvider])
  const [error, setError] = useState<string | null>(null)
  const [failedRequest, setFailedRequest] = useState<AdvisorFailedRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)
  useEffect(() => () => invalidateAdvisorRequest(), [invalidateAdvisorRequest])

  useEffect(() => {
    if (!normalizedContextualLaunch || !contextualScope) return
    setScope(contextualScope)
    setComposer(normalizedContextualLaunch.suggestedPrompt ?? '')
    setNotice(`Context from ${advisorContextualSurfaceLabel(normalizedContextualLaunch.originatingSection)} loaded. Review the suggested investigation before sending.`)
    setSelectedAnswerId(null)
  }, [contextualScope, normalizedContextualLaunch])

  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId) ?? conversations[0]!
  const messages = activeConversation.messages
  const selectedAnswer = answerForMessage(messages, selectedAnswerId)

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
    if (currentHosted.runtimeChoice === 'hosted' && (!currentHosted.hostedRuntime || !currentHosted.hostedConsent)) {
      setNotice(currentHosted.hostedRuntime ? 'Confirm the hosted-provider evidence sharing notice before investigating.' : 'Connect a hosted provider credential before investigating.')
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
    try {
      const answer = await kernel.investigate({
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
        signal: controller.signal,
        onToolEvent: event => { if (isCurrentRequest()) setToolStatus(event.status === 'started' ? 'Investigating ' + event.name.replaceAll('_', ' ') + '…' : null) },
        onDelta: text => { if (isCurrentRequest()) setStreamPreview(text) },
      })
      if (!isCurrentRequest()) return
      const assistantMessage: AdvisorMessage = { id: makeId('assistant'), role: 'assistant', answer, scopeFingerprint: requestedScopeFingerprint }
      updateConversation(conversationId, conversation => ({ ...conversation, messages: [...conversation.messages, assistantMessage] }))
      setSelectedAnswerId(assistantMessage.id)
    } catch (caught) {
      if (!isCurrentRequest()) return
      if (isCancelled(caught)) setNotice('Investigation cancelled. Your conversation stays local to this session.')
      else {
        setFailedRequest({
          question,
          scope: { ...requestedScope, range: requestedScope.range ? { ...requestedScope.range } : null },
          conversationId,
          conversation: history.map(turn => ({ ...turn })),
        })
        setError(caught instanceof Error ? caught.message : 'Advisor could not complete this investigation.')
      }
    } finally {
      if (requestGenerationRef.current !== requestId) return
      if (requestController.current === controller) requestController.current = null
      setLoadingQuestion(null)
      setStreamPreview('')
      setToolStatus(null)
    }
  }, [activeConversationId, contextualScopeMode, conversations, invalidateAdvisorRequest, kernel, loadingQuestion, overview.data, overview.loading, overview.switching, period, projectScopeId, provider, range?.from, range?.to, scope, updateConversation])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void ask(composer)
  }
  const composerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void ask(composer)
    }
  }
  const cancel = () => {
    invalidateAdvisorRequest()
    setNotice('Cancelling investigation…')
  }
  const newConversation = () => {
    const next: AdvisorConversation = { id: makeId('chat'), title: 'New investigation', messages: [] }
    setConversations(current => [next, ...current])
    setActiveConversationId(next.id)
    setSelectedAnswerId(null)
    setError(null)
    setNotice(null)
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
    setRuntimeModel(model)
    if (runtimeId === 'lmstudio') setLMStudioRuntime(new LMStudioAdvisorRuntime({ model, availability: 'ready' }))
    else setOllamaRuntime(new OllamaAdvisorRuntime({ model, availability: 'ready' }))
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
  const latestAnswer = selectedAnswer ?? answerForMessage(messages, null)
  const suppliedOverviewMatchesScope = scope.period === period
    && scope.provider === provider
    && scope.projectId === projectScopeId
    && scope.range?.from === range?.from
    && scope.range?.to === range?.to
    && scope.model === null
    && !overview.loading
    && !overview.switching

  return (
    <section className="advisor-workspace" aria-label="Metrora Advisor">
      <aside className="advisor-history" aria-label="Advisor conversations">
        <div className="advisor-history-head">
          <div className="advisor-brand"><span className="advisor-orb">M</span><div><strong>Advisor</strong><small>Evidence, in plain language</small></div></div>
          <button className="advisor-new-chat" type="button" onClick={newConversation}>＋ New chat</button>
        </div>
        <label className="advisor-search"><span aria-hidden="true">⌕</span><input aria-label="Search Advisor history" placeholder="Search this session" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} /></label>
        <div className="advisor-history-list">
          {filteredConversations.map(conversation => (
            <button key={conversation.id} type="button" className={conversation.id === activeConversationId ? 'advisor-history-item active' : 'advisor-history-item'} onClick={() => setActiveConversationId(conversation.id)}>
              <span>{conversation.title}</span><small>{conversation.messages.length ? conversation.messages.length + ' messages' : 'Ready to explore'}</small>
            </button>
          ))}
        </div>
        <div className="advisor-history-foot">Session-local history · never synced</div>
      </aside>

      <main className="advisor-main">
        <header className="advisor-main-head">
          <div><p className="advisor-kicker">ADVISE · READ ONLY</p><h1>Ask Metrora</h1><p className="advisor-subtitle">Investigate measured usage, model efficiency, Projects, and provider capacity.</p></div>
          <AdvisorRuntimeControls
            runtimeChoice={runtimeChoice}
            runtimeId={runtimeId}
            runtimeModel={runtimeModel}
            runtimeState={runtimeState}
            hostedProvider={hostedProvider}
            hostedModel={hostedModel}
            hostedProbe={hostedProbe}
            hostedConsent={hostedConsent}
            hasHostedRuntime={Boolean(hostedRuntime)}
            configureOpen={configureOpen}
            credentialEntry={credentialEntry}
            credentialSaving={credentialSaving}
            onToggleConfigure={() => setConfigureOpen(current => !current)}
            onCheckHostedRuntime={() => void checkHostedRuntime()}
            onActivateLocal={activateLocal}
            onHostedProviderChange={updateHostedProvider}
            onHostedModelChange={updateHostedModel}
            onHostedConsentChange={updateHostedConsent}
            onCredentialEntryChange={setCredentialEntry}
            onSaveHostedCredential={() => void saveHostedCredential()}
            onClearHostedCredential={() => void clearHostedCredential()}
            onCheckLocalRuntime={() => void checkLocalRuntime()}
            onActivateHosted={activateHosted}
            onLocalRuntimeChange={updateLocalRuntime}
            onLocalModelChange={updateLocalModel}
          />
        </header>
        <div className="advisor-scope-bar" aria-label="Advisor context">
          <span className="advisor-scope-label">Context</span>
          {normalizedContextualLaunch ? <span className="advisor-contextual-origin">From {advisorContextualSurfaceLabel(normalizedContextualLaunch.originatingSection)}</span> : null}
          {contextualScopeMode === 'capacity' ? (
            <span className="advisor-contextual-authority">Provider-reported now · All providers; Project and history do not scope Capacity.</span>
          ) : (
            <>
              <label>Period<select aria-label="Advisor period" value={scope.period} onChange={event => setScope(current => ({ ...current, period: event.target.value as Period }))}>{PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {contextualScopeMode === 'compare' ? <span className="advisor-contextual-authority">Compare uses period + provider; custom dates and Project are not part of Compare.</span> : <label>Project<select aria-label="Advisor Project" value={scope.projectId} onChange={event => { const id = event.target.value; setScope(current => ({ ...current, projectId: id, projectName: id === 'all' ? 'All projects' : projectOptions.find(option => option.id === id)?.name ?? id })) }}><option value="all">All projects</option>{projectOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
              <label>Provider<select aria-label="Advisor provider" value={scope.provider} onChange={event => setScope(current => ({ ...current, provider: event.target.value }))}>{providerOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label>Model<select aria-label="Advisor model" value={scope.model ?? ''} onChange={event => setScope(current => ({ ...current, model: event.target.value || null }))}><option value="">All models</option>{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
            </>
          )}
          <span className="advisor-read-only">Read-only · {contextualScopeLabel(scope, contextualScopeMode)}</span>
        </div>
        {runtimeChoice !== 'hosted' && runtimeState.status === 'unavailable' ? <div className="advisor-runtime-note"><strong>No local model connected.</strong> You can still use the explicit offline evidence fallback; connect a supported local runtime to unlock free-form model conversation and tool calls. <button type="button" onClick={() => void checkLocalRuntime()}>Try again</button></div> : null}
        {overview.error && !overview.data ? <div className="advisor-runtime-note warning"><strong>Canonical Metrora data is unavailable.</strong> {overview.error.message}</div> : null}
        <div className="advisor-thread" aria-live="polite">
          {messages.length === 0 ? (
            <div className="advisor-welcome">
              <span className="advisor-welcome-mark">M</span>
              <p className="advisor-kicker">METRORA INVESTIGATION</p>
              <h2>What should we look into?</h2>
              <p>Ask naturally. Advisor connects your question to Metrora factual evidence; a configured runtime can help explain it while verified details remain the authority.</p>
              <div className="advisor-prompt-grid">{PROMPTS.map(prompt => <button key={prompt.question} type="button" className="advisor-prompt" onClick={() => void ask(prompt.question)}><small>{prompt.eyebrow}</small><span>{prompt.label}</span><i>↗</i></button>)}</div>
            </div>
          ) : (
            messages.map(message => message.role === 'user'
              ? <article key={message.id} className="advisor-message user-message"><div className="advisor-message-label">You</div><p>{message.text}</p></article>
              : <AnswerCard key={message.id} answer={message.answer!} selected={selectedAnswerId === message.id} onSelect={() => setSelectedAnswerId(message.id)} onFollowUp={next => void ask(next)} />
            )
          )}
          {loadingQuestion ? <article className="advisor-message assistant-message pending"><div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Advisor</div><p className="advisor-tool-progress">{toolStatus ?? 'Investigating with Metrora evidence…'}</p>{streamPreview ? <p className="advisor-stream-preview">{streamPreview}</p> : null}<button type="button" className="advisor-cancel" onClick={cancel}>Cancel</button></article> : null}
          {error ? <div className="advisor-error" role="alert"><strong>Investigation unavailable.</strong> {error}<button type="button" onClick={() => { if (failedRequest) { setActiveConversationId(failedRequest.conversationId); void ask(failedRequest.question, failedRequest) } }}>Retry</button></div> : null}
          {notice ? <div className="advisor-notice" role="status">{notice}</div> : null}
        </div>
        <form className="advisor-composer" onSubmit={submit}>
          <textarea aria-label="Ask Metrora Advisor" placeholder="Ask about spend, models, Projects, sessions, or quota…" value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={composerKeyDown} disabled={Boolean(loadingQuestion)} rows={2} />
          <div className="advisor-composer-foot"><span>Enter to investigate · Shift+Enter for a new line</span>{loadingQuestion ? <button type="button" className="advisor-cancel" onClick={cancel}>Cancel</button> : <button type="submit" className="advisor-send" disabled={!composer.trim()}>Investigate <span>↗</span></button>}</div>
        </form>
      </main>

      <aside className="advisor-evidence" aria-label="Advisor evidence">
        <div className="advisor-evidence-head"><p className="advisor-kicker">PROGRESSIVE DISCLOSURE</p><h2>Evidence</h2><span>Facts stay here. The model is not the authority.</span></div>
        {latestAnswer ? <div className="advisor-evidence-body"><div className={'advisor-coverage-card ' + latestAnswer.coverage.level}><span>{latestAnswer.coverage.label}</span><p>{latestAnswer.coverage.detail}</p></div><div className="advisor-evidence-section"><h3>Scope</h3><p>{latestAnswer.scopeLabel}</p><p>{latestAnswer.periodLabel}</p></div><div className="advisor-evidence-section"><h3>Sources</h3>{latestAnswer.evidence.map(ref => <div className="advisor-ref" key={ref.id}><i />{ref.label}</div>)}</div><div className="advisor-evidence-section"><h3>Assumptions</h3>{latestAnswer.assumptions.map((item, index) => <p className="advisor-muted-line" key={index}>{item}</p>)}</div><div className="advisor-evidence-section"><h3>Unknown</h3>{latestAnswer.unknown.map((item, index) => <p className="advisor-muted-line" key={index}>{item}</p>)}</div>{latestAnswer.nextInvestigations.length ? <div className="advisor-evidence-section"><h3>Next investigation</h3>{latestAnswer.nextInvestigations.map(next => <button type="button" className="advisor-next-link" key={next} onClick={() => void ask(next)}>{next} <span>↗</span></button>)}</div> : null}</div> : <div className="advisor-evidence-empty"><span>✦</span><p>Ask a question to pin its evidence, scope, coverage, and unknowns here.</p></div>}
      </aside>
    </section>
  )
}
