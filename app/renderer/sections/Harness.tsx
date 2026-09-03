import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { MetroraMark } from '../components/MetroraMark'
import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import { readStorage, writeStorage } from '../lib/storage'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import { createHarnessEvidenceScope, reasoningProfileKey } from '../../electron/harness-runtime-types'
import { HarnessSettings } from './HarnessSettings'
import type {
  HarnessApprovalProjection,
  HarnessConversation,
  HarnessConversationInput,
  HarnessConversationMessage,
  HarnessConversationSummary,
  HarnessHostedModel,
  HarnessHostedProvider,
  HarnessLocalProbe,
  HarnessMcpServerConfig,
  HarnessMcpServerStatus,
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
type ActiveSessionSelection = {
  id: string
  runtime: HarnessRuntimeChoice
  provider: HarnessHostedProvider | null
  model: string
  mode: HarnessMode
  reasoningEffort: HarnessReasoningEffort | null
  workspaceId: string | null
  scope: HarnessConversationInput['scope']
}
type HarnessRouteIntent = {
  runtime: HarnessRuntimeChoice
  provider: HarnessHostedProvider | null
}

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
  { id: 'ask', label: 'Ask', description: 'Conversation and inspection' },
  { id: 'plan', label: 'Plan', description: 'Read-only plan' },
  { id: 'edit', label: 'Edit', description: 'Focused Workspace changes' },
  { id: 'build', label: 'Build', description: 'Full coding loop' },
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
  mcpServers: [],
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

function processItemsFromEvent(current: HarnessProcessItem[], event: MetroraHarnessRuntimeEvent): HarnessProcessItem[] {
  const incoming = event.process
  if (!incoming) return current
  const terminalToolStatuses = new Set<HarnessToolProjection['status']>(['completed', 'failed', 'interrupted', 'denied'])
  const mergeTool = (previous: HarnessToolProjection, next: HarnessToolProjection): HarnessToolProjection => {
    const merged = { ...previous, ...next }
    if (terminalToolStatuses.has(previous.status) && !terminalToolStatuses.has(next.status)) merged.status = previous.status
    return merged
  }
  if (incoming.kind === 'tool') {
    const index = current.findIndex(item => item.kind === 'tool' && item.item.callId === incoming.item.callId)
    if (index < 0) return [...current, incoming]
    return current.map((item, itemIndex) => itemIndex === index && item.kind === 'tool' ? { kind: 'tool', item: mergeTool(item.item, incoming.item) } : item)
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
  return kind === 'filesystem' ? '▧' : kind === 'search' ? '⌕' : kind === 'terminal' ? '›_' : kind === 'git' ? '⑂' : kind === 'web' ? '↗' : kind === 'metrora' ? '◈' : kind === 'mcp' ? '⌘' : kind === 'subagent' ? '◎' : '·'
}

function movePickerFocus(event: ReactKeyboardEvent<HTMLDivElement>, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')]
  if (!items.length) return
  event.preventDefault()
  const current = document.activeElement
  const index = items.indexOf(current as HTMLElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  items[next]?.focus()
}

function conformanceLabel(state: HarnessConversation['conformance']['state'] | undefined): string {
  return state === 'verified' ? 'Verified' : state === 'checking' ? 'Checking' : state === 'limited' ? 'Limited' : state === 'failed-conformance' ? 'Failed' : 'Unverified'
}

function HarnessModePicker({ value, open, onToggle, onChange, onClose }: { value: HarnessMode; open: boolean; onToggle: () => void; onChange: (value: HarnessMode) => void; onClose: () => void }) {
  const selected = MODES.find(item => item.id === value) ?? MODES[0]!
  return <div className="harness-picker harness-mode-picker">
    <button type="button" className="harness-picker-button" aria-label="Harness mode" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}><span className="harness-picker-caption">Mode</span><strong>{selected.label}</strong><span className="harness-picker-chevron" aria-hidden="true">⌄</span></button>
    {open && <div className="harness-picker-menu harness-mode-menu" role="menu" aria-label="Harness mode menu" onKeyDown={event => movePickerFocus(event, onClose)}>
      <div className="harness-picker-menu-title">Session mode</div>
      {MODES.map(item => <button type="button" role="menuitemradio" aria-checked={item.id === value} className={`harness-picker-option${item.id === value ? ' selected' : ''}`} key={item.id} onClick={() => { onChange(item.id); onClose() }}><span className="harness-picker-check" aria-hidden="true">{item.id === value ? '✓' : ''}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
    </div>}
  </div>
}

function HarnessRoutePicker({ runtime, provider, open, onToggle, onChange, onClose }: { runtime: HarnessRuntimeChoice; provider: HarnessHostedProvider; open: boolean; onToggle: () => void; onChange: (runtime: HarnessRuntimeChoice, provider: HarnessHostedProvider | null) => void; onClose: () => void }) {
  const currentLabel = runtime === 'hosted' ? runtimeLabel(runtime, provider) : runtimeLabel(runtime, null)
  return <div className="harness-picker harness-route-picker">
    <button type="button" className="harness-picker-button" aria-label="Harness runtime and provider" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}><span className="harness-picker-caption">Route</span><strong>{currentLabel}</strong><span className="harness-picker-chevron" aria-hidden="true">⌄</span></button>
    {open && <div className="harness-picker-menu harness-route-menu" role="menu" aria-label="Harness runtime and provider menu" onKeyDown={event => movePickerFocus(event, onClose)}>
      <div className="harness-picker-menu-title">Local runtimes</div>
      {LOCAL_RUNTIMES.map(item => <button type="button" role="menuitemradio" aria-checked={runtime === item.id} className={`harness-picker-option${runtime === item.id ? ' selected' : ''}`} key={item.id} onClick={() => { onChange(item.id, null); onClose() }}><span className="harness-picker-check" aria-hidden="true">{runtime === item.id ? '✓' : ''}</span><span><strong>{item.label}</strong><small>Local coding runtime</small></span></button>)}
      <div className="harness-picker-menu-title">Hosted providers</div>
      {HOSTED_PROVIDERS.map(item => <button type="button" role="menuitemradio" aria-checked={runtime === 'hosted' && provider === item.id} className={`harness-picker-option${runtime === 'hosted' && provider === item.id ? ' selected' : ''}`} key={item.id} onClick={() => { onChange('hosted', item.id); onClose() }}><span className="harness-picker-check" aria-hidden="true">{runtime === 'hosted' && provider === item.id ? '✓' : ''}</span><span><strong>{item.label}</strong><small>Hosted coding route</small></span></button>)}
    </div>}
  </div>
}

function HarnessModelPicker({ runtime, provider, model, options, reasoningEffort, reasoningEfforts, conformance, open, onToggle, onModel, onReasoning, onVerify, onClose }: { runtime: HarnessRuntimeChoice; provider: HarnessHostedProvider; model: string; options: string[]; reasoningEffort: HarnessReasoningEffort | null; reasoningEfforts: HarnessReasoningEffort[]; conformance?: HarnessConversation['conformance']; open: boolean; onToggle: () => void; onModel: (model: string) => void; onReasoning: (effort: string) => void; onVerify: () => void; onClose: () => void }) {
  const [view, setView] = useState<'root' | 'models' | 'reasoning'>('root')
  useEffect(() => { if (!open) setView('root') }, [open])
  const route = runtime === 'hosted' ? runtimeLabel(runtime, provider) : runtimeLabel(runtime, null)
  const status = conformanceLabel(conformance?.state)
  const selectedReasoning = reasoningEffort ?? 'Provider default'
  const title = view === 'root' ? 'Model' : view === 'models' ? 'Models' : 'Reasoning'
  return <div className="harness-picker harness-model-picker">
    <button type="button" className="harness-picker-button harness-model-picker-button" aria-label="Harness model" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}><span className="harness-picker-caption">Model</span><strong title={model || 'Choose a model'}>{model || 'Choose model'}</strong><small>{selectedReasoning}</small><span className="harness-picker-chevron" aria-hidden="true">⌄</span></button>
    {open && <div className="harness-picker-menu harness-model-menu" role="menu" aria-label="Harness model menu" onKeyDown={event => movePickerFocus(event, onClose)}>
      {view !== 'root' && <button type="button" className="harness-picker-back" role="menuitem" onClick={() => setView('root')}><span aria-hidden="true">‹</span> Model selection</button>}
      <div className="harness-picker-menu-title">{title}</div>
      {view === 'root' && <>
        <button type="button" className="harness-picker-submenu" role="menuitem" onClick={() => setView('models')}><span><strong>{model || 'Choose model'}</strong><small>{route}</small></span><span aria-hidden="true">›</span></button>
        <button type="button" className="harness-picker-submenu" role="menuitem" onClick={() => setView('reasoning')}><span><strong>{selectedReasoning}</strong><small>Reasoning variant</small></span><span aria-hidden="true">›</span></button>
        <div className={`harness-conformance-state ${conformance?.state ?? 'unverified'}`}><span className="harness-status-dot" /><span>{status}{conformance?.state === 'verified' ? ' · exact route' : ' · exact route check'}</span>{conformance?.state !== 'verified' && <button type="button" onClick={onVerify}>Verify</button>}</div>
      </>}
      {view === 'models' && <>
        <div className="harness-picker-group-label">{route}</div>
        {options.length ? options.map(option => <button type="button" role="menuitemradio" aria-checked={option === model} className={`harness-picker-option${option === model ? ' selected' : ''}`} key={option} onClick={() => { onModel(option); onClose() }}><span className="harness-picker-check" aria-hidden="true">{option === model ? '✓' : ''}</span><span><strong title={option}>{option}</strong><small>{option === model ? 'Selected Session model' : 'Use in this Session'}</small></span></button>) : <p className="harness-picker-empty">Discovering models for this route…</p>}
      </>}
      {view === 'reasoning' && <>
        <button type="button" role="menuitemradio" aria-checked={reasoningEffort === null} className={`harness-picker-option${reasoningEffort === null ? ' selected' : ''}`} onClick={() => { onReasoning(''); onClose() }}><span className="harness-picker-check" aria-hidden="true">{reasoningEffort === null ? '✓' : ''}</span><span><strong>Provider default</strong><small>Use the route default</small></span></button>
        {reasoningEfforts.map(effort => <button type="button" role="menuitemradio" aria-checked={effort === reasoningEffort} className={`harness-picker-option${effort === reasoningEffort ? ' selected' : ''}`} key={effort} onClick={() => { onReasoning(effort); onClose() }}><span className="harness-picker-check" aria-hidden="true">{effort === reasoningEffort ? '✓' : ''}</span><span><strong>{effort}</strong><small>Provider/model capability</small></span></button>)}
        {!reasoningEfforts.length && <p className="harness-picker-empty">No exact variants were advertised; provider default is the truthful option.</p>}
      </>}
    </div>}
  </div>
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
  const [mcpStatuses, setMcpStatuses] = useState<HarnessMcpServerStatus[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [openPicker, setOpenPicker] = useState<'mode' | 'route' | 'model' | null>(null)
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
  const activeSelectionRef = useRef<ActiveSessionSelection | null>(null)
  const routeIntentRef = useRef<HarnessRouteIntent | null>(null)
  const pickerControlsRef = useRef<HTMLDivElement | null>(null)
  const selectionRevisionRef = useRef(0)
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
  // Harness factual authority is intentionally independent from dashboard
  // presentation filters and from the selected Agent model. Individual
  // Metrora Tools may still request a bounded refinement through their own
  // schemas; the base Session scope remains broad and model-null.
  const currentScope = useMemo(() => createHarnessEvidenceScope(), [])
  const filteredConversations = conversations.filter(item => !historyQuery.trim() || item.title.toLowerCase().includes(historyQuery.toLowerCase()))

  const selectionForConversation = useCallback((next: HarnessConversation): ActiveSessionSelection => ({
    id: next.id,
    runtime: next.runtime,
    provider: next.provider,
    model: next.model === 'unknown-model' ? '' : next.model,
    mode: next.mode,
    reasoningEffort: next.reasoningEffort,
    workspaceId: next.workspace?.id ?? null,
    scope: currentScope,
  }), [currentScope])

  const applyConversationState = useCallback((next: HarnessConversation | null) => {
    setConversation(next)
    activeIdRef.current = next?.id ?? null
    setActiveId(next?.id ?? null)
    routeIntentRef.current = null
    if (!next) {
      activeSelectionRef.current = null
      return
    }
    const selection = selectionForConversation(next)
    activeSelectionRef.current = selection
    setWorkspace(next.workspace)
    setRuntime(next.runtime)
    if (next.provider) setHostedProvider(next.provider)
    setModel(selection.model)
    setMode(next.mode)
    setReasoningEffort(next.reasoningEffort)
    setHostedConsent(next.provider ? profile.hostedConsentByProvider[next.provider] ?? 'unknown' : 'unknown')
  }, [profile.hostedConsentByProvider, selectionForConversation])

  const inputForSelection = useCallback((selection: ActiveSessionSelection): HarnessConversationInput => ({
    conversationId: selection.id,
    runtime: selection.runtime,
    ...(selection.runtime === 'hosted' && selection.provider ? { provider: selection.provider } : {}),
    model: selection.model,
    mode: selection.mode,
    reasoningEffort: selection.reasoningEffort,
    workspaceId: selection.workspaceId,
    scope: selection.scope,
  }), [])

  const syncSessionSelection = useCallback(async (selection: ActiveSessionSelection): Promise<void> => {
    if (typeof metrora.harnessSelectModelForSession !== 'function') return
    const revision = ++selectionRevisionRef.current
    try {
      const next = await metrora.harnessSelectModelForSession(inputForSelection(selection))
      if (revision !== selectionRevisionRef.current || !next) return
      activeSelectionRef.current = selectionForConversation(next)
      setConversation(next)
    } catch (caught) {
      if (revision === selectionRevisionRef.current) setError(errorText(caught))
    }
  }, [inputForSelection, selectionForConversation])

  const commitActiveRoute = useCallback(async (nextRuntime: HarnessRuntimeChoice, nextProvider: HarnessHostedProvider | null, nextModel: string, nextReasoningEffort: HarnessReasoningEffort | null): Promise<void> => {
    const id = activeIdRef.current
    if (!id || !nextModel) return
    const previous = activeSelectionRef.current
    const selection: ActiveSessionSelection = {
      id,
      runtime: nextRuntime,
      provider: nextRuntime === 'hosted' ? nextProvider : null,
      model: nextModel,
      mode: previous?.mode ?? mode,
      reasoningEffort: nextReasoningEffort,
      workspaceId: previous?.workspaceId ?? workspace?.id ?? null,
      scope: previous?.scope ?? currentScope,
    }
    activeSelectionRef.current = selection
    setRuntime(nextRuntime)
    if (nextProvider) setHostedProvider(nextProvider)
    setModel(nextModel)
    setReasoningEffort(nextReasoningEffort)
    await syncSessionSelection(selection)
  }, [currentScope, mode, syncSessionSelection, workspace?.id])

  const refreshSessions = useCallback(async (preferredId?: string | null) => {
    const workspaceRevision = workspaceRevisionRef.current
    const rows = await metrora.harnessListConversations()
    setConversations(rows)
    const candidate = preferredId ?? activeIdRef.current ?? readStorage('harness.activeSession')
    const selected = rows.some(row => row.id === candidate) ? candidate : rows[0]?.id ?? null
    setActiveId(selected)
    activeIdRef.current = selected
    if (selected) writeStorage('harness.activeSession', selected)
    if (selected) {
      const next = await metrora.harnessGetConversation(selected)
      if (next && workspaceRevisionRef.current === workspaceRevision) {
        applyConversationState(next)
      } else if (!next) applyConversationState(null)
    } else applyConversationState(null)
  }, [applyConversationState])

  const loadProfile = useCallback(async () => {
    const workspaceRevision = workspaceRevisionRef.current
    try {
      const mcpStatusPromise = typeof metrora.harnessMcpGet === 'function' ? metrora.harnessMcpGet().catch(() => []) : Promise.resolve([])
      const [nextProfile, nextWorkspace, nextMcpStatuses] = await Promise.all([metrora.harnessProfileGet(), metrora.harnessWorkspaceGet(), mcpStatusPromise])
      setProfile(nextProfile)
      setMcpStatuses(nextMcpStatuses)
      if (workspaceRevisionRef.current === workspaceRevision) setWorkspace(nextWorkspace)
      // A profile is a default/preferences source only. Once a Session has
      // been hydrated or explicitly selected, it is not allowed to reset the
      // Session's route, model, mode, or reasoning choice.
      if (activeIdRef.current || activeSelectionRef.current) return
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
      const sessionSelection = activeSelectionRef.current
      const requestedRoute = routeIntentRef.current?.runtime === nextRuntime && routeIntentRef.current.provider === null
      const preserveSessionModel = !requestedRoute && sessionSelection?.runtime === nextRuntime
      let nextModel = preserveSessionModel ? sessionSelection.model : model
      if (!preserveSessionModel && result.models.length && (!model || !result.models.includes(model))) {
        const remembered = profile.lastLocalModelByRuntime[nextRuntime]
        nextModel = remembered && result.models.includes(remembered) ? remembered : result.models[0]!
      }
      if (requestedRoute && result.models.length && (!nextModel || !result.models.includes(nextModel))) nextModel = result.models[0]!
      const efforts = result.capabilities.find(item => item.modelId === nextModel)?.reasoningEfforts ?? []
      if (preserveSessionModel) {
        setModel(sessionSelection.model)
        setReasoningEffort(sessionSelection.reasoningEffort)
      } else {
        setModel(nextModel)
        const savedEffort = nextModel ? profile.reasoningByModel[reasoningProfileKey(nextRuntime, null, nextModel)] ?? null : null
        const nextEffort = savedEffort && efforts.includes(savedEffort) ? savedEffort : null
        setReasoningEffort(nextEffort)
        if (requestedRoute && nextModel && activeIdRef.current) {
          void commitActiveRoute(nextRuntime, null, nextModel, nextEffort).then(() => {
            if (routeIntentRef.current?.runtime === nextRuntime && routeIntentRef.current.provider === null) routeIntentRef.current = null
          })
        }
      }
      setNotice(result.available ? `${runtimeLabel(nextRuntime, null)} ready · ${result.models.length} model${result.models.length === 1 ? '' : 's'} discovered.` : result.detail)
    } catch (caught) { if (localProbeRevisionRef.current === revision) { setLocalProbe(null); setNotice(errorText(caught)) } }
  }, [commitActiveRoute, model, profile.lastLocalModelByRuntime, profile.llamaServerPort, profile.reasoningByModel])

  const probeHosted = useCallback(async (nextProvider: HarnessHostedProvider) => {
    const revision = ++hostedProbeRevisionRef.current
    setHostedProbe(current => ({ provider: nextProvider, available: false, models: [], detail: 'Checking provider…', credentialState: current?.provider === nextProvider ? current.credentialState : 'not-configured' }))
    try {
      const result = await metrora.harnessProbeHosted(nextProvider)
      if (hostedProbeRevisionRef.current !== revision) return
      setHostedProbe(result)
      const sessionSelection = activeSelectionRef.current
      const requestedRoute = routeIntentRef.current?.runtime === 'hosted' && routeIntentRef.current.provider === nextProvider
      const preserveSessionModel = !requestedRoute && sessionSelection?.runtime === 'hosted' && sessionSelection.provider === nextProvider
      const remembered = profile.lastHostedModelByProvider[nextProvider]
      let nextModel = preserveSessionModel
        ? sessionSelection.model
        : remembered && result.models.some(item => item.id === remembered) ? remembered : result.models[0]?.id ?? ''
      if (requestedRoute && result.models.length && (!nextModel || !result.models.some(item => item.id === nextModel))) nextModel = result.models[0]?.id ?? ''
      setModel(nextModel)
      setHostedConsent(profile.hostedConsentByProvider[nextProvider] ?? 'unknown')
      const efforts = result.models.find(item => item.id === nextModel)?.reasoningEfforts ?? []
      const savedEffort = nextModel ? profile.reasoningByModel[reasoningProfileKey('hosted', nextProvider, nextModel)] ?? null : null
      const nextEffort = preserveSessionModel ? sessionSelection.reasoningEffort : savedEffort && efforts.includes(savedEffort) ? savedEffort : null
      setReasoningEffort(nextEffort)
      if (requestedRoute && nextModel && activeIdRef.current) {
        void commitActiveRoute('hosted', nextProvider, nextModel, nextEffort).then(() => {
          if (routeIntentRef.current?.runtime === 'hosted' && routeIntentRef.current.provider === nextProvider) routeIntentRef.current = null
        })
      }
      setNotice(result.available ? `${runtimeLabel('hosted', nextProvider)} ready · ${result.models.length} model${result.models.length === 1 ? '' : 's'} discovered.` : result.detail)
    } catch (caught) { if (hostedProbeRevisionRef.current === revision) { setHostedProbe(null); setNotice(errorText(caught)) } }
  }, [commitActiveRoute, profile.hostedConsentByProvider, profile.lastHostedModelByProvider, profile.reasoningByModel])

  useEffect(() => { void loadProfile() }, [loadProfile])
  useEffect(() => { void refreshSessions() }, [refreshSessions])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => {
    if (!openPicker) return
    const closeOutside = (event: PointerEvent) => {
      if (!pickerControlsRef.current?.contains(event.target as Node)) setOpenPicker(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPicker(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openPicker])
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
    applyConversationState(next)
  }, [applyConversationState, busy])

  const makeConversation = useCallback(async () => {
    if (!routeReady || !model) { setNotice('Select a discovered model before starting a Session.'); return }
    if (runtime === 'hosted' && hostedConsent !== 'accepted') { setError('Accept hosted provider consent in Settings before creating a hosted Session.'); return }
    try {
      const created = await metrora.harnessCreateConversation({ runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: workspace?.id ?? null, scope: currentScope })
      setConversations(current => [created, ...current.filter(item => item.id !== created.id)])
      setActiveId(created.id)
      activeIdRef.current = created.id
      writeStorage('harness.activeSession', created.id)
      applyConversationState(created)
      setError(null)
      setNotice(null)
    } catch (caught) { setError(errorText(caught)) }
  }, [applyConversationState, currentScope, hostedConsent, hostedProvider, mode, model, reasoningEffort, routeReady, runtime, workspace?.id])

  const send = useCallback(async (retry = false) => {
    const question = (retry ? failedTurn?.question ?? '' : composer).trim()
    if (!question || busy || !routeReady || !model) return
    if (runtime === 'hosted' && hostedConsent !== 'accepted') {
      setError(hostedConsent === 'declined' ? 'Hosted use is declined for this provider. Accept the consent in Settings to continue.' : 'Accept hosted provider consent in Settings before sending a request.')
      return
    }
    let id = activeIdRef.current
    if (!id) {
      try {
        const created = await metrora.harnessCreateConversation({ runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: workspace?.id ?? null, scope: currentScope })
        id = created.id
        setActiveId(id)
        activeIdRef.current = id
        setConversations(current => [created, ...current])
        writeStorage('harness.activeSession', id)
        applyConversationState(created)
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
  }, [applyConversationState, busy, composer, currentScope, failedTurn, hostedConsent, hostedProvider, mode, model, reasoningEffort, routeReady, runtime, workspace?.id])

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
      const currentSelection = activeSelectionRef.current
      if (currentSelection) void syncSessionSelection({ ...currentSelection, workspaceId: selected.id })
      setNotice(`Workspace ready · ${selected.displayName}`)
    } catch (caught) { setError(errorText(caught)) }
    finally { setLoadingWorkspace(false) }
  }, [syncSessionSelection])

  const changeRoute = useCallback(async (nextRuntime: HarnessRuntimeChoice, nextProvider: HarnessHostedProvider | null) => {
    const normalizedProvider = nextRuntime === 'hosted' ? nextProvider ?? 'openai' : null
    if (runtime === nextRuntime && (nextRuntime !== 'hosted' || hostedProvider === normalizedProvider)) return
    routeIntentRef.current = { runtime: nextRuntime, provider: normalizedProvider }
    setRuntime(nextRuntime)
    setHostedProvider(normalizedProvider ?? hostedProvider)
    setLocalProbe(null)
    setHostedProbe(null)
    if (nextRuntime === 'hosted') setHostedConsent(profile.hostedConsentByProvider[normalizedProvider!] ?? 'unknown')

    const discoveredModels = nextRuntime === 'hosted'
      ? hostedProbe?.provider === normalizedProvider && hostedProbe.available ? hostedProbe.models : []
      : localProbe?.runtime === nextRuntime && localProbe.available ? localProbe.models.map(modelId => ({ id: modelId, reasoningEfforts: localProbe.capabilities.find(item => item.modelId === modelId)?.reasoningEfforts ?? [] })) : []
    const remembered = nextRuntime === 'hosted'
      ? profile.lastHostedModelByProvider[normalizedProvider!]
      : profile.lastLocalModelByRuntime[nextRuntime]
    const candidate = remembered && (!discoveredModels.length || discoveredModels.some(item => item.id === remembered))
      ? remembered
      : discoveredModels[0]?.id ?? ''
    const candidateEfforts = discoveredModels.find(item => item.id === candidate)?.reasoningEfforts ?? []
    const savedEffort = candidate ? profile.reasoningByModel[reasoningProfileKey(nextRuntime, normalizedProvider, candidate)] ?? null : null
    const candidateEffort = savedEffort && candidateEfforts.includes(savedEffort) ? savedEffort : null
    setModel(candidate)
    setReasoningEffort(candidateEffort)
    if (candidate) {
      await commitActiveRoute(nextRuntime, normalizedProvider, candidate, candidateEffort)
      if (routeIntentRef.current?.runtime === nextRuntime && routeIntentRef.current.provider === normalizedProvider) routeIntentRef.current = null
    }
    await metrora.harnessProfileSetRuntime(nextRuntime).then(setProfile).catch(() => {})
  }, [commitActiveRoute, hostedProbe, hostedProvider, localProbe, profile.hostedConsentByProvider, profile.lastHostedModelByProvider, profile.lastLocalModelByRuntime, profile.reasoningByModel, runtime])

  const changeRuntime = useCallback(async (next: HarnessRuntimeChoice) => {
    await changeRoute(next, next === 'hosted' ? hostedProvider : null)
  }, [changeRoute, hostedProvider])

  const changeModel = useCallback(async (next: string) => {
    const efforts = runtime === 'hosted'
      ? hostedProbe?.provider === hostedProvider ? hostedProbe.models.find(item => item.id === next)?.reasoningEfforts ?? [] : []
      : localProbe?.runtime === runtime ? localProbe.capabilities.find(item => item.modelId === next)?.reasoningEfforts ?? [] : []
    const savedEffort = profile.reasoningByModel[reasoningProfileKey(runtime, runtime === 'hosted' ? hostedProvider : null, next)] ?? null
    const nextReasoningEffort = savedEffort && efforts.includes(savedEffort) ? savedEffort : null
    setModel(next)
    setReasoningEffort(nextReasoningEffort)
    const id = activeIdRef.current
    const nextSelection: ActiveSessionSelection | null = id ? {
      id,
      runtime,
      provider: runtime === 'hosted' ? hostedProvider : null,
      model: next,
      mode,
      reasoningEffort: nextReasoningEffort,
      workspaceId: workspace?.id ?? null,
      scope: currentScope,
    } : null
    if (nextSelection) {
      activeSelectionRef.current = nextSelection
      await syncSessionSelection(nextSelection)
      return
    }
    const nextProfile = runtime === 'hosted' ? await metrora.harnessProfileSetHostedModel(hostedProvider, next).catch(() => null) : await metrora.harnessProfileSetLocalModel(runtime, next).catch(() => null)
    if (nextProfile) setProfile(nextProfile)
  }, [currentScope, hostedProbe, hostedProvider, localProbe, mode, profile.reasoningByModel, runtime, syncSessionSelection, workspace?.id])

  const changeReasoning = useCallback(async (value: string) => {
    const next = value === '' ? null : value as HarnessReasoningEffort
    if (next && !availableReasoningEfforts.includes(next)) return
    setReasoningEffort(next)
    const id = activeIdRef.current
    if (id && model) {
      const nextSelection: ActiveSessionSelection = { id, runtime, provider: runtime === 'hosted' ? hostedProvider : null, model, mode, reasoningEffort: next, workspaceId: workspace?.id ?? null, scope: currentScope }
      activeSelectionRef.current = nextSelection
      await syncSessionSelection(nextSelection)
    } else if (next && model) {
      await metrora.harnessProfileSetReasoning(runtime, runtime === 'hosted' ? hostedProvider : null, model, next).then(setProfile).catch(() => {})
    }
  }, [availableReasoningEfforts, currentScope, hostedProvider, model, mode, runtime, syncSessionSelection, workspace?.id])

  const changeMode = useCallback(async (next: HarnessMode) => {
    setMode(next)
    const id = activeIdRef.current
    if (!id || !model) return
    const nextSelection: ActiveSessionSelection = { id, runtime, provider: runtime === 'hosted' ? hostedProvider : null, model, mode: next, reasoningEffort, workspaceId: workspace?.id ?? null, scope: currentScope }
    activeSelectionRef.current = nextSelection
    await syncSessionSelection(nextSelection)
  }, [currentScope, hostedProvider, model, mode, reasoningEffort, runtime, syncSessionSelection, workspace?.id])

  const changeHostedProvider = useCallback(async (next: HarnessHostedProvider) => {
    await changeRoute('hosted', next)
  }, [changeRoute])

  const changeHostedConsent = useCallback(async (state: 'unknown' | 'accepted' | 'declined') => {
    setHostedConsent(state)
    await metrora.harnessProfileSetConsent(hostedProvider, state).then(setProfile).catch(() => {})
  }, [hostedProvider])

  const saveMcpServers = useCallback(async (servers: HarnessMcpServerConfig[]) => {
    if (typeof metrora.harnessMcpSetServers !== 'function') throw new Error('MCP settings are unavailable in this Desktop build.')
    const result = await metrora.harnessMcpSetServers(servers)
    setProfile(result.profile)
    setMcpStatuses(result.statuses)
    return result
  }, [])

  const reloadMcpServer = useCallback(async (serverId: string) => {
    if (typeof metrora.harnessMcpReload !== 'function') throw new Error('MCP settings are unavailable in this Desktop build.')
    const result = await metrora.harnessMcpReload(serverId)
    setMcpStatuses(result)
    return result
  }, [])

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
  const statusState = activeStatus ?? (routeReady ? 'ready' : 'unavailable')
  const statusText = activeStatus
    ? activeStatus.replaceAll('-', ' ')
    : routeReady
      ? `${runtimeLabel(runtime, hostedProvider)} ready`
      : runtime === 'hosted' ? hostedProbe?.detail ?? 'Connect provider' : localProbe?.detail ?? 'Runtime unavailable'

  return (
    <section className="harness-shell" aria-label="Metrora Harness">
      <aside className="harness-session-rail" aria-label="Harness Sessions">
        <div className="harness-rail-brand"><MetroraMark size={24} /><div><strong>Metrora</strong><span>Harness</span></div></div>
        <button type="button" className="harness-new-session" onClick={() => void makeConversation()} disabled={!routeReady || busy}><span>＋</span> New Session</button>
        <label className="harness-session-search"><span aria-hidden="true">⌕</span><input aria-label="Search Harness Sessions" placeholder="Search Sessions" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} /></label>
        <div className="harness-session-list">
          {filteredConversations.length ? filteredConversations.map(item => (
            <button type="button" key={item.id} className={`harness-session-item${item.id === activeId ? ' active' : ''}`} onClick={() => void selectConversation(item.id)}>
              <span>{item.title}</span><small>{formatTime(item.updatedAt)} · {item.messageCount} {item.messageCount === 1 ? 'message' : 'messages'}</small>
            </button>
          )) : <p className="harness-muted">No prior Sessions yet.</p>}
        </div>
        <div className="harness-rail-foot"><span className="harness-status-dot" /> Local-first · Sessions</div>
      </aside>

      <div className="harness-main">
        <header className="harness-header">
          <div className="harness-title"><MetroraMark size={22} /><div className="harness-title-copy"><h1>{activeTitle}</h1><p>{workspace ? `Workspace · ${workspace.displayName}` : 'No Workspace selected'}</p></div></div>
          <div className="harness-header-actions">
            <div className="harness-header-status" data-state={statusState}><span className="harness-status-dot" />{statusText}</div>
            <button type="button" className="harness-workspace-pill" onClick={() => void openWorkspace()} disabled={loadingWorkspace} title="Choose local Workspace"><span>⌂</span>{workspace?.displayName ?? 'Open Workspace'}</button>
            <button type="button" className="harness-settings-button" onClick={() => setSettingsOpen(current => !current)} aria-expanded={settingsOpen}>Settings</button>
          </div>
        </header>

        <div className="harness-content">
          <main className="harness-thread" aria-live="polite">
            {conversation?.messages.length || busy ? (
              <div className="harness-thread-inner">
                {conversation?.messages.map(message => <ConversationMessage key={message.id} message={message} showReasoning={profile.ui.showReasoning} />)}
                {busy && (liveText || liveReasoning || liveProcess.length > 0) && <div className="harness-live-turn"><div className="harness-live-label"><span className="harness-thinking-dots"><i /><i /><i /></span>{liveReasoning ? 'Reasoning…' : liveProcess.length ? 'Working…' : 'Thinking…'}</div>{liveReasoning && <div className="harness-reasoning-preview">{liveReasoning}</div>}{liveText && <p>{liveText}</p>}{liveProcess.length > 0 && <ProcessFold items={liveProcess} active onApprovalResolved={() => {}} />}</div>}
                {busy && !liveText && !liveReasoning && !liveProcess.length && <div className="harness-live-turn"><div className="harness-live-label"><span className="harness-thinking-dots"><i /><i /><i /></span>Thinking…</div></div>}
              </div>
            ) : (
              <EmptyHarnessState workspace={workspace} />
            )}
            {error && <div className="harness-error" role="alert"><div><strong>Harness request failed</strong><p>{error}</p></div>{failedTurn && <button type="button" onClick={() => void send(true)} disabled={busy}>Retry</button>}</div>}
            {notice && !error && <div className="harness-notice" role="status">{notice}</div>}
          </main>
          {settingsOpen && <HarnessSettings profile={profile} runtime={runtime} hostedProvider={hostedProvider} hostedConsent={hostedConsent} localProbe={localProbe} hostedProbe={hostedProbe} workspace={workspace} mcpStatuses={mcpStatuses} onPortChange={async port => { const next = await metrora.harnessProfileSetPort(port); setProfile(next); if (runtime === 'llama-server') void probeLocal('llama-server', port) }} onCredentialChange={async secret => { await metrora.harnessCredentialSet(hostedProvider, secret); void probeHosted(hostedProvider) }} onConsentChange={changeHostedConsent} onMcpSave={saveMcpServers} onMcpReload={reloadMcpServer} onCheckConformance={() => void checkConformance()} conformance={selectedConformance} />}
        </div>

        <footer className="harness-composer-area">
          <div className="harness-composer-context" aria-live="polite"><span className="harness-context-chip">{runtimeLabel(runtime, runtime === 'hosted' ? hostedProvider : null)}</span><span className="harness-context-chip">{workspace ? workspace.displayName : 'No Workspace'}</span>{selectedConformance?.state === 'verified' && <span className="harness-verified">Verified</span>}</div>
          <div className="harness-composer">
            <textarea aria-label="Ask Metrora Harness" placeholder={routeReady ? 'Ask the selected Agent to inspect, explain, edit, or build…' : 'Select an available model to begin…'} value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} disabled={busy || !routeReady} rows={3} />
            <div className="harness-composer-actions">
              <div className="harness-composer-controls" ref={pickerControlsRef}>
                <HarnessModePicker value={mode} open={openPicker === 'mode'} onToggle={() => setOpenPicker(current => current === 'mode' ? null : 'mode')} onChange={next => void changeMode(next)} onClose={() => setOpenPicker(null)} />
                <HarnessRoutePicker runtime={runtime} provider={hostedProvider} open={openPicker === 'route'} onToggle={() => setOpenPicker(current => current === 'route' ? null : 'route')} onChange={(nextRuntime, nextProvider) => { if (nextRuntime === 'hosted' && nextProvider) void changeHostedProvider(nextProvider); else void changeRuntime(nextRuntime) }} onClose={() => setOpenPicker(null)} />
              </div>
              <div className="harness-composer-actions-right">
                <HarnessModelPicker runtime={runtime} provider={hostedProvider} model={model} options={modelOptions} reasoningEffort={reasoningEffort} reasoningEfforts={availableReasoningEfforts} conformance={selectedConformance} open={openPicker === 'model'} onToggle={() => setOpenPicker(current => current === 'model' ? null : 'model')} onModel={next => void changeModel(next)} onReasoning={next => void changeReasoning(next)} onVerify={() => { setOpenPicker(null); setSettingsOpen(true); void checkConformance() }} onClose={() => setOpenPicker(null)} />
                <span className="harness-composer-hint">Enter to send · Shift+Enter for line break</span>
                {busy ? <button type="button" className="harness-stop-button" aria-label="Stop Harness turn" onClick={() => void stop()}>Stop</button> : <button type="button" className="harness-send-button" aria-label="Send message" onClick={() => void send()} disabled={!composer.trim() || !routeReady || !model}><span aria-hidden="true">↗</span></button>}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </section>
  )
}

function EmptyHarnessState({ workspace }: { workspace: HarnessWorkspace | null }) {
  return <div className="harness-empty"><div className="harness-empty-headline"><span className="harness-empty-mark"><MetroraMark size={34} /></span><h2>{workspace ? 'How can I help with your Workspace?' : 'Start a coding Session'}</h2><span className="harness-preview-badge">Metrora</span></div><p>{workspace ? 'Ask the selected Agent to inspect files, use Metrora evidence, make bounded edits, run tests, and explain the result.' : 'Open a local Workspace, select a runtime and model, then start a durable coding Session.'}</p></div>
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
  return <div className={`harness-tool-card ${item.status}`} data-kind={item.kind} data-status={item.status}><div className="harness-tool-icon">{toolIcon(item.kind)}</div><div className="harness-tool-body"><div className="harness-tool-head"><div className="harness-tool-name"><strong>{item.name}</strong>{item.source && <small>MCP · {item.source.serverName} · {item.source.toolName}</small>}</div><span className={`harness-tool-status ${item.status}`}><i aria-hidden="true" />{statusLabel(item.status)}</span></div><p>{item.inputSummary}</p>{item.path && <code>{item.path}</code>}{item.command && <code>{item.command}</code>}{item.resultSummary && <small>{item.resultSummary}{item.exitCode !== undefined && item.exitCode !== null ? ` · exit ${item.exitCode}` : ''}</small>}{details && <details className="harness-tool-details"><summary>Show details</summary><ToolDetails details={details} /></details>}</div></div>
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
