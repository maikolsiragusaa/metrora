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
import { scopeLabel } from '../advisor/evidence'
import { advisorScopeFingerprint, type AdvisorAnswer, type AdvisorConversationTurn, type AdvisorLocalRuntimeId, type AdvisorScope } from '../advisor/types'

type DetectedProvider = { id: string; label: string }
type AdvisorMessage = { id: string; role: 'user' | 'assistant'; text?: string; answer?: AdvisorAnswer; scopeFingerprint: string }
type AdvisorConversation = { id: string; title: string; messages: AdvisorMessage[] }
type AdvisorFailedRequest = { question: string; scope: AdvisorScope; conversationId: string; conversation: AdvisorConversationTurn[] }
type RuntimeState = { runtime: AdvisorLocalRuntimeId; status: 'checking' | 'ready' | 'unavailable'; detail: string; models: string[]; toolCall: 'unknown' | 'supported' | 'unsupported' | 'failed-conformance' }

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

export function Advisor({
  period,
  provider,
  projectScopeId = 'all',
  range = null,
  overview,
  detectedProviders,
}: {
  period: Period
  provider: string
  projectScopeId?: string
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  detectedProviders: DetectedProvider[]
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

  const [scope, setScope] = useState<AdvisorScope>(() => ({
    period,
    range,
    provider,
    projectId: projectScopeId,
    projectName,
    model: null,
  }))
  useEffect(() => {
    setScope(current => ({ ...current, period, range, provider, projectId: projectScopeId, projectName }))
  }, [period, provider, projectScopeId, projectName, range])
  useEffect(() => {
    if (scope.model && !modelOptions.includes(scope.model)) setScope(current => ({ ...current, model: null }))
  }, [modelOptions, scope.model])

  const source = useMemo(() => createAdvisorDataSource(metrora), [])
  const fallbackRuntime = useMemo(() => createAdvisorRuntime(), [])
  const [runtimeId, setRuntimeId] = useState<AdvisorLocalRuntimeId>('ollama')
  const [runtimeChoice, setRuntimeChoice] = useState<RuntimeChoice>('ollama')
  const [hostedProvider, setHostedProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai')
  const [hostedProbe, setHostedProbe] = useState<Awaited<ReturnType<typeof probeHostedAdvisor>> | null>(null)
  const [hostedModel, setHostedModel] = useState<string | null>(null)
  const [hostedRuntime, setHostedRuntime] = useState<HostedAdvisorRuntime | null>(null)
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({ runtime: 'ollama', status: 'checking', detail: 'Checking for a local Ollama model…', models: [], toolCall: 'unknown' })
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
    setRuntimeState({ runtime: requestedRuntime, status: 'checking', detail: 'Checking for a local ' + runtimeName + ' model…', models: [], toolCall: 'unknown' })
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
        const capabilityProfiles = (result as { capabilities?: Array<{ modelId: string; toolCall: RuntimeState['toolCall'] }> }).capabilities ?? []
        const capability = capabilityProfiles.find(profile => profile.modelId === selected)
        setRuntimeState({ runtime: requestedRuntime, status: 'ready', detail: result.detail, models: result.models, toolCall: capability?.toolCall ?? 'unknown' })
      } else {
        setRuntimeModel(null)
        if (requestedRuntime === 'lmstudio') setLMStudioRuntime(null)
        else setOllamaRuntime(null)
        setRuntimeState({ runtime: requestedRuntime, status: 'unavailable', detail: result.detail, models: [], toolCall: 'unknown' })
      }
    } catch (error) {
      if (!isCancelled(error)) setRuntimeState({ runtime: requestedRuntime, status: 'unavailable', detail: 'Local runtime probe was cancelled or failed.', models: [], toolCall: 'unknown' })
    }
  }, [runtimeId, runtimeModel])
  useEffect(() => {
    void checkLocalRuntime()
    return () => probeController.current?.abort()
  }, [checkLocalRuntime])

  const hostedProbeController = useRef<AbortController | null>(null)
  const checkHostedRuntime = useCallback(async (requestedProvider: 'openai' | 'anthropic' | 'gemini' = hostedProvider) => {
    hostedProbeController.current?.abort()
    const controller = new AbortController()
    hostedProbeController.current = controller
    try {
      const result = await probeHostedAdvisor(requestedProvider, controller.signal)
      if (controller.signal.aborted) return
      setHostedProbe(result)
      const selectable = result.models.find(model => model.state !== 'unsupported')
      if (result.available && selectable) {
        setHostedModel(current => current && result.models.some(model => model.id === current && model.state !== 'unsupported') ? current : selectable.id)
        setHostedRuntime(current => current && current.label.endsWith(selectable.id.replace(/^models\//u, '')) ? current : new HostedAdvisorRuntime({ provider: requestedProvider, model: selectable.id, consent: false }))
      } else {
        setHostedModel(null)
        setHostedRuntime(null)
      }
    } catch (caught) {
      if (!isCancelled(caught)) {
        setHostedProbe({ provider: requestedProvider, available: false, models: [], detail: 'Hosted provider probe failed.', credentialState: 'ready' })
        setHostedRuntime(null)
      }
    }
  }, [hostedProvider])
  useEffect(() => {
    if (runtimeChoice !== 'hosted') return
    void checkHostedRuntime()
    return () => hostedProbeController.current?.abort()
  }, [checkHostedRuntime, runtimeChoice])
  const [conversations, setConversations] = useState<AdvisorConversation[]>(() => [{ id: makeId('chat'), title: 'New investigation', messages: [] }])
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0]!.id)
  const [historyQuery, setHistoryQuery] = useState('')
  const [composer, setComposer] = useState('')
  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null)
  const [credentialEntry, setCredentialEntry] = useState('')
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [hostedConsent, setHostedConsent] = useState(false)
  const hostedConfigRef = useRef({ runtimeChoice, hostedRuntime, hostedConsent })
  hostedConfigRef.current = { runtimeChoice, hostedRuntime, hostedConsent }
  useEffect(() => { setCredentialEntry('') }, [hostedProvider])
  const [streamPreview, setStreamPreview] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failedRequest, setFailedRequest] = useState<AdvisorFailedRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)
  const requestController = useRef<AbortController | null>(null)

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
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
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
        overview: requestedScope.period === period
          && requestedScope.provider === provider
          && requestedScope.projectId === projectScopeId
          && requestedScope.range?.from === range?.from
          && requestedScope.range?.to === range?.to
          && requestedScope.model === null
          && !overview.loading
          && !overview.switching ? overview.data : null,
        conversation: history,
        signal: controller.signal,
        onToolEvent: event => setToolStatus(event.status === 'started' ? 'Investigating ' + event.name.replaceAll('_', ' ') + '…' : null),
        onDelta: text => setStreamPreview(text),
      })
      if (controller.signal.aborted) return
      const assistantMessage: AdvisorMessage = { id: makeId('assistant'), role: 'assistant', answer, scopeFingerprint: requestedScopeFingerprint }
      updateConversation(conversationId, conversation => ({ ...conversation, messages: [...conversation.messages, assistantMessage] }))
      setSelectedAnswerId(assistantMessage.id)
    } catch (caught) {
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
      if (requestController.current === controller) requestController.current = null
      setLoadingQuestion(null)
      setStreamPreview('')
      setToolStatus(null)
    }
  }, [activeConversationId, conversations, kernel, loadingQuestion, overview.data, overview.loading, overview.switching, period, projectScopeId, provider, range?.from, range?.to, scope, updateConversation])

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
    requestController.current?.abort()
    setNotice('Cancelling the local investigation…')
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
    setRuntimeChoice('hosted')
    setHostedConsent(false)
    void checkHostedRuntime()
  }
  const activateLocal = () => {
    setRuntimeChoice(runtimeId)
    setHostedConsent(false)
  }
  const updateHostedConsent = (consent: boolean) => {
    setHostedConsent(consent)
    setHostedRuntime(current => current && hostedModel ? new HostedAdvisorRuntime({ provider: hostedProvider, model: hostedModel, consent }) : current)
  }
  const saveHostedCredential = async () => {
    if (!credentialEntry.trim() || credentialSaving) return
    setCredentialSaving(true)
    try {
      const status = await metrora.advisorCredentialSet(hostedProvider, credentialEntry)
      setNotice(status.state === 'ready' ? 'Provider credential saved in protected local storage.' : 'Provider credential was not saved: ' + status.state + '.')
      await checkHostedRuntime(hostedProvider)
    } catch {
      setNotice('Provider credential could not be saved. Enter it again.')
    } finally {
      setCredentialEntry('')
      setCredentialSaving(false)
    }
  }
  const clearHostedCredential = async () => {
    try {
      await metrora.advisorCredentialClear(hostedProvider)
      setHostedConsent(false)
      setNotice('Provider credential removed from this device.')
      await checkHostedRuntime(hostedProvider)
    } catch {
      setNotice('Provider credential could not be removed.')
    }
  }
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredConversations = conversations.filter(conversation => !normalizedHistoryQuery || [
    conversation.title,
    ...conversation.messages.map(message => message.text ?? message.answer?.conclusion ?? ''),
  ].some(value => value.toLowerCase().includes(normalizedHistoryQuery)))
  const selectedModelRuntime = runtimeId === 'lmstudio' ? lmStudioRuntime : ollamaRuntime
  const displayedRuntime = runtimeChoice === 'hosted' ? hostedRuntime : selectedModelRuntime
  const displayedReady = runtimeChoice === 'hosted'
    ? Boolean(hostedProbe?.available && hostedRuntime)
    : runtimeState.status === 'ready' && Boolean(selectedModelRuntime)
  const runtimeLabel = displayedReady && displayedRuntime ? displayedRuntime.label : 'Offline evidence fallback'
  const runtimeDescription = runtimeChoice === 'hosted'
    ? 'Hosted provider account · minimum evidence sent directly · no Metrora proxy'
    : runtimeState.status === 'ready' && selectedModelRuntime
      ? (runtimeId === 'lmstudio' ? 'Local LM Studio model' : 'Local Ollama model') + ' · read-only evidence tools · tool support varies by model'
      : 'Deterministic evidence fallback · no model connected'
  const runtimeDetail = runtimeChoice === 'hosted'
    ? hostedProbe?.detail ?? 'Choose a hosted provider and connect a credential.'
    : runtimeState.detail
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
          <div className="advisor-runtime-status">
            <span className={displayedReady ? 'advisor-status-dot ready' : 'advisor-status-dot'} />
            <div><strong>{runtimeLabel}</strong><small>{runtimeDescription} · {runtimeDetail}</small></div>
            {runtimeChoice === 'hosted'
              ? <button type="button" className="advisor-quiet-button" onClick={() => void checkHostedRuntime()}>{hostedProbe?.available ? 'Refresh hosted models' : 'Check hosted provider'}</button>
              : <button type="button" className="advisor-quiet-button" onClick={() => void checkLocalRuntime()}>{runtimeState.status === 'checking' ? 'Checking…' : 'Check local model'}</button>}
            {runtimeChoice === 'hosted' ? <>
              <button type="button" className="advisor-quiet-button" onClick={activateLocal}>Use local runtime</button>
              <div className="advisor-hosted-controls">
                <label className="advisor-runtime-picker">Provider<select aria-label="Advisor hosted provider" value={hostedProvider} onChange={event => { const next = event.target.value as 'openai' | 'anthropic' | 'gemini'; setHostedProvider(next); setHostedProbe(null); setHostedModel(null); setHostedRuntime(null); setHostedConsent(false); void checkHostedRuntime(next) }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label>
                {hostedProbe?.models.filter(model => model.state !== 'unsupported').length ? <label className="advisor-runtime-picker">Hosted model<select aria-label="Advisor hosted model" value={hostedModel ?? hostedProbe.models.find(model => model.state !== 'unsupported')?.id ?? ''} onChange={event => { const model = event.target.value; setHostedModel(model); setHostedRuntime(new HostedAdvisorRuntime({ provider: hostedProvider, model })); setHostedConsent(false) }}>{hostedProbe.models.filter(model => model.state !== 'unsupported').map(model => <option key={model.id} value={model.id}>{model.label} · {model.state}</option>)}</select></label> : null}
                <span className="advisor-credential-status">Credential: {hostedProbe?.credentialState ?? 'not-configured'}</span>
                {hostedProbe?.credentialState !== 'ready' ? <div className="advisor-credential-entry"><input type="password" aria-label="Advisor provider key" autoComplete="off" placeholder="Provider key (not stored in this form)" value={credentialEntry} onChange={event => setCredentialEntry(event.target.value)} /><button type="button" className="advisor-quiet-button" onClick={() => void saveHostedCredential()} disabled={credentialSaving || !credentialEntry.trim()}>{credentialSaving ? 'Saving…' : 'Save key'}</button></div> : <button type="button" className="advisor-quiet-button" onClick={() => void clearHostedCredential()}>Remove key</button>}
                {hostedRuntime ? <label className="advisor-hosted-consent"><input type="checkbox" checked={hostedConsent} onChange={event => updateHostedConsent(event.target.checked)} /> Before the first hosted investigation, send this question and minimum Metrora evidence directly to the selected provider using your account. Metrora does not proxy it; provider terms, privacy, and retention apply.</label> : null}
              </div>
            </> : <>
              <button type="button" className="advisor-quiet-button" onClick={activateHosted}>Use hosted provider</button>
              <label className="advisor-runtime-picker">Runtime<select aria-label="Advisor runtime" value={runtimeId} onChange={event => { const next = event.target.value as AdvisorLocalRuntimeId; setRuntimeId(next); setRuntimeModel(null); setHostedConsent(false); void checkLocalRuntime(next) }}><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option></select></label>
              {runtimeState.models.length ? <label className="advisor-runtime-picker">Local model<select aria-label="Advisor local runtime model" value={runtimeModel ?? runtimeState.models[0]} onChange={event => { const model = event.target.value; setRuntimeModel(model); if (runtimeId === 'lmstudio') setLMStudioRuntime(new LMStudioAdvisorRuntime({ model, availability: 'ready' })); else setOllamaRuntime(new OllamaAdvisorRuntime({ model, availability: 'ready' })) }}>{runtimeState.models.map(model => <option key={model} value={model}>{model}</option>)}</select></label> : null}
            </>}
          </div>
        </header>
        <div className="advisor-scope-bar" aria-label="Advisor context">
          <span className="advisor-scope-label">Context</span>
          <label>Period<select aria-label="Advisor period" value={scope.period} onChange={event => setScope(current => ({ ...current, period: event.target.value as Period }))}>{PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Project<select aria-label="Advisor Project" value={scope.projectId} onChange={event => { const id = event.target.value; setScope(current => ({ ...current, projectId: id, projectName: id === 'all' ? 'All projects' : projectOptions.find(option => option.id === id)?.name ?? id })) }}><option value="all">All projects</option>{projectOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label>Provider<select aria-label="Advisor provider" value={scope.provider} onChange={event => setScope(current => ({ ...current, provider: event.target.value }))}>{providerOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <label>Model<select aria-label="Advisor model" value={scope.model ?? ''} onChange={event => setScope(current => ({ ...current, model: event.target.value || null }))}><option value="">All models</option>{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
          <span className="advisor-read-only">Read-only · {scopeLabel(scope)}</span>
        </div>
        {runtimeChoice !== 'hosted' && runtimeState.status === 'unavailable' ? <div className="advisor-runtime-note"><strong>No local model connected.</strong> You can still use the explicit offline evidence fallback; connect a supported local runtime to unlock free-form model conversation and tool calls. <button type="button" onClick={() => void checkLocalRuntime()}>Try again</button></div> : null}
        {overview.error && !overview.data ? <div className="advisor-runtime-note warning"><strong>Canonical Metrora data is unavailable.</strong> {overview.error.message}</div> : null}
        <div className="advisor-thread" aria-live="polite">
          {messages.length === 0 ? (
            <div className="advisor-welcome">
              <span className="advisor-welcome-mark">M</span>
              <p className="advisor-kicker">LOCAL INVESTIGATION SPACE</p>
              <h2>What should we look into?</h2>
              <p>Ask naturally. A connected local model can call Metrora evidence tools; every number stays in verified details.</p>
              <div className="advisor-prompt-grid">{PROMPTS.map(prompt => <button key={prompt.question} type="button" className="advisor-prompt" onClick={() => void ask(prompt.question)}><small>{prompt.eyebrow}</small><span>{prompt.label}</span><i>↗</i></button>)}</div>
            </div>
          ) : (
            messages.map(message => message.role === 'user'
              ? <article key={message.id} className="advisor-message user-message"><div className="advisor-message-label">You</div><p>{message.text}</p></article>
              : <article key={message.id} className={selectedAnswerId === message.id ? 'advisor-message assistant-message selected' : 'advisor-message assistant-message'} onClick={() => setSelectedAnswerId(message.id)}><div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Advisor <small>{message.answer?.generatedByModel ? (message.answer.runtime.mode === 'hosted-byok' ? 'hosted provider' : 'local model') : 'offline evidence'}</small></div><p className="advisor-conclusion">{displayAnswer(message.answer!)}</p><div className="advisor-answer-meta"><span className={'advisor-coverage ' + message.answer?.coverage.level}>{message.answer?.coverage.label}</span><span>{message.answer?.scopeLabel}</span></div><details onClick={event => event.stopPropagation()}><summary>Evidence & limits</summary><div className="advisor-details">{message.answer?.details.map((detail, index) => <div key={index}>{detail}</div>)}</div><div className="advisor-limits"><strong>Unknown / limits</strong>{message.answer?.unknown.map((item, index) => <div key={index}>{item}</div>)}</div></details>{message.answer?.nextInvestigations.length ? <div className="advisor-followups"><span>Continue with</span>{message.answer.nextInvestigations.map(next => <button type="button" key={next} onClick={event => { event.stopPropagation(); void ask(next) }}>{next}</button>)}</div> : null}</article>
            )
          )}
          {loadingQuestion ? <article className="advisor-message assistant-message pending"><div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Advisor</div><p className="advisor-tool-progress">{toolStatus ?? 'Thinking with local evidence…'}</p>{streamPreview ? <p className="advisor-stream-preview">{streamPreview}</p> : null}<button type="button" className="advisor-cancel" onClick={cancel}>Cancel</button></article> : null}
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
type RuntimeChoice = AdvisorLocalRuntimeId | 'hosted'
