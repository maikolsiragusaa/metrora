import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  OpenCodeAgent,
  OpenCodeConversationMessage,
  OpenCodeEngineStatus,
  OpenCodeMcpServer,
  OpenCodeModel,
  OpenCodeProvider,
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

function flattenModels(providers: OpenCodeProvider[]): OpenCodeModel[] {
  return providers.flatMap(provider => provider.models)
}

function initialModel(providers: OpenCodeProvider[]): string {
  const connected = providers.find(provider => provider.connected && provider.models.length > 0)
  const fallback = providers.find(provider => provider.models.length > 0)
  const model = connected?.models[0] ?? fallback?.models[0]
  return model ? modelKey(model) : ''
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
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [draft, setDraft] = useState('')
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)
  const [liveText, setLiveText] = useState('')
  const [activities, setActivities] = useState<Array<{ id: string; tool: string; status: string; title: string | null }>>([])
  const [permission, setPermission] = useState<Extract<OpenCodeRendererEvent, { kind: 'permission' }> | null>(null)
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
      metrora.opencodeListAgents(),
      metrora.opencodeListTools(),
      metrora.opencodeGetWorkspace(),
      metrora.opencodeGetMcp(),
    ])
    const [providerResult, agentResult, toolResult, workspaceResult, mcpResult] = results
    if (providerResult.status === 'fulfilled') {
      setProviders(providerResult.value)
      setSelectedModel(current => current && flattenModels(providerResult.value).some(model => modelKey(model) === current) ? current : initialModel(providerResult.value))
    }
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
      if (event.kind === 'message-delta' && event.sessionId === activeSessionId) setLiveText(current => current + event.text)
      if (event.kind === 'tool' && event.sessionId === activeSessionId) {
        setActivities(current => {
          const next = current.filter(item => item.id !== event.partId)
          return [...next, { id: event.partId, tool: event.tool, status: event.status, title: event.title }].slice(-12)
        })
      }
      if (event.kind === 'permission' && event.sessionId === activeSessionId) setPermission(event)
      if (event.kind === 'error') setError(event.message)
      if (event.kind === 'session-status' && event.status === 'idle' && event.sessionId === activeSessionId) {
        void metrora.opencodeGetMessages(event.sessionId).then(setMessages).catch(() => {})
      }
    })
  }, [activeSessionId])

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
        model: selectedModelObject ? { providerID: selectedModelObject.providerID, modelID: selectedModelObject.id } : null,
        agent: selectedAgent || null, cost: null, tokens: null, parts: [{ id: `${requestId}-part`, type: 'text', text: prompt }],
      }
      setMessages(current => [...current, optimistic])
      await metrora.opencodePrompt({
        requestId, sessionId, text: prompt,
        ...(selectedModelObject ? { model: { providerID: selectedModelObject.providerID, modelID: selectedModelObject.id } } : {}),
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

  const selectedVariants = selectedModelObject?.variants ?? []
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
              <strong>{session.title}</strong><small>{displayTime(session.updatedAt)}</small>
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
              <label><span>Reasoning variant</span><select value={selectedVariant} onChange={event => setSelectedVariant(event.target.value)} disabled={!ready || selectedVariants.length === 0}>
                <option value="">Default</option>
                {selectedVariants.map(variant => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
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
                {permission ? <div className="opencode-permission"><strong>OpenCode requests permission</strong><span>{permission.title} · {permission.type}{permission.pattern ? ` · ${permission.pattern}` : ''}</span><div><button className="btn btn-s" type="button" onClick={() => { void replyPermission('once') }}>Allow once</button><button className="btn btn-s" type="button" onClick={() => { void replyPermission('always') }}>Always allow</button><button className="btn btn-s danger" type="button" onClick={() => { void replyPermission('reject') }}>Reject</button></div></div> : null}
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
          <details className="opencode-inspector-card"><summary>Local OpenAI-compatible endpoint</summary><p>Configure OpenCode’s official provider config for a loopback llama.cpp/llama-server endpoint.</p><label>Port<input value={localPort} onChange={event => setLocalPort(event.target.value)} inputMode="numeric" /></label><label>Model id<input value={localModelId} onChange={event => setLocalModelId(event.target.value)} /></label><button className="btn btn-s" type="button" onClick={() => { void configureLocal() }} disabled={configuringLocal}>{configuringLocal ? 'Applying…' : 'Apply and restart'}</button></details>
          <div className="opencode-inspector-card"><h2>Scope</h2><p>Metrora provides one read-only usage snapshot. Coding, tools, permissions, plans, subagents, MCP, and edits remain OpenCode behavior.</p></div>
        </aside>
      </div>
    </div>
  )
}

function MessageView({ message }: { message: OpenCodeConversationMessage }) {
  return <div className={`opencode-message ${message.role}`}><div className="opencode-message-meta">{message.role === 'user' ? 'You' : 'OpenCode'}{message.agent ? ` · ${message.agent}` : ''}{message.createdAt ? ` · ${displayTime(message.createdAt)}` : ''}{message.cost !== null ? ` · $${message.cost.toFixed(4)}` : ''}</div>{message.text ? <div className="opencode-message-text">{message.text}</div> : null}{message.parts.filter(part => part.type === 'tool' || part.type === 'subtask' || part.type === 'patch' || part.type === 'file').map(part => <div className="opencode-part" key={part.id}><span>{part.type === 'tool' ? `${part.tool ?? 'tool'} · ${part.status}` : part.type}</span>{part.title ? ` · ${part.title}` : ''}{part.output ? <pre>{part.output}</pre> : null}{part.files?.length ? <small>{part.files.join(', ')}</small> : null}</div>)}</div>
}
