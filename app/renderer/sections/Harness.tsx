import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Polled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import { readStorage, writeStorage } from '../lib/storage'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import { createHarnessEvidenceScope, reasoningProfileKey } from '../../electron/harness-runtime-types'
import { HarnessSettings } from './HarnessSettings'
import { runtimeLabel } from './harness-pickers'
import { processItemsFromEvent } from './harness-process'
import { HarnessSurface } from './harness-surface'
import type {
  HarnessConversation,
  HarnessConversationInput,
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

const FALLBACK_PROFILE: HarnessRuntimeProfileV1 = {
  version: 1,
  runtime: 'ollama',
  lastLocalRuntime: 'ollama',
  lastLocalModelByRuntime: {},
  lastHostedModelByProvider: {},
  llamaServerPort: 8080,
  reasoningByModel: {},
  reasoningCapabilitiesByModel: {},
  hostedConsentByProvider: {},
  lastUsable: null,
  mcpServers: [],
  ui: { showReasoning: true, compactProcess: true, density: 'comfortable' },
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message) : String(error)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
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
  const selectedModelCapability = runtime === 'hosted' ? hostedProbe?.provider === hostedProvider && hostedProbe.available ? hostedProbe.models.find(item => item.id === model) : undefined : localProbe?.runtime === runtime && localProbe.available ? localProbe.capabilities.find(item => item.modelId === model) : undefined
  const selectedModelReasoningEfforts = selectedModelCapability?.reasoningEfforts ?? []
  const selectedModelReasoningSource = selectedModelCapability?.reasoningSource
  const selectedModelReasoningAutomatic = selectedModelCapability?.reasoningAutomatic
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
  // `workspace` is the global Workspace chosen for the next Session. Once a
  // Session exists, its immutable DSH cwd is the only Workspace used for that
  // Session, even if the user chooses another folder for the next one.
  const sessionWorkspace = activeSelectionRef.current ? conversation?.workspace ?? null : workspace
  const sessionWorkspaceId = activeSelectionRef.current ? activeSelectionRef.current.workspaceId : conversation?.workspace?.id ?? workspace?.id ?? null

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
      workspaceId: sessionWorkspaceId,
      scope: previous?.scope ?? currentScope,
    }
    activeSelectionRef.current = selection
    setRuntime(nextRuntime)
    if (nextProvider) setHostedProvider(nextProvider)
    setModel(nextModel)
    setReasoningEffort(nextReasoningEffort)
    await syncSessionSelection(selection)
  }, [currentScope, mode, sessionWorkspaceId, syncSessionSelection])

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
      await metrora.harnessSendMessage({ conversationId: id, runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: sessionWorkspaceId, scope: currentScope, question, requestId, ...(retry && failedTurn ? { retryRequestId: failedTurn.requestId } : {}) })
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
  }, [applyConversationState, busy, composer, currentScope, failedTurn, hostedConsent, hostedProvider, mode, model, reasoningEffort, routeReady, runtime, sessionWorkspaceId, workspace?.id])

  const stop = useCallback(async () => {
    if (activeId) await metrora.harnessCancel(activeId).catch(() => false)
  }, [activeId])

  const openWorkspace = useCallback(async () => {
    const hasActiveSession = Boolean(activeSelectionRef.current)
    const workspaceRevision = ++workspaceRevisionRef.current
    setLoadingWorkspace(true)
    try {
      const root = await metrora.chooseDirectory()
      if (!root) return
      const selected = await metrora.harnessWorkspaceOpen(root)
      if (workspaceRevisionRef.current === workspaceRevision) setWorkspace(selected)
      setNotice(hasActiveSession ? `Workspace ready for new Sessions · ${selected.displayName}` : `Workspace ready · ${selected.displayName}`)
    } catch (caught) { setError(errorText(caught)) }
    finally { setLoadingWorkspace(false) }
  }, [])

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
      workspaceId: sessionWorkspaceId,
      scope: currentScope,
    } : null
    if (nextSelection) {
      activeSelectionRef.current = nextSelection
      await syncSessionSelection(nextSelection)
      return
    }
    const nextProfile = runtime === 'hosted' ? await metrora.harnessProfileSetHostedModel(hostedProvider, next).catch(() => null) : await metrora.harnessProfileSetLocalModel(runtime, next).catch(() => null)
    if (nextProfile) setProfile(nextProfile)
  }, [currentScope, hostedProbe, hostedProvider, localProbe, mode, profile.reasoningByModel, runtime, sessionWorkspaceId, syncSessionSelection])

  const changeReasoning = useCallback(async (value: string) => {
    const next = value === '' ? null : value as HarnessReasoningEffort
    if (next && !availableReasoningEfforts.includes(next)) return
    setReasoningEffort(next)
    const id = activeIdRef.current
    if (id && model) {
      const nextSelection: ActiveSessionSelection = { id, runtime, provider: runtime === 'hosted' ? hostedProvider : null, model, mode, reasoningEffort: next, workspaceId: sessionWorkspaceId, scope: currentScope }
      activeSelectionRef.current = nextSelection
      await syncSessionSelection(nextSelection)
    } else if (next && model) {
      await metrora.harnessProfileSetReasoning(runtime, runtime === 'hosted' ? hostedProvider : null, model, next).then(setProfile).catch(() => {})
    }
  }, [availableReasoningEfforts, currentScope, hostedProvider, model, mode, runtime, sessionWorkspaceId, syncSessionSelection])

  const changeMode = useCallback(async (next: HarnessMode) => {
    setMode(next)
    const id = activeIdRef.current
    if (!id || !model) return
    const nextSelection: ActiveSessionSelection = { id, runtime, provider: runtime === 'hosted' ? hostedProvider : null, model, mode: next, reasoningEffort, workspaceId: sessionWorkspaceId, scope: currentScope }
    activeSelectionRef.current = nextSelection
    await syncSessionSelection(nextSelection)
  }, [currentScope, hostedProvider, model, mode, reasoningEffort, runtime, sessionWorkspaceId, syncSessionSelection])

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
      const result = await metrora.harnessCheckConformance({ conversationId: activeId, runtime, ...(runtime === 'hosted' ? { provider: hostedProvider } : {}), model, mode, reasoningEffort, workspaceId: sessionWorkspaceId, scope: currentScope })
      setConversation(await metrora.harnessGetConversation(activeId))
      setNotice(typeof result === 'object' && result && 'state' in result ? `Conformance: ${String((result as { state?: unknown }).state)}.` : 'Conformance check complete.')
    } catch (caught) { setError(errorText(caught)) }
  }, [activeId, currentScope, hostedProvider, mode, model, reasoningEffort, runtime, sessionWorkspaceId])

  const activeTitle = conversation?.title ?? 'New Session'
  const activeStatus = busy ? runtimeState : null
  const statusState = activeStatus ?? (routeReady ? 'ready' : 'unavailable')
  const statusText = activeStatus
    ? activeStatus.replaceAll('-', ' ')
    : routeReady
      ? `${runtimeLabel(runtime, hostedProvider)} ready`
      : runtime === 'hosted' ? hostedProbe?.detail ?? 'Connect provider' : localProbe?.detail ?? 'Runtime unavailable'

  return <HarnessSurface {...{ activeTitle, activeStatus, statusState, statusText, routeReady, busy, historyQuery, setHistoryQuery, filteredConversations, activeId, workspace: sessionWorkspace, loadingWorkspace, settingsOpen, setSettingsOpen, conversation, profile, liveText, liveReasoning, liveProcess, error, notice, composer, setComposer, pickerControlsRef, openPicker, setOpenPicker, mode, runtime, hostedProvider, model, modelOptions, reasoningEffort, availableReasoningEfforts, selectedConformance, makeConversation: () => void makeConversation(), selectConversation: id => void selectConversation(id), openWorkspace: () => void openWorkspace(), settings: <HarnessSettings profile={profile} runtime={runtime} hostedProvider={hostedProvider} hostedConsent={hostedConsent} localProbe={localProbe} hostedProbe={hostedProbe} model={model} reasoningEfforts={availableReasoningEfforts} reasoningSource={selectedModelReasoningSource} reasoningAutomatic={selectedModelReasoningAutomatic} onReasoningCapabilitiesChange={async efforts => { const next = await metrora.harnessProfileSetReasoningCapabilities(runtime, runtime === 'hosted' ? hostedProvider : null, model, efforts); setProfile(next); if (runtime === 'hosted') await probeHosted(hostedProvider); else await probeLocal(runtime, next.llamaServerPort) }} workspace={sessionWorkspace} mcpStatuses={mcpStatuses} onPortChange={async port => { const next = await metrora.harnessProfileSetPort(port); setProfile(next); if (runtime === 'llama-server') void probeLocal('llama-server', port) }} onCredentialChange={async secret => { await metrora.harnessCredentialSet(hostedProvider, secret); void probeHosted(hostedProvider) }} onConsentChange={changeHostedConsent} onMcpSave={saveMcpServers} onMcpReload={reloadMcpServer} onCheckConformance={() => void checkConformance()} conformance={selectedConformance} />, failedTurn: Boolean(failedTurn), retry: () => void send(true), send: () => void send(), stop: () => void stop(), changeMode: next => void changeMode(next), changeHostedProvider: next => void changeHostedProvider(next), changeRuntime: next => void changeRuntime(next), changeModel: next => void changeModel(next), changeReasoning: next => void changeReasoning(next), verify: () => void checkConformance() }} />
}
