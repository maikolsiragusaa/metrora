import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MetroraMark } from '../components/MetroraMark'
import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import { readStorage, writeStorage } from '../lib/storage'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import { reasoningProfileKey } from '../../electron/harness-runtime-types'
import type {
  HarnessApprovalProjection,
  HarnessConversation,
  HarnessConversationInput,
  HarnessConversationMessage,
  HarnessConversationSummary,
  HarnessHostedModel,
  HarnessHostedProvider,
  HarnessLocalProbe,
  HarnessMode,
  HarnessProcessItem,
  HarnessReasoningEffort,
  HarnessRuntimeChoice,
  HarnessRuntimeProfileV1,
  HarnessToolProjection,
  HarnessWorkspace,
  MetroraHarnessRuntimeEvent,
} from '../../electron/harness-runtime-types'

type DetectedProvider = { id: string; label: string }
type FailedTurn = { question: string; requestId: string }

const LOCAL_RUNTIMES: ReadonlyArray<{ id: 'ollama' | 'lmstudio' | 'llama-server'; label: string }> = [
  { id: 'ollama', label: 'Ollama' },
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'llama-server', label: 'llama.cpp' },
]
const HOSTED_PROVIDERS: ReadonlyArray<{ id: HarnessHostedProvider; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'opencode-zen', label: 'OpenCode Zen' },
]
const MODES: ReadonlyArray<{ id: HarnessMode; label: string; description: string }> = [
  { id: 'ask', label: 'Ask', description: 'Read and discuss' },
  { id: 'plan', label: 'Plan', description: 'Inspect and outline' },
  { id: 'edit', label: 'Edit', description: 'Make focused changes' },
  { id: 'build', label: 'Build', description: 'Code, run, iterate' },
]
const FALLBACK_PROFILE: HarnessRuntimeProfileV1 = {
  version: 1,
  runtime: 'ollama',
  lastLocalRuntime: 'ollama',
  lastLocalModelByRuntime: {},
  lastHostedModelByProvider: {},
  llamaServerPort: 8080,
  reasoningByModel: {},
  hostedConsentByProvider: {},
  lastUsable: null,
  ui: { showReasoning: true, compactProcess: true, density: 'comfortable' },
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message) : String(error)
}

function runtimeLabel(runtime: HarnessRuntimeChoice, provider: HarnessHostedProvider | null): string {
  if (runtime === 'hosted') return HOSTED_PROVIDERS.find(item => item.id === provider)?.label ?? 'Hosted provider'
  return LOCAL_RUNTIMES.find(item => item.id === runtime)?.label ?? runtime
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

function scopeInput(period: Period, range: DateRange | null, provider: string, projectId: string, projectName: string, model: string | null): HarnessConversationInput['scope'] {
  return { period, range, provider, projectId, projectName, model }
}

function processItemsFromEvent(current: HarnessProcessItem[], event: MetroraHarnessRuntimeEvent): HarnessProcessItem[] {
  const incoming = event.process
  if (!incoming) return current
  if (incoming.kind === 'tool') {
    const index = current.findIndex(item => item.kind === 'tool' && item.item.callId === incoming.item.callId)
    if (index < 0) return [...current, incoming]
    return current.map((item, itemIndex) => itemIndex === index && item.kind === 'tool' ? { kind: 'tool', item: { ...item.item, ...incoming.item } } : item)
  }
  if (incoming.kind === 'approval') {
    const index = current.findIndex(item => item.kind === 'approval' && item.item.approvalId === incoming.item.approvalId)
    if (index < 0) return [...current, incoming]
    return current.map((item, itemIndex) => itemIndex === index && item.kind === 'approval' ? { kind: 'approval', item: { ...item.item, ...incoming.item } } : item)
  }
  if (incoming.kind === 'agent') {
    const index = current.findIndex(item => item.kind === 'agent' && item.item.agentId === incoming.item.agentId)
    if (index < 0) return [...current, incoming]
    return current.map((item, itemIndex) => itemIndex === index && item.kind === 'agent' ? { kind: 'agent', item: { ...item.item, ...incoming.item } } : item)
  }
  return [...current, incoming]
}

function statusLabel(status: HarnessToolProjection['status']): string {
  return status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'interrupted' ? 'Interrupted' : status === 'denied' ? 'Denied' : status === 'running' ? 'Running' : 'Queued'
}

function toolIcon(kind: HarnessToolProjection['kind']): string {
  return kind === 'filesystem' ? '▧' : kind === 'search' ? '⌕' : kind === 'terminal' ? '›_' : kind === 'git' ? '⑂' : kind === 'web' ? '↗' : kind === 'metrora' ? '◈' : kind === 'subagent' ? '◎' : '·'
}

export function Harness({
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
  const projectName = projectScopeId === 'all' ? 'All projects' : projectOptions.find(option => option.id === projectScopeId)?.name ?? projectScopeId
  const [profile, setProfile] = useState<HarnessRuntimeProfileV1>(FALLBACK_PROFILE)
  const [workspace, setWorkspace] = useState<HarnessWorkspace | null>(null)
  const [runtime, setRuntime] = useState<HarnessRuntimeChoice>('ollama')
  const [hostedProvider, setHostedProvider] = useState<HarnessHostedProvider>('openai')
  const [hostedConsent, setHostedConsent] = useState<'unknown' | 'accepted' | 'declined'>('unknown')
  const [mode, setMode] = useState<HarnessMode>('ask')
  const [model, setModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState<HarnessReasoningEffort | null>(null)
  const [localProbe, setLocalProbe] = useState<HarnessLocalProbe | null>(null)
  const [hostedProbe, setHostedProbe] = useState<{ provider: HarnessHostedProvider; available: boolean; models: HarnessHostedModel[]; detail: string; credentialState: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [conversations, setConversations] = useState<HarnessConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => readStorage('harness.activeSession'))
  const [conversation, setConversation] = useState<HarnessConversation | null>(null)
  const [composer, setComposer] = useState('')
  const [busy, setBusy] = useState(false)
  const [runtimeState, setRuntimeState] = useState<MetroraHarnessRuntimeEvent['state'] | null>(null)
  const [liveText, setLiveText] = useState('')
  const [liveReasoning, setLiveReasoning] = useState('')
  const [liveProcess, setLiveProcess] = useState<HarnessProcessItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const requestIdRef = useRef<string | null>(null)
  const workspaceRevisionRef = useRef(0)
  const activeIdRef = useRef<string | null>(activeId)
  const localProbeRevisionRef = useRef(0)
  const hostedProbeRevisionRef = useRef(0)

  const availableModels = runtime === 'hosted'
    ? (hostedProbe?.provider === hostedProvider && hostedProbe.available ? hostedProbe.models.map(item => item.id) : [])
    : (localProbe?.runtime === runtime && localProbe.available ? localProbe.models : [])
  const modelOptions = [...new Set([...availableModels, ...(model && !availableModels.includes(model) ? [model] : [])])]
  const selectedModelReasoningEfforts = runtime === 'hosted'
    ? hostedProbe?.provider === hostedProvider && hostedProbe.available ? hostedProbe.models.find(item => item.id === model)?.reasoningEfforts ?? [] : []
    : localProbe?.runtime === runtime && localProbe.available ? localProbe.capabilities.find(item => item.modelId === model)?.reasoningEfforts ?? [] : []
  const availableReasoningEfforts = [...new Set(selectedModelReasoningEfforts)]
  const routeReady = runtime === 'hosted' ? Boolean(hostedProbe?.provider === hostedProvider && hostedProbe.available && hostedProbe.models.some(item => item.id === model)) : Boolean(localProbe?.runtime === runtime && localProbe.available && localProbe.models.includes(model))
  const selectedConformance = conversation && conversation.runtime === runtime && conversation.provider === (runtime === 'hosted' ? hostedProvider : null) && conversation.model === model && conversation.reasoningEffort === reasoningEffort
    ? conversation.conformance
    : undefined
  const currentScope = scopeInput(period, range, provider, projectScopeId, projectName, model || null)
  const filteredConversations = conversations.filter(item => !historyQuery.trim() || item.title.toLowerCase().includes(historyQuery.toLowerCase()))

  const refreshSessions = useCallback(async (preferredId?: string | null) => {
    const workspaceRevision = workspaceRevisionRef.current
    const rows = await metrora.harnessListConversations()
    setConversations(rows)
    const candidate = preferredId ?? activeIdRef.current ?? readStorage('harness.activeSession')
    const selected = rows.some(row => row.id === candidate) ? candidate : rows[0]?.id ?? null
    setActiveId(selected)
    if (selected) writeStorage('harness.activeSession', selected)
    if (selected) {
      const next = await metrora.harnessGetConversation(selected)
      setConversation(next)
      if (next && workspaceRevisionRef.current === workspaceRevision) {
        setWorkspace(next.workspace)
        setRuntime(next.runtime)
        if (next.provider) setHostedProvider(next.provider)
        setModel(next.model === 'unknown-model' ? '' : next.model)
        setMode(next.mode)
        setReasoningEffort(next.reasoningEffort)
        setHostedConsent(next.provider ? profile.hostedConsentByProvider[next.provider] ?? 'unknown' : 'unknown')
      }
    } else setConversation(null)
  }, [profile.hostedConsentByProvider])

  const loadProfile = useCallback(async () => {
    const workspaceRevision = workspaceRevisionRef.current
    try {
      const [nextProfile, nextWorkspace] = await Promise.all([metrora.harnessProfileGet(), metrora.harnessWorkspaceGet()])
      setProfile(nextProfile)
      if (workspaceRevisionRef.current === workspaceRevision) setWorkspace(nextWorkspace)
      const nextRuntime = nextProfile.runtime
      const nextProvider = nextProfile.lastUsable?.provider ?? 'openai'
      const nextModel = nextRuntime === 'hosted'
        ? nextProfile.lastHostedModelByProvider[nextProvider] ?? nextProfile.lastUsable?.model ?? ''
        : nextProfile.lastLocalModelByRuntime[nextRuntime] ?? nextProfile.lastUsable?.model ?? ''
      setRuntime(nextRuntime)
      setHostedProvider(nextProvider)
      setModel(nextModel)
      setHostedConsent(nextProfile.hostedConsentByProvider[nextProvider] ?? 'unknown')
      setReasoningEffort(nextModel ? nextProfile.reasoningByModel[reasoningProfileKey(nextRuntime, nextRuntime === 'hosted' ? nextProvider : null, nextModel)] ?? null : null)
    } catch (caught) { setNotice(errorText(caught)) }
  }, [])

  const probeLocal = useCallback(async (nextRuntime: 'ollama' | 'lmstudio' | 'llama-server', port = profile.llamaServerPort) => {
    const revision = ++localProbeRevisionRef.current
    setLocalProbe(current => current?.runtime === nextRuntime ? { ...current, detail: 'Checking runtime…', discoveryState: 'runtime-unavailable' } : null)
    try {
      const result = await metrora.harnessProbeLocal(nextRuntime, nextRuntime === 'llama-server' ? port : undefined)
      if (localProbeRevisionRef.current !== revision) return
      setLocalProbe(result)
      let nextModel = model
      if (result.models.length && (!model || !result.models.includes(model))) {
        const remembered = profile.lastLocalModelByRuntime[nextRuntime]
        nextModel = remembered && result.models.includes(remembered) ? remembered : result.models[0]!
        setModel(nextModel)
      }
      const efforts = result.capabilities.find(item => item.modelId === nextModel)?.reasoningEfforts ?? []
      setReasoningEffort(current => current && efforts.includes(current) ? current : null)
      setNotice(result.available ? `${runtimeLabel(nextRuntime, null)} ready · ${result.models.length} model${result.models.length === 1 ? '' : 's'} discovered.` : result.detail)
    } catch (caught) { if (localProbeRevisionRef.current === revision) { setLocalProbe(null); setNotice(errorText(caught)) } }
  }, [model, profile.lastLocalModelByRuntime, profile.llamaServerPort])

  const probeHosted = useCallback(async (nextProvider: HarnessHostedProvider) => {
    const revision = ++hostedProbeRevisionRef.current
    setHostedProbe(current => ({ provider: nextProvider, available: false, models: [], detail: 'Checking provider…', credentialState: current?.provider === nextProvider ? current.credentialState : 'not-configured' }))
    try {
      const result = await metrora.harnessProbeHosted(nextProvider)
      if (hostedProbeRevisionRef.current !== revision) return
      setHostedProbe(result)
      const remembered = profile.lastHostedModelByProvider[nextProvider]
      const nextModel = remembered && result.models.some(item => item.id === remembered) ? remembered : result.models[0]?.id ?? ''
      setModel(nextModel)
       setHostedConsent(profile.hostedConsentByProvider[nextProvider] ?? 'unknown')
       const efforts = result.models.find(item => item.id === nextModel)?.reasoningEfforts ?? []
       const savedEffort = nextModel ? profile.reasoningByModel[reasoningProfileKey('hosted', nextProvider, nextModel)] ?? null : null
       setReasoningEffort(savedEffort && efforts.includes(savedEffort) ? savedEffort : null)
      setNotice(result.available ? `${runtimeLabel('hosted', nextProvider)} ready · ${result.models.length} model${result.models.length === 1 ? '' : 's'} discovered.` : result.detail)
    } catch (caught) { if (hostedProbeRevisionRef.current === revision) { setHostedProbe(null); setNotice(errorText(caught)) } }
  }, [profile.lastHostedModelByProvider, profile.reasoningByModel])

  useEffect(() => { void loadProfile() }, [loadProfile])
  useEffect(() => { void refreshSessions() }, [refreshSessions])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => {
    if (runtime === 'hosted') { void probeHosted(hostedProvider); return }
    void probeLocal(runtime, profile.llamaServerPort)
  }, [hostedProvider, profile.llamaServerPort, runtime]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsubscribe = metrora.onHarnessRuntimeEvent(event => {
      if (!activeId || event.conversationId !== activeId) return
      if (event.requestId && requestIdRef.current && event.requestId !== requestIdRef.current) return
      setRuntimeState(event.state)
      if (event.kind === 'text-delta' && event.text) setLiveText(current => (current + event.text).slice(0, 32_000))
      if (event.kind === 'reasoning-delta' && event.text) setLiveReasoning(current => (current + event.text).slice(0, 32_000))
      setLiveProcess(current => processItemsFromEvent(current, event))
      if (event.state === 'failed' && event.text) setError(event.text)
      if (event.state === 'done' || event.state === 'failed' || event.state === 'cancelled') {
        void metrora.harnessGetConversation(activeId).then(setConversation).catch(() => {})
        void metrora.harnessListConversations().then(setConversations).catch(() => {})
      }
    })
    return unsubscribe
  }, [activeId])

  const selectConversation = useCallback(async (id: string) => {
    if (busy) return
    setActiveId(id)
    writeStorage('harness.activeSession', id)
    setError(null)
    setNotice(null)
    const next = await metrora.harnessGetConversation(id)
    setConversation(next)
    if (next) {
      setWorkspace(next.workspace)
      setRuntime(next.runtime)
      if (next.provider) setHostedProvider(next.provider)
      setModel(next.model === 'unknown-model' ? '' : next.model)
      setMode(next.mode)
      setReasoningEffort(next.reasoningEffort)
      setHostedConsent(next.provider ? profile.hostedConsentByProvider[next.provider] ?? 'unknown' : 'unknown')
    }
  }, [busy, profile.hostedConsentByProvider])

  const makeConversation = useCallback(async () => {
    if (!routeReady || !model) { setNotice('Select a discovered model before starting a Session.'); return }
    if (runtime === 'hosted' && hostedConsent !== 'accepted') { setError('Accept hosted provider consent in Settings before creating a hosted Session.'); return }
    try {
      const created = await metrora.harnessCreateConversation({ runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: workspace?.id ?? null, scope: currentScope })
      setConversations(current => [created, ...current.filter(item => item.id !== created.id)])
      setActiveId(created.id)
      writeStorage('harness.activeSession', created.id)
      setConversation(created)
      setError(null)
      setNotice(null)
    } catch (caught) { setError(errorText(caught)) }
  }, [currentScope, hostedConsent, hostedProvider, mode, model, reasoningEffort, routeReady, runtime, workspace?.id])

  const send = useCallback(async (retry = false) => {
    const question = (retry ? failedTurn?.question ?? '' : composer).trim()
    if (!question || busy || !routeReady || !model) return
    if (runtime === 'hosted' && hostedConsent !== 'accepted') {
      setError(hostedConsent === 'declined' ? 'Hosted use is declined for this provider. Accept the consent in Settings to continue.' : 'Accept hosted provider consent in Settings before sending a request.')
      return
    }
    let id = activeId
    if (!id) {
      try {
        const created = await metrora.harnessCreateConversation({ runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: workspace?.id ?? null, scope: currentScope })
        id = created.id
        setActiveId(id)
        setConversations(current => [created, ...current])
        writeStorage('harness.activeSession', id)
        setConversation(created)
      } catch (caught) { setError(errorText(caught)); return }
    }
    const requestId = `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    requestIdRef.current = requestId
    setBusy(true)
    setRuntimeState('thinking')
    setLiveText('')
    setLiveReasoning('')
    setLiveProcess([])
    setError(null)
    setNotice(null)
    if (!retry) {
      setComposer('')
      setConversation(current => current ? { ...current, messages: [...current.messages, { id: `optimistic-${requestId}`, role: 'user', text: question }] } : current)
    }
    try {
      await metrora.harnessSendMessage({ conversationId: id, runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: workspace?.id ?? null, scope: currentScope, question, requestId, ...(retry && failedTurn ? { retryRequestId: failedTurn.requestId } : {}) })
      setFailedTurn(null)
      setConversation(await metrora.harnessGetConversation(id))
      setConversations(await metrora.harnessListConversations())
    } catch (caught) {
      setFailedTurn({ question, requestId })
      setError(errorText(caught))
    } finally {
      requestIdRef.current = null
      setBusy(false)
      setRuntimeState(null)
    }
  }, [activeId, busy, composer, currentScope, failedTurn, hostedConsent, hostedProvider, mode, model, reasoningEffort, routeReady, runtime, workspace?.id])

  const stop = useCallback(async () => {
    if (activeId) await metrora.harnessCancel(activeId).catch(() => false)
  }, [activeId])

  const openWorkspace = useCallback(async () => {
    const workspaceRevision = ++workspaceRevisionRef.current
    setLoadingWorkspace(true)
    try {
      const root = await metrora.chooseDirectory()
      if (!root) return
      const selected = await metrora.harnessWorkspaceOpen(root)
      if (workspaceRevisionRef.current === workspaceRevision) setWorkspace(selected)
      setNotice(`Workspace ready · ${selected.displayName}`)
    } catch (caught) { setError(errorText(caught)) }
    finally { setLoadingWorkspace(false) }
  }, [])

  const changeRuntime = useCallback(async (next: HarnessRuntimeChoice) => {
    setRuntime(next)
    setLocalProbe(null)
    setHostedProbe(null)
    setModel('')
    setReasoningEffort(null)
    if (next === 'hosted') setHostedConsent(profile.hostedConsentByProvider[hostedProvider] ?? 'unknown')
    await metrora.harnessProfileSetRuntime(next).then(setProfile).catch(() => {})
  }, [hostedProvider, profile.hostedConsentByProvider])

  const changeModel = useCallback(async (next: string) => {
    setModel(next)
    const efforts = runtime === 'hosted'
      ? hostedProbe?.provider === hostedProvider ? hostedProbe.models.find(item => item.id === next)?.reasoningEfforts ?? [] : []
      : localProbe?.runtime === runtime ? localProbe.capabilities.find(item => item.modelId === next)?.reasoningEfforts ?? [] : []
    const savedEffort = profile.reasoningByModel[reasoningProfileKey(runtime, runtime === 'hosted' ? hostedProvider : null, next)] ?? null
    setReasoningEffort(savedEffort && efforts.includes(savedEffort) ? savedEffort : null)
    const nextProfile = runtime === 'hosted' ? await metrora.harnessProfileSetHostedModel(hostedProvider, next).catch(() => null) : await metrora.harnessProfileSetLocalModel(runtime, next).catch(() => null)
    if (nextProfile) setProfile(nextProfile)
  }, [hostedProbe, hostedProvider, localProbe, profile.reasoningByModel, runtime])

  const changeReasoning = useCallback(async (value: string) => {
    const next = value === '' ? null : value as HarnessReasoningEffort
    if (next && !availableReasoningEfforts.includes(next)) return
    setReasoningEffort(next)
    if (next && model) await metrora.harnessProfileSetReasoning(runtime, runtime === 'hosted' ? hostedProvider : null, model, next).then(setProfile).catch(() => {})
  }, [availableReasoningEfforts, hostedProvider, model, runtime])

  const changeHostedConsent = useCallback(async (state: 'unknown' | 'accepted' | 'declined') => {
    setHostedConsent(state)
    await metrora.harnessProfileSetConsent(hostedProvider, state).then(setProfile).catch(() => {})
  }, [hostedProvider])

  const checkConformance = useCallback(async () => {
    if (!activeId || !model) return
    setNotice('Checking exact model conformance with a real bounded Tool round trip…')
    try {
      const result = await metrora.harnessCheckConformance({ conversationId: activeId, runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: workspace?.id ?? null, scope: currentScope })
      setConversation(await metrora.harnessGetConversation(activeId))
      setNotice(typeof result === 'object' && result && 'state' in result ? `Conformance: ${String((result as { state?: unknown }).state)}.` : 'Conformance check complete.')
    } catch (caught) { setError(errorText(caught)) }
  }, [activeId, currentScope, hostedProvider, mode, model, reasoningEffort, runtime, workspace?.id])

  const activeTitle = conversation?.title ?? 'New Session'
  const activeStatus = busy ? runtimeState : null

  return (
    <section className="harness-shell" aria-label="Metrora Harness">
      <aside className="harness-session-rail" aria-label="Harness Sessions">
        <div className="harness-rail-brand"><MetroraMark size={24} /><div><strong>Harness</strong><span>coding cockpit</span></div></div>
        <button type="button" className="harness-new-session" onClick={() => void makeConversation()} disabled={!routeReady || busy}><span>＋</span> New Session</button>
        <label className="harness-session-search"><span aria-hidden="true">⌕</span><input aria-label="Search Harness Sessions" placeholder="Search Sessions" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} /></label>
        <div className="harness-session-list">
          {filteredConversations.length ? filteredConversations.map(item => (
            <button type="button" key={item.id} className={`harness-session-item${item.id === activeId ? ' active' : ''}`} onClick={() => void selectConversation(item.id)}>
              <span>{item.title}</span><small>{formatTime(item.updatedAt)} · {item.messageCount} {item.messageCount === 1 ? 'message' : 'messages'}</small>
            </button>
          )) : <p className="harness-muted">No prior Sessions yet.</p>}
        </div>
        <div className="harness-rail-foot"><span className="harness-status-dot" /> Local-first · durable Sessions</div>
      </aside>

      <div className="harness-main">
        <header className="harness-header">
          <div className="harness-title"><MetroraMark size={22} /><div className="harness-title-copy"><span className="harness-session-kicker">ACTIVE SESSION</span><h1>{activeTitle}</h1><p>{workspace ? `Workspace · ${workspace.displayName}` : 'Open a Workspace to enable coding Tools'}</p></div></div>
          <div className="harness-header-actions">
            <button type="button" className="harness-workspace-pill" onClick={() => void openWorkspace()} disabled={loadingWorkspace} title="Choose local Workspace"><span>⌂</span>{workspace?.displayName ?? 'Open Workspace'}</button>
            <button type="button" className="harness-settings-button" onClick={() => setSettingsOpen(current => !current)} aria-expanded={settingsOpen}>Settings</button>
          </div>
        </header>

        <div className="harness-toolbar" aria-label="Harness session controls">
          <label><span>Mode</span><select aria-label="Harness mode" value={mode} onChange={event => setMode(event.target.value as HarnessMode)}>{MODES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><span>Runtime</span><select aria-label="Harness runtime" value={runtime} onChange={event => void changeRuntime(event.target.value as HarnessRuntimeChoice)}><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="llama-server">llama.cpp</option><option value="hosted">Hosted</option></select></label>
          {runtime === 'hosted' && <label><span>Provider</span><select aria-label="Harness provider" value={hostedProvider} onChange={event => { const next = event.target.value as HarnessHostedProvider; setHostedProvider(next); setHostedConsent(profile.hostedConsentByProvider[next] ?? 'unknown'); void probeHosted(next) }}>{HOSTED_PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
          <label className="harness-model-control"><span>Model</span><select aria-label="Harness model" value={model} onChange={event => void changeModel(event.target.value)} disabled={!modelOptions.length}><option value="">{routeReady ? 'Select model' : 'Discovering models…'}</option>{modelOptions.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Reasoning</span><select aria-label="Harness reasoning effort" value={reasoningEffort ?? ''} onChange={event => void changeReasoning(event.target.value)} disabled={!model}><option value="">Provider default</option>{availableReasoningEfforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label>
          <div className="harness-toolbar-state" data-state={activeStatus ?? (routeReady ? 'ready' : 'unavailable')}><span className="harness-status-dot" />{activeStatus ? activeStatus.replaceAll('-', ' ') : routeReady ? `${runtimeLabel(runtime, hostedProvider)} ready` : runtime === 'hosted' ? hostedProbe?.detail ?? 'Connect provider' : localProbe?.detail ?? 'Runtime unavailable'}</div>
        </div>

        <div className="harness-content">
          <main className="harness-thread" aria-live="polite">
            {conversation?.messages.length || busy ? (
              <div className="harness-thread-inner">
                {conversation?.messages.map(message => <ConversationMessage key={message.id} message={message} showReasoning={profile.ui.showReasoning} />)}
                {busy && (liveText || liveReasoning || liveProcess.length > 0) && <div className="harness-live-turn"><div className="harness-live-label"><span className="harness-thinking-dots"><i /><i /><i /></span>{liveReasoning ? 'Reasoning…' : liveProcess.length ? 'Working…' : 'Thinking…'}</div>{liveReasoning && <div className="harness-reasoning-preview">{liveReasoning}</div>}{liveText && <p>{liveText}</p>}{liveProcess.length > 0 && <ProcessFold items={liveProcess} active onApprovalResolved={() => {}} />}</div>}
                {busy && !liveText && !liveReasoning && !liveProcess.length && <div className="harness-live-turn"><div className="harness-live-label"><span className="harness-thinking-dots"><i /><i /><i /></span>Thinking…</div></div>}
              </div>
            ) : (
              <EmptyHarnessState workspace={workspace} onPrompt={prompt => { setComposer(prompt) }} />
            )}
            {error && <div className="harness-error" role="alert"><div><strong>Harness request failed</strong><p>{error}</p></div>{failedTurn && <button type="button" onClick={() => void send(true)} disabled={busy}>Retry</button>}</div>}
            {notice && !error && <div className="harness-notice" role="status">{notice}</div>}
          </main>
          {settingsOpen && <HarnessSettings profile={profile} runtime={runtime} hostedProvider={hostedProvider} hostedConsent={hostedConsent} localProbe={localProbe} hostedProbe={hostedProbe} workspace={workspace} onPortChange={async port => { const next = await metrora.harnessProfileSetPort(port); setProfile(next); if (runtime === 'llama-server') void probeLocal('llama-server', port) }} onCredentialChange={async secret => { await metrora.harnessCredentialSet(hostedProvider, secret); void probeHosted(hostedProvider) }} onConsentChange={changeHostedConsent} onCheckConformance={() => void checkConformance()} conformance={selectedConformance} />}
        </div>

        <footer className="harness-composer-area">
          <div className="harness-composer-context"><span className="harness-context-chip">{MODES.find(item => item.id === mode)?.description}</span><i aria-hidden="true">·</i><span className="harness-context-chip">{workspace ? workspace.displayName : 'No Workspace'}</span><i aria-hidden="true">·</i><span className="harness-context-chip">{model || 'No model selected'}</span>{selectedConformance?.state === 'verified' && <span className="harness-verified">Verified</span>}</div>
          <div className="harness-composer">
            <textarea aria-label="Ask Metrora Harness" placeholder={routeReady ? 'Ask the selected Agent to inspect, explain, edit, or build…' : 'Select an available model to begin…'} value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} disabled={busy || !routeReady} rows={3} />
            <div className="harness-composer-actions"><span className="harness-composer-hint">Enter to send · Shift+Enter for a new line</span>{busy ? <button type="button" className="harness-stop-button" onClick={() => void stop()}>Stop</button> : <button type="button" className="harness-send-button" onClick={() => void send()} disabled={!composer.trim() || !routeReady || !model}>Send <span>↗</span></button>}</div>
          </div>
        </footer>
      </div>
    </section>
  )
}

function EmptyHarnessState({ workspace, onPrompt }: { workspace: HarnessWorkspace | null; onPrompt: (value: string) => void }) {
  const prompts = workspace ? [
    ['Inspect', 'Summarize this Workspace and identify the key files.'],
    ['Explain', 'Explain the architecture of this project.'],
    ['Plan', 'Plan a small, testable improvement for this project.'],
    ['Git', 'Show the current Git status and changed files.'],
  ] : [
    ['Workspace', 'Open a local Workspace to start coding.'],
    ['Usage', 'What is my current provider-reported usage?'],
    ['Models', 'Which models are available in this Harness?'],
    ['Plan', 'Help me plan a coding task.'],
  ]
  return <div className="harness-empty"><div className="harness-empty-mark"><div className="harness-empty-orb" aria-hidden="true"><span /><span /></div><MetroraMark size={38} /></div><span className="harness-eyebrow">METRORA HARNESS</span><h2>A calm, capable place to work with your code.</h2><p>{workspace ? 'Ask the selected Agent to inspect files, use Metrora evidence, make bounded edits, run tests, and explain the result.' : 'Open a local Workspace, select a runtime and model, then start a durable coding Session.'}</p><div className="harness-prompt-grid">{prompts.map(([label, prompt]) => <button type="button" key={label} onClick={() => onPrompt(prompt)}><small>{label}</small><span>{prompt}</span><b>↗</b></button>)}</div></div>
}

function ConversationMessage({ message, showReasoning }: { message: HarnessConversationMessage; showReasoning: boolean }) {
  if (message.role === 'user') return <div className="harness-user-message"><span>You</span><p>{message.text}</p></div>
  return <article className="harness-assistant-message"><div className="harness-message-heading"><MetroraMark size={20} /><strong>Harness Agent</strong>{message.interrupted && <span className="harness-interrupted">Interrupted</span>}</div>{message.reasoning && showReasoning && <details className="harness-reasoning"><summary>Reasoning</summary><p>{message.reasoning}</p></details>}{message.process?.length ? <ProcessFold items={message.process} active={false} onApprovalResolved={() => {}} /> : null}<p className="harness-answer">{message.text || 'The Agent completed this turn without a final text response.'}</p></article>
}

function ProcessFold({ items, active, onApprovalResolved }: { items: HarnessProcessItem[]; active: boolean; onApprovalResolved: (id: string) => void }) {
  const toolCount = items.filter(item => item.kind === 'tool').length
  const editCount = items.filter(item => item.kind === 'tool' && ['write', 'edit'].includes(item.item.name)).length
  const commandCount = items.filter(item => item.kind === 'tool' && item.item.kind === 'terminal').length
  const label = active ? 'Live process' : `${toolCount ? `Used ${toolCount} Tool${toolCount === 1 ? '' : 's'}` : 'Process'}${editCount ? ` · edited ${editCount}` : ''}${commandCount ? ` · ran ${commandCount} command${commandCount === 1 ? '' : 's'}` : ''}`
  return <details className="harness-process-fold" open={active}><summary><span>{label}</span><small>{active ? 'Active' : 'Show details'}</small></summary><div className="harness-process-list">{items.map(item => item.kind === 'tool' ? <ToolCard key={`tool-${item.item.callId}`} item={item.item} /> : item.kind === 'approval' ? <ApprovalCard key={`approval-${item.item.approvalId}`} item={item.item} onResolved={onApprovalResolved} /> : item.kind === 'agent' ? <div className="harness-agent-card" key={`agent-${item.item.agentId}`}><span>◎</span><div><strong>{item.item.task}</strong><small>{item.item.state} · Agent {item.item.agentId.slice(0, 8)}</small>{item.item.result && <p>{item.item.result}</p>}</div></div> : item.kind === 'reasoning' ? <div className="harness-reasoning-line" key={item.id}><span>Reasoning</span><p>{item.text}</p></div> : <div className="harness-status-line" key={item.id}>{item.text}</div>)}</div></details>
}

function ToolCard({ item }: { item: HarnessToolProjection }) {
  const details = item.details
  return <div className={`harness-tool-card ${item.status}`} data-kind={item.kind} data-status={item.status}><div className="harness-tool-icon">{toolIcon(item.kind)}</div><div className="harness-tool-body"><div className="harness-tool-head"><strong>{item.name}</strong><span className={`harness-tool-status ${item.status}`}><i aria-hidden="true" />{statusLabel(item.status)}</span></div><p>{item.inputSummary}</p>{item.path && <code>{item.path}</code>}{item.command && <code>{item.command}</code>}{item.resultSummary && <small>{item.resultSummary}{item.exitCode !== undefined && item.exitCode !== null ? ` · exit ${item.exitCode}` : ''}</small>}{details && <details className="harness-tool-details"><summary>Show details</summary><ToolDetails details={details} /></details>}</div></div>
}

function ToolDetails({ details }: { details: NonNullable<HarnessToolProjection['details']> }) {
  if (details.kind === 'read') return <div className="harness-code-preview"><small>{details.path} · {details.totalLines} lines</small><pre>{details.lines.map(line => `${String(line.number).padStart(4, ' ')} │ ${line.text}`).join('\n')}</pre></div>
  if (details.kind === 'search') return <div className="harness-search-preview"><small>{details.total} result{details.total === 1 ? '' : 's'}{details.truncated ? ' · output capped' : ''}</small>{details.paths?.map(path => <code key={path}>{path}</code>)}{details.files?.map(file => <div key={file.path}><code>{file.path}</code>{file.matches.map(match => <p key={`${file.path}:${match.lineNumber}`}><b>{match.lineNumber}</b> {match.line}</p>)}</div>)}</div>
  if (details.kind === 'diff') return <div className="harness-diff-preview">{details.diffs.map(diff => <div key={diff.path}><small>{diff.path}</small><pre>{diff.oldText !== null && diff.oldText.split('\n').slice(0, 240).map((line, index) => <span className="removed" key={`old-${index}`}>- {line}{'\n'}</span>)}{diff.newText.split('\n').slice(0, 240).map((line, index) => <span className="added" key={`new-${index}`}>+ {line}{'\n'}</span>)}</pre></div>)}</div>
  if (details.kind === 'terminal') return <div className="harness-terminal-preview"><pre>{details.output || '(no output)'}</pre>{details.signal ? <small>signal {details.signal}</small> : details.exitCode !== undefined ? <small>exit {details.exitCode ?? 'unknown'}</small> : null}</div>
  return <div className="harness-web-preview">{details.title && <strong>{details.title}</strong>}{details.url && <code>{details.url}</code>}{details.excerpt && <p>{details.excerpt}</p>}</div>
}

function ApprovalCard({ item, onResolved }: { item: HarnessApprovalProjection; onResolved: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const resolve = async (allow: boolean) => {
    setBusy(true)
    try { const accepted = allow ? await metrora.harnessApprove(item.approvalId) : await metrora.harnessDeny(item.approvalId); if (accepted) onResolved(item.approvalId) }
    finally { setBusy(false) }
  }
  return <div className={`harness-approval-card ${item.state}`}><div><strong>Shield · {item.toolName}</strong><span>{item.risk.replaceAll('-', ' ')}</span></div><p>{item.action}</p>{item.workspacePath && <code>{item.workspacePath}</code>}{item.command && <code>{item.command}</code>}{item.state === 'proposed' ? <div className="harness-approval-actions"><button type="button" onClick={() => void resolve(true)} disabled={busy}>Approve</button><button type="button" className="quiet" onClick={() => void resolve(false)} disabled={busy}>Deny</button></div> : <small>{item.state}</small>}</div>
}

function HarnessSettings({ profile, runtime, hostedProvider, hostedConsent, localProbe, hostedProbe, workspace, onPortChange, onCredentialChange, onConsentChange, onCheckConformance, conformance }: { profile: HarnessRuntimeProfileV1; runtime: HarnessRuntimeChoice; hostedProvider: HarnessHostedProvider; hostedConsent: 'unknown' | 'accepted' | 'declined'; localProbe: HarnessLocalProbe | null; hostedProbe: { detail: string; credentialState: string } | null; workspace: HarnessWorkspace | null; onPortChange: (port: number) => Promise<void>; onCredentialChange: (secret: string) => Promise<void>; onConsentChange: (state: 'unknown' | 'accepted' | 'declined') => Promise<void>; onCheckConformance: () => void; conformance?: HarnessConversation['conformance'] }) {
  const [port, setPort] = useState(String(profile.llamaServerPort))
  const [secret, setSecret] = useState('')
  return <aside className="harness-settings" aria-label="Harness settings"><div className="harness-settings-head"><div><span className="harness-eyebrow">RUNTIME SETTINGS</span><h2>Provider & Workspace</h2></div><span className="harness-settings-state">{runtime === 'hosted' ? hostedProbe?.credentialState ?? 'not checked' : localProbe?.discoveryState ?? 'not checked'}</span></div><div className="harness-settings-grid">{runtime === 'llama-server' && <label><span>llama.cpp loopback port</span><div className="harness-inline-input"><input aria-label="llama.cpp port" inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} /><button type="button" onClick={() => void onPortChange(Number(port))}>Apply</button></div><small>Default 8080 · loopback only</small></label>}{runtime === 'hosted' && <><label><span>{hostedProvider} credential</span><div className="harness-inline-input"><input aria-label="Hosted provider credential" type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} placeholder="Stored in the OS vault" /><button type="button" onClick={() => { void onCredentialChange(secret); setSecret('') }}>Save</button></div><small>{hostedProbe?.detail ?? 'Credentials never enter the Session or profile.'}</small></label><label className="harness-consent"><span>Hosted provider consent</span><select aria-label="Hosted provider consent" value={hostedConsent} onChange={event => void onConsentChange(event.target.value as 'unknown' | 'accepted' | 'declined')}><option value="unknown">Ask before sending</option><option value="accepted">Allow hosted requests</option><option value="declined">Decline hosted requests</option></select><small>Requests go directly to {hostedProvider}; credentials stay in the OS vault and never enter the Session.</small></label></> }<div className="harness-settings-fact"><span>Workspace</span><strong>{workspace?.displayName ?? 'Not selected'}</strong><small>{workspace ? 'Coding Tools are fenced to this folder.' : 'Choose a local folder from the header.'}</small></div><div className="harness-settings-fact"><span>Exact model conformance</span><strong>{conformance?.state ?? 'Not checked'}</strong><small>Verified requires a native Tool round trip and final synthesis.</small><button type="button" className="harness-link-button" onClick={onCheckConformance}>Run conformance again</button></div></div></aside>
}
