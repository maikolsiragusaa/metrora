import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import { PERIOD_OPTIONS } from '../components/TopBar'
import { createAdvisorDataSource } from '../advisor/source'
import { createAdvisorKernel } from '../advisor/kernel'
import { createAdvisorRuntime } from '../advisor/runtime'
import { OllamaAdvisorRuntime, probeOllama, type OllamaProbeResult } from '../advisor/ollama'
import { scopeLabel } from '../advisor/evidence'
import type { AdvisorAnswer, AdvisorConversationTurn, AdvisorScope } from '../advisor/types'

type DetectedProvider = { id: string; label: string }
type AdvisorMessage = { id: string; role: 'user' | 'assistant'; text?: string; answer?: AdvisorAnswer }
type AdvisorConversation = { id: string; title: string; messages: AdvisorMessage[] }
type RuntimeState = { status: 'checking' | 'ready' | 'unavailable'; detail: string; models: string[] }

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
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({ status: 'checking', detail: 'Checking for a local Ollama model…', models: [] })
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null)
  const [ollamaRuntime, setOllamaRuntime] = useState<OllamaAdvisorRuntime | null>(null)
  const activeRuntime = ollamaRuntime ?? fallbackRuntime
  const kernel = useMemo(() => createAdvisorKernel(source, activeRuntime), [activeRuntime, source])
  const probeController = useRef<AbortController | null>(null)

  const checkLocalRuntime = useCallback(async () => {
    probeController.current?.abort()
    const controller = new AbortController()
    probeController.current = controller
    setRuntimeState({ status: 'checking', detail: 'Checking for a local Ollama model…', models: [] })
    try {
      const result: OllamaProbeResult = await probeOllama(controller.signal)
      if (controller.signal.aborted) return
      if (result.available && result.models[0]) {
        const selected = runtimeModel && result.models.includes(runtimeModel) ? runtimeModel : result.models[0]
        setRuntimeModel(selected)
        setOllamaRuntime(new OllamaAdvisorRuntime({ model: selected, availability: 'ready' }))
        setRuntimeState({ status: 'ready', detail: result.detail, models: result.models })
      } else {
        setRuntimeModel(null)
        setOllamaRuntime(null)
        setRuntimeState({ status: 'unavailable', detail: result.detail, models: [] })
      }
    } catch (error) {
      if (!isCancelled(error)) setRuntimeState({ status: 'unavailable', detail: 'Local runtime probe was cancelled or failed.', models: [] })
    }
  }, [runtimeModel])
  useEffect(() => {
    void checkLocalRuntime()
    return () => probeController.current?.abort()
  }, [checkLocalRuntime])

  const [conversations, setConversations] = useState<AdvisorConversation[]>(() => [{ id: makeId('chat'), title: 'New investigation', messages: [] }])
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0]!.id)
  const [historyQuery, setHistoryQuery] = useState('')
  const [composer, setComposer] = useState('')
  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null)
  const [streamPreview, setStreamPreview] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)
  const requestController = useRef<AbortController | null>(null)

  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId) ?? conversations[0]!
  const messages = activeConversation.messages
  const selectedAnswer = answerForMessage(messages, selectedAnswerId)

  const updateActiveConversation = useCallback((update: (conversation: AdvisorConversation) => AdvisorConversation) => {
    setConversations(current => current.map(conversation => conversation.id === activeConversationId ? update(conversation) : conversation))
  }, [activeConversationId])

  const ask = useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim()
    if (!question || loadingQuestion) return
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    const history: AdvisorConversationTurn[] = messages.map(message => ({ role: message.role, content: message.role === 'user' ? message.text ?? '' : message.answer?.conclusion ?? '' }))
    const userMessage: AdvisorMessage = { id: makeId('user'), role: 'user', text: question }
    updateActiveConversation(conversation => ({
      ...conversation,
      title: conversation.messages.length === 0 ? question.slice(0, 42) : conversation.title,
      messages: [...conversation.messages, userMessage],
    }))
    setComposer('')
    setError(null)
    setNotice(null)
    setLoadingQuestion(question)
    setStreamPreview('')
    setToolStatus(null)
    try {
      const answer = await kernel.investigate({
        question,
        scope,
        overview: suppliedOverviewMatchesScope ? overview.data : null,
        conversation: history,
        signal: controller.signal,
        onToolEvent: event => setToolStatus(event.status === 'started' ? 'Investigating ' + event.name.replaceAll('_', ' ') + '…' : null),
        onDelta: text => setStreamPreview(text),
      })
      if (controller.signal.aborted) return
      const assistantMessage: AdvisorMessage = { id: makeId('assistant'), role: 'assistant', answer }
      updateActiveConversation(conversation => ({ ...conversation, messages: [...conversation.messages, assistantMessage] }))
      setSelectedAnswerId(assistantMessage.id)
    } catch (caught) {
      if (isCancelled(caught)) setNotice('Investigation cancelled. Your conversation stays local to this session.')
      else setError(caught instanceof Error ? caught.message : 'Advisor could not complete this investigation.')
    } finally {
      if (requestController.current === controller) requestController.current = null
      setLoadingQuestion(null)
      setStreamPreview('')
      setToolStatus(null)
    }
  }, [kernel, loadingQuestion, messages, overview.data, scope, updateActiveConversation])

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
  const filteredConversations = conversations.filter(conversation => conversation.title.toLowerCase().includes(historyQuery.trim().toLowerCase()))
  const runtimeLabel = runtimeState.status === 'ready' && ollamaRuntime ? ollamaRuntime.label : 'Offline evidence fallback'
  const runtimeDescription = runtimeState.status === 'ready' && ollamaRuntime
    ? 'Local Ollama model · read-only evidence tools · capability varies by model'
    : 'Deterministic evidence fallback · no model connected'
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
            <span className={runtimeState.status === 'ready' ? 'advisor-status-dot ready' : 'advisor-status-dot'} />
            <div><strong>{runtimeLabel}</strong><small>{runtimeDescription} · {runtimeState.detail}</small></div>
            <button type="button" className="advisor-quiet-button" onClick={() => void checkLocalRuntime()}>{runtimeState.status === 'checking' ? 'Checking…' : 'Check local model'}</button>
            {runtimeState.models.length ? <label className="advisor-runtime-picker">Runtime<select aria-label="Advisor local runtime model" value={runtimeModel ?? runtimeState.models[0]} onChange={event => { const model = event.target.value; setRuntimeModel(model); setOllamaRuntime(new OllamaAdvisorRuntime({ model, availability: 'ready' })) }}>{runtimeState.models.map(model => <option key={model} value={model}>{model}</option>)}</select></label> : null}
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
        {runtimeState.status === 'unavailable' ? <div className="advisor-runtime-note"><strong>No local model connected.</strong> You can still use the explicit offline evidence fallback; connect Ollama to unlock free-form model conversation and tool calls. <button type="button" onClick={() => void checkLocalRuntime()}>Try again</button></div> : null}
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
              : <article key={message.id} className={selectedAnswerId === message.id ? 'advisor-message assistant-message selected' : 'advisor-message assistant-message'} onClick={() => setSelectedAnswerId(message.id)}><div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Advisor <small>{message.answer?.generatedByModel ? 'local model' : 'offline evidence'}</small></div><p className="advisor-conclusion">{displayAnswer(message.answer!)}</p><div className="advisor-answer-meta"><span className={'advisor-coverage ' + message.answer?.coverage.level}>{message.answer?.coverage.label}</span><span>{message.answer?.scopeLabel}</span></div><details onClick={event => event.stopPropagation()}><summary>Evidence & limits</summary><div className="advisor-details">{message.answer?.details.map((detail, index) => <div key={index}>{detail}</div>)}</div><div className="advisor-limits"><strong>Unknown / limits</strong>{message.answer?.unknown.map((item, index) => <div key={index}>{item}</div>)}</div></details>{message.answer?.nextInvestigations.length ? <div className="advisor-followups"><span>Continue with</span>{message.answer.nextInvestigations.map(next => <button type="button" key={next} onClick={event => { event.stopPropagation(); void ask(next) }}>{next}</button>)}</div> : null}</article>
            )
          )}
          {loadingQuestion ? <article className="advisor-message assistant-message pending"><div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Advisor</div><p className="advisor-tool-progress">{toolStatus ?? 'Thinking with local evidence…'}</p>{streamPreview ? <p className="advisor-stream-preview">{streamPreview}</p> : null}<button type="button" className="advisor-cancel" onClick={cancel}>Cancel</button></article> : null}
          {error ? <div className="advisor-error" role="alert"><strong>Investigation unavailable.</strong> {error}<button type="button" onClick={() => void ask(composer || loadingQuestion || '')}>Retry</button></div> : null}
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
