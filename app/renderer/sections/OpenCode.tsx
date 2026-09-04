import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  OpenCodeAgent,
  OpenCodeConversationMessage,
  OpenCodeEngineStatus,
  OpenCodeMcpServer,
  OpenCodeModel,
  OpenCodeProvider,
  OpenCodeProviderAuthAuthorization,
  OpenCodeProviderAuthMethods,
  OpenCodeRendererEvent,
  OpenCodeSession,
  OpenCodeTools,
  OpenCodeWorkspaceInfo,
} from '../../electron/opencode-types'
import { metrora, normalizeCliError } from '../lib/ipc'

function errorMessage(error: unknown): string {
  return normalizeCliError(error).message
}

function shortDirectory(value: string | null): string {
  if (!value) return 'No workspace selected'
  const normalized = value.replaceAll('\\', '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? value
}

function modelKey(model: Pick<OpenCodeModel, 'providerID' | 'id'>): string {
  return `${model.providerID}/${model.id}`
}

function modelRefFromKey(value: string): { providerID: string; modelID: string } | null {
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return null
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

function flattenModels(providers: OpenCodeProvider[]): OpenCodeModel[] {
  return providers.flatMap(provider => provider.models)
}

function displayTime(value: number): string {
  if (!value) return ''
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function OpenCode() {
  const [status, setStatus] = useState<OpenCodeEngineStatus | null>(null)
  const [workspace, setWorkspace] = useState<OpenCodeWorkspaceInfo | null>(null)
  const [sessions, setSessions] = useState<OpenCodeSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<OpenCodeConversationMessage[]>([])
  const [providers, setProviders] = useState<OpenCodeProvider[]>([])
  const [agents, setAgents] = useState<OpenCodeAgent[]>([])
  const [tools, setTools] = useState<OpenCodeTools | null>(null)
  const [mcp, setMcp] = useState<OpenCodeMcpServer[]>([])
  const [providerAuth, setProviderAuth] = useState<OpenCodeProviderAuthMethods>({})
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [draft, setDraft] = useState('')
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)
  const [liveText, setLiveText] = useState('')
  const [activities, setActivities] = useState<Array<{ id: string; tool: string; status: string; title: string | null }>>([])
  const [permission, setPermission] = useState<Extract<OpenCodeRendererEvent, { kind: 'permission' }> | null>(null)
  const [question, setQuestion] = useState<Extract<OpenCodeRendererEvent, { kind: 'question-asked' }> | null>(null)
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string[]>>({})
  const [questionCustomAnswers, setQuestionCustomAnswers] = useState<Record<number, string>>({})
  const [authProviderId, setAuthProviderId] = useState('')
  const [authMethodIndex, setAuthMethodIndex] = useState(0)
  const [authInputs, setAuthInputs] = useState<Record<string, string>>({})
  const [authCode, setAuthCode] = useState('')
  const [authorization, setAuthorization] = useState<OpenCodeProviderAuthAuthorization | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localPort, setLocalPort] = useState('8080')
  const [localModelId, setLocalModelId] = useState('local-model')
  const [configuringLocal, setConfiguringLocal] = useState(false)

  const selectedModelObject = useMemo(() => {
    const models = flattenModels(providers)
    return models.find(model => modelKey(model) === selectedModel) ?? null
  }, [providers, selectedModel])

  const refreshCapabilities = useCallback(async () => {
    const results = await Promise.allSettled([
      metrora.opencodeListProviders(),
      metrora.opencodeListProviderAuth(),
      metrora.opencodeListAgents(),
      metrora.opencodeListTools(),
      metrora.opencodeGetWorkspace(),
      metrora.opencodeGetMcp(),
    ])
    const [providerResult, authResult, agentResult, toolResult, workspaceResult, mcpResult] = results
    if (providerResult.status === 'fulfilled') {
      setProviders(providerResult.value)
    }
    if (authResult.status === 'fulfilled') setProviderAuth(authResult.value)
    if (agentResult.status === 'fulfilled') setAgents(agentResult.value)
    if (toolResult.status === 'fulfilled') setTools(toolResult.value)
    if (workspaceResult.status === 'fulfilled') setWorkspace(workspaceResult.value)
    if (mcpResult.status === 'fulfilled') setMcp(mcpResult.value)
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const next = await metrora.opencodeListSessions()
      setSessions(next)
      setActiveSessionId(current => current && next.some(session => session.id === current) ? current : next[0]?.id ?? null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [])

  useEffect(() => {
    const session = sessions.find(item => item.id === activeSessionId)
    if (!activeSessionId || !session) {
      setSelectedModel('')
      setSelectedVariant('')
      setSelectedAgent('')
      return
    }
    setSelectedModel(session.model ? modelKey({ providerID: session.model.providerID, id: session.model.modelID }) : '')
    setSelectedVariant(session.variant ?? '')
    setSelectedAgent(session.agent ?? '')
    setPermission(current => current?.sessionId === session.id ? current : null)
    setQuestion(current => current?.sessionId === session.id ? current : null)
  }, [activeSessionId, sessions])

  const refresh = useCallback(async () => {
    try {
      const next = await metrora.opencodeStatus()
      setStatus(next)
      if (next.state === 'ready') {
        await Promise.all([refreshCapabilities(), refreshSessions()])
      }
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [refreshCapabilities, refreshSessions])

  useEffect(() => {
    let disposed = false
    const boot = async () => {
      try {
        let next = await metrora.opencodeStatus()
        if (!disposed) setStatus(next)
        if (next.state === 'idle' || next.state === 'unavailable') {
          next = await metrora.opencodeStart()
          if (!disposed) setStatus(next)
        }
        if (!disposed && next.state === 'ready') await Promise.all([refreshCapabilities(), refreshSessions()])
      } catch (caught) {
        if (!disposed) setError(errorMessage(caught))
      }
    }
    void boot()
    const timer = window.setInterval(() => { void refresh() }, 2_500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [refresh, refreshCapabilities, refreshSessions])

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      setLiveText('')
      return
    }
    let disposed = false
    setLiveText('')
    void metrora.opencodeGetMessages(activeSessionId).then(next => {
      if (!disposed) setMessages(next)
    }).catch(caught => {
      if (!disposed) setError(errorMessage(caught))
    })
    return () => { disposed = true }
  }, [activeSessionId])

  useEffect(() => {
    const subscribe = metrora.onOpenCodeEvent
    if (typeof subscribe !== 'function') return
    return subscribe(event => {
      if (event.kind === 'message-delta' && event.sessionId === activeSessionId && event.field === 'text') setLiveText(current => current + event.text)
      if (event.kind === 'message-part-updated' && event.sessionId === activeSessionId && event.field === 'text') setLiveText(event.text)
      if (event.kind === 'tool' && event.sessionId === activeSessionId) {
        setActivities(current => {
          const next = current.filter(item => item.id !== event.partId)
          return [...next, { id: event.partId, tool: event.tool, status: event.status, title: event.title }].slice(-12)
        })
      }
      if (event.kind === 'permission' && (!activeSessionId || event.sessionId === activeSessionId)) setPermission(event)
      if (event.kind === 'permission-replied' && permission?.permissionId === event.requestId) setPermission(null)
      if (event.kind === 'question-asked' && (!activeSessionId || event.sessionId === activeSessionId)) {
        setQuestion(event)
        setQuestionAnswers({})
        setQuestionCustomAnswers({})
      }
      if ((event.kind === 'question-replied' || event.kind === 'question-rejected') && question?.requestId === event.requestId) setQuestion(null)
      if (event.kind === 'error') setError(event.message)
      if (event.kind === 'session-status' && event.status === 'idle' && event.sessionId === activeSessionId) {
        void metrora.opencodeGetMessages(event.sessionId).then(setMessages).catch(() => {})
        void refreshSessions()
      }
    })
  }, [activeSessionId, permission?.permissionId, question?.requestId, refreshSessions])

  const chooseWorkspace = async () => {
    try {
      const directory = await metrora.chooseDirectory()
      if (!directory) return
      const next = await metrora.opencodeSetWorkspace(directory)
      setStatus(next)
      setActiveSessionId(null)
      setMessages([])
      await Promise.all([refreshCapabilities(), refreshSessions()])
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const createSession = async () => {
    try {
      const session = await metrora.opencodeCreateSession('New OpenCode session')
      setSessions(current => [session, ...current.filter(item => item.id !== session.id)])
      setActiveSessionId(session.id)
      setMessages([])
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const submit = async (text = draft) => {
    const prompt = text.trim()
    if (!prompt || busyRequestId) return
    setError(null)
    setLastFailedPrompt(null)
    let sessionId = activeSessionId
    try {
      if (!sessionId) {
        const session = await metrora.opencodeCreateSession(prompt.slice(0, 80))
        sessionId = session.id
        setSessions(current => [session, ...current.filter(item => item.id !== session.id)])
        setActiveSessionId(session.id)
      }
      const requestId = `opencode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setBusyRequestId(requestId)
      setDraft('')
      setLiveText('')
      setActivities([])
      const optimistic: OpenCodeConversationMessage = {
        id: `${requestId}-user`, role: 'user', createdAt: Date.now(), text: prompt,
        model: selectedModelObject ? { providerID: selectedModelObject.providerID, modelID: selectedModelObject.id } : modelRefFromKey(selectedModel),
        variant: selectedVariant || null,
        agent: selectedAgent || null, cost: null, tokens: null, parts: [{ id: `${requestId}-part`, type: 'text', text: prompt }],
      }
      setMessages(current => [...current, optimistic])
      await metrora.opencodePrompt({
        requestId, sessionId, text: prompt,
        ...(selectedModelObject ? { model: { providerID: selectedModelObject.providerID, modelID: selectedModelObject.id } } : modelRefFromKey(selectedModel) ? { model: modelRefFromKey(selectedModel)! } : {}),
        ...(selectedAgent ? { agent: selectedAgent } : {}),
        ...(selectedVariant ? { variant: selectedVariant } : {}),
      })
      const next = await metrora.opencodeGetMessages(sessionId)
      setMessages(next)
    } catch (caught) {
      setLastFailedPrompt(prompt)
      setError(errorMessage(caught))
    } finally {
      setBusyRequestId(null)
    }
  }

  const cancel = async () => {
    if (!busyRequestId) return
    try { await metrora.opencodeCancel(busyRequestId) } catch (caught) { setError(errorMessage(caught)) }
  }

  const replyPermission = async (response: 'once' | 'always' | 'reject') => {
    if (!permission) return
    try {
      await metrora.opencodePermissionReply(permission.sessionId, permission.permissionId, response)
      setPermission(null)
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const configureLocal = async () => {
    const port = Number(localPort)
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || !localModelId.trim()) {
      setError('Enter a valid local port and model id.')
      return
    }
    setConfiguringLocal(true)
    setError(null)
    try {
      const next = await metrora.opencodeConfigureLocal({ port, modelId: localModelId.trim() })
      setStatus(next)
      if (next.state === 'ready') await Promise.all([refreshCapabilities(), refreshSessions()])
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setConfiguringLocal(false) }
  }

  const activeAuthProvider = authProviderId || (providerAuth['opencode-zen'] ? 'opencode-zen' : Object.keys(providerAuth)[0] ?? '')
  const activeAuthMethods = providerAuth[activeAuthProvider] ?? []
  const activeAuthMethod = activeAuthMethods[authMethodIndex] ?? activeAuthMethods[0] ?? null

  const updateQuestionAnswer = (questionIndex: number, label: string, multiple: boolean) => {
    setQuestionAnswers(current => {
      const existing = current[questionIndex] ?? []
      const next = multiple
        ? existing.includes(label) ? existing.filter(item => item !== label) : [...existing, label]
        : [label]
      return { ...current, [questionIndex]: next }
    })
  }

  const replyQuestion = async () => {
    if (!question) return
    try {
      const answers = question.questions.map((item, index) => {
        const selected = questionAnswers[index] ?? []
        const custom = questionCustomAnswers[index]
        return custom?.trim() ? [...selected, custom.trim()] : selected
      })
      await metrora.opencodeQuestionReply(question.requestId, answers)
      setQuestion(null)
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const rejectQuestion = async () => {
    if (!question) return
    try {
      await metrora.opencodeQuestionReject(question.requestId)
      setQuestion(null)
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const connectProvider = async () => {
    if (!activeAuthProvider || !activeAuthMethod) return
    setAuthBusy(true)
    setError(null)
    try {
      if (activeAuthMethod.type === 'api') {
        const keyPrompt = activeAuthMethod.prompts.find(prompt => prompt.type === 'text')
        const key = authInputs[keyPrompt?.key ?? 'apiKey'] ?? ''
        await metrora.opencodeSetProviderApiKey(activeAuthProvider, key)
        setAuthInputs({})
        await refreshCapabilities()
      } else {
        const inputs = Object.fromEntries(activeAuthMethod.prompts.map(prompt => [prompt.key, authInputs[prompt.key] ?? '']))
        const next = await metrora.opencodeProviderOAuthAuthorize(activeAuthProvider, authMethodIndex, inputs)
        setAuthorization(next)
        if (next.url) await metrora.openExternal(next.url)
      }
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setAuthBusy(false) }
  }

  const completeOAuth = async () => {
    if (!authorization || !activeAuthProvider) return
    setAuthBusy(true)
    setError(null)
    try {
      await metrora.opencodeProviderOAuthCallback(activeAuthProvider, authMethodIndex, authCode || undefined)
      setAuthorization(null)
      setAuthCode('')
      setAuthInputs({})
      await refreshCapabilities()
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setAuthBusy(false) }
  }

  const selectedVariants = selectedModelObject?.variants ?? []
  const displayedVariants = selectedVariant && !selectedVariants.some(variant => variant.id === selectedVariant) ? [{ id: selectedVariant, label: selectedVariant }, ...selectedVariants] : selectedVariants
  const ready = status?.state === 'ready'
  const running = busyRequestId !== null

  return (
    <div className="opencode-surface">
      <header className="opencode-header">
        <div>
          <div className="opencode-kicker">Coding engine</div>
          <h1>OpenCode</h1>
          <p>Real OpenCode sessions, tools, agents, and workspace changes.</p>
        </div>
        <div className="opencode-header-actions">
          <span className={`opencode-status opencode-status-${status?.state ?? 'starting'}`}>
            <i />{status?.state === 'ready' ? `Ready · ${status.version}` : status?.state ?? 'starting'}
          </span>
          <button className="btn btn-s" type="button" onClick={() => { void metrora.opencodeRestart().then(setStatus).catch(caught => setError(errorMessage(caught))) }}>Restart</button>
        </div>
      </header>

      <div className="opencode-layout">
        <aside className="opencode-sessions">
          <div className="opencode-panel-title"><span>Sessions</span><button className="btn btn-s" type="button" onClick={() => { void createSession() }} disabled={!ready}>New</button></div>
          {sessions.length === 0 ? <p className="opencode-muted">No sessions in this workspace.</p> : sessions.map(session => (
            <button key={session.id} type="button" className={`opencode-session${session.id === activeSessionId ? ' active' : ''}`} onClick={() => setActiveSessionId(session.id)}>
              <strong>{session.title}</strong><small>{displayTime(session.updatedAt)}{session.model ? ` · ${session.model.providerID}/${session.model.modelID}` : ' · OpenCode default'}</small>
            </button>
          ))}
        </aside>

        <main className="opencode-main">
          <section className="opencode-toolbar">
            <div className="opencode-workspace-control">
              <span className="opencode-label">Workspace</span>
              <strong title={workspace?.directory ?? status?.workspace ?? ''}>{shortDirectory(workspace?.directory ?? status?.workspace ?? null)}</strong>
              <button className="btn btn-s" type="button" onClick={() => { void chooseWorkspace() }}>Choose…</button>
              {workspace?.branch ? <span className="opencode-branch">git:{workspace.branch} · {workspace.changedFiles} changed</span> : null}
            </div>
            <div className="opencode-selects">
              <label><span>Provider / model</span><select value={selectedModel} onChange={event => { setSelectedModel(event.target.value); setSelectedVariant('') }} disabled={!ready}>
                <option value="">OpenCode default</option>
                {providers.map(provider => <optgroup key={provider.id} label={`${provider.name}${provider.connected ? '' : ' · not connected'}`}>
                  {provider.models.map(model => <option key={modelKey(model)} value={modelKey(model)}>{model.name}{model.reasoning ? ' · reasoning' : ''}</option>)}
                </optgroup>)}
              </select></label>
              <label><span>Agent</span><select value={selectedAgent} onChange={event => setSelectedAgent(event.target.value)} disabled={!ready}>
                <option value="">OpenCode default</option>
                {agents.map(agent => <option key={agent.name} value={agent.name}>{agent.name}{agent.mode === 'subagent' ? ' · subagent' : ''}</option>)}
              </select></label>
              <label><span>Reasoning variant</span><select value={selectedVariant} onChange={event => setSelectedVariant(event.target.value)} disabled={!ready || displayedVariants.length === 0}>
                <option value="">Default</option>
                {displayedVariants.map(variant => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
              </select></label>
            </div>
          </section>

          {!ready ? <div className="opencode-empty"><h2>OpenCode is not ready</h2><p>{status?.detail ?? 'Starting the bundled engine…'}</p><button className="btn" type="button" onClick={() => { void metrora.opencodeStart().then(setStatus).catch(caught => setError(errorMessage(caught))) }}>Start engine</button></div> : (
            <>
              <section className="opencode-thread" aria-live="polite">
                {messages.length === 0 && !liveText ? <div className="opencode-empty"><h2>Ready to code</h2><p>Choose a workspace and send a task. OpenCode owns the session, plan/build flow, tools, subagents, and edits.</p></div> : null}
                {messages.map(message => <MessageView key={message.id} message={message} />)}
                {liveText ? <div className="opencode-message assistant"><div className="opencode-message-meta">OpenCode · streaming</div><div className="opencode-message-text">{liveText}</div></div> : null}
                {activities.length > 0 ? <div className="opencode-activity"><strong>OpenCode activity</strong>{activities.map(activity => <div key={activity.id}><span className="opencode-activity-dot" />{activity.tool} · {activity.status}{activity.title ? ` · ${activity.title}` : ''}</div>)}</div> : null}
                {permission ? <div className="opencode-permission"><strong>OpenCode requests permission</strong><span>{permission.permission}{permission.patterns.length ? ` · ${permission.patterns.join(', ')}` : ''}</span>{permission.always.length ? <small>OpenCode may remember: {permission.always.join(', ')}</small> : null}<div><button className="btn btn-s" type="button" onClick={() => { void replyPermission('once') }}>Allow once</button><button className="btn btn-s" type="button" onClick={() => { void replyPermission('always') }}>Always allow</button><button className="btn btn-s danger" type="button" onClick={() => { void replyPermission('reject') }}>Reject</button></div></div> : null}
                {question ? <div className="opencode-question"><strong>OpenCode asks</strong>{question.questions.map((item, index) => <fieldset key={`${question.requestId}-${index}`}><legend>{item.header}</legend><p>{item.question}</p>{item.options.map(option => <label key={option.label}><input type={item.multiple ? 'checkbox' : 'radio'} name={`${question.requestId}-${index}`} checked={(questionAnswers[index] ?? []).includes(option.label)} onChange={() => updateQuestionAnswer(index, option.label, item.multiple)} /><span><b>{option.label}</b>{option.description ? ` — ${option.description}` : ''}</span></label>)}{item.custom ? <input value={questionCustomAnswers[index] ?? ''} onChange={event => setQuestionCustomAnswers(current => ({ ...current, [index]: event.target.value }))} placeholder="Custom answer" /> : null}</fieldset>)}<div><button className="btn btn-s" type="button" onClick={() => { void replyQuestion() }}>Answer</button><button className="btn btn-s danger" type="button" onClick={() => { void rejectQuestion() }}>Reject / cancel</button></div></div> : null}
              </section>
              <form className="opencode-composer" onSubmit={event => { event.preventDefault(); void submit() }}>
                <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask OpenCode to inspect, plan, or change this workspace…" disabled={running} rows={3} />
                <div className="opencode-composer-footer"><span>OpenCode v{status?.version} · {tools?.customToolRegistered ? 'Metrora usage tool registered' : 'checking Metrora tool'}</span><div>{running ? <button className="btn btn-s danger" type="button" onClick={() => { void cancel() }}>Cancel</button> : <button className="btn" type="submit" disabled={!draft.trim()}>Send</button>}</div></div>
              </form>
            </>
          )}
          {lastFailedPrompt ? <div className="opencode-retry"><span>Last request failed.</span><button className="btn btn-s" type="button" onClick={() => { void submit(lastFailedPrompt) }}>Retry</button></div> : null}
          {error ? <div className="opencode-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div> : null}
        </main>

        <aside className="opencode-inspector">
          <div className="opencode-inspector-card"><h2>Engine boundary</h2><dl><dt>Upstream</dt><dd>{status?.version ?? '—'}</dd><dt>Commit</dt><dd>{status?.commit?.slice(0, 12) ?? '—'}</dd><dt>Tools</dt><dd>{tools ? `${tools.ids.length} total` : '—'}</dd><dt>MCP</dt><dd>{mcp.length ? `${mcp.filter(item => item.status === 'connected').length}/${mcp.length} connected` : 'none configured'}</dd><dt>ACP</dt><dd>{status?.acpAvailable ? 'bundled binary available' : 'not started'}</dd></dl></div>
          <details className="opencode-inspector-card"><summary>OpenCode provider authentication</summary><p>Authentication stays inside OpenCode’s official provider APIs. OpenCode Zen appears here when the pinned engine exposes it.</p><label>Provider<select value={activeAuthProvider} onChange={event => { setAuthProviderId(event.target.value); setAuthMethodIndex(0); setAuthorization(null); setAuthInputs({}) }}><option value="">Select provider</option>{Object.keys(providerAuth).map(providerId => <option key={providerId} value={providerId}>{providerId}</option>)}</select></label>{activeAuthMethods.length ? <><label>Method<select value={authMethodIndex} onChange={event => { setAuthMethodIndex(Number(event.target.value)); setAuthorization(null); setAuthInputs({}) }}>{activeAuthMethods.map((method, index) => <option key={`${method.type}-${index}`} value={index}>{method.label} · {method.type}</option>)}</select></label>{activeAuthMethod?.prompts.map(prompt => prompt.type === 'select' ? <label key={prompt.key}>{prompt.message}<select value={authInputs[prompt.key] ?? ''} onChange={event => setAuthInputs(current => ({ ...current, [prompt.key]: event.target.value }))}><option value="">Select…</option>{prompt.options.map(option => <option key={option.value} value={option.value}>{option.label}{option.hint ? ` · ${option.hint}` : ''}</option>)}</select></label> : <label key={prompt.key}>{prompt.message}<input value={authInputs[prompt.key] ?? ''} onChange={event => setAuthInputs(current => ({ ...current, [prompt.key]: event.target.value }))} placeholder={prompt.placeholder ?? undefined} type={activeAuthMethod.type === 'api' ? 'password' : 'text'} /></label>)}{activeAuthMethod?.type === 'api' && !activeAuthMethod.prompts.some(prompt => prompt.key === 'apiKey') ? <label>API key<input type="password" value={authInputs.apiKey ?? ''} onChange={event => setAuthInputs(current => ({ ...current, apiKey: event.target.value }))} autoComplete="off" /></label> : null}<button className="btn btn-s" type="button" onClick={() => { void connectProvider() }} disabled={authBusy}>{authBusy ? 'Connecting…' : activeAuthMethod?.type === 'oauth' ? 'Start OAuth' : 'Save API key'}</button>{authorization ? <div className="opencode-auth-flow"><p>{authorization.instructions}</p><a href={authorization.url} onClick={event => { event.preventDefault(); void metrora.openExternal(authorization.url) }}>Open authorization page</a>{authorization.method === 'code' ? <><label>Authorization code<input value={authCode} onChange={event => setAuthCode(event.target.value)} autoComplete="off" /></label><button className="btn btn-s" type="button" onClick={() => { void completeOAuth() }} disabled={authBusy || !authCode}>Complete OAuth</button></> : <small>Finish authorization in the OpenCode provider page, then refresh providers.</small>}</div> : null}</> : <p className="opencode-muted">OpenCode reports no authentication methods for the available providers.</p>}<button className="btn btn-s" type="button" onClick={() => { void refreshCapabilities() }} disabled={authBusy}>Refresh providers and models</button></details>
          <details className="opencode-inspector-card"><summary>Local OpenAI-compatible endpoint</summary><p>Configure OpenCode’s official provider config for a loopback llama.cpp/llama-server endpoint. Model limits remain provider metadata, never local Metrora guesses.</p><label>Port<input value={localPort} onChange={event => setLocalPort(event.target.value)} inputMode="numeric" /></label><label>Model id<input value={localModelId} onChange={event => setLocalModelId(event.target.value)} /></label><button className="btn btn-s" type="button" onClick={() => { void configureLocal() }} disabled={configuringLocal}>{configuringLocal ? 'Applying…' : 'Apply and restart'}</button></details>
          <div className="opencode-inspector-card"><h2>Scope</h2><p>Metrora provides one read-only usage snapshot. Coding, tools, permissions, plans, subagents, MCP, and edits remain OpenCode behavior.</p></div>
        </aside>
      </div>
    </div>
  )
}

function MessageView({ message }: { message: OpenCodeConversationMessage }) {
  return <div className={`opencode-message ${message.role}`}><div className="opencode-message-meta">{message.role === 'user' ? 'You' : 'OpenCode'}{message.agent ? ` · ${message.agent}` : ''}{message.createdAt ? ` · ${displayTime(message.createdAt)}` : ''}{message.cost !== null ? ` · $${message.cost.toFixed(4)}` : ''}</div>{message.text ? <div className="opencode-message-text">{message.text}</div> : null}{message.parts.filter(part => part.type === 'tool' || part.type === 'subtask' || part.type === 'patch' || part.type === 'file').map(part => <div className="opencode-part" key={part.id}><span>{part.type === 'tool' ? `${part.tool ?? 'tool'} · ${part.status}` : part.type}</span>{part.title ? ` · ${part.title}` : ''}{part.output ? <pre>{part.output}</pre> : null}{part.files?.length ? <small>{part.files.join(', ')}</small> : null}</div>)}</div>
}
