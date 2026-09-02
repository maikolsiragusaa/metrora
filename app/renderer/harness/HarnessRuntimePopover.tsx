import { useEffect, useRef } from 'react'
import type { HostedAdvisorProbeResult } from '../advisor/hosted'
import type { AdvisorCredentialState, AdvisorHostedModel, AdvisorHostedModelState, AdvisorLocalRuntimeId, AdvisorReasoningEffort, AdvisorToolCapability, AdvisorHostedProviderId } from '../advisor/types'

export type HarnessRuntimeChoice = AdvisorLocalRuntimeId | 'hosted'
export type HarnessRuntimeModelState = AdvisorHostedModelState | 'unavailable'
export type HarnessProviderReachability = 'checking' | 'reachable' | 'unavailable' | 'unknown'
export type HarnessHostedCredentialState = AdvisorCredentialState | 'unknown'
export type HarnessRuntimeStatusKind = 'checking' | 'ready' | 'unavailable' | 'unknown'

export type HarnessRuntimeState = {
  runtime: AdvisorLocalRuntimeId
  status: 'checking' | 'ready' | 'unavailable'
  detail: string
  models: string[]
  modelLabels?: Record<string, string>
  modelState: HarnessRuntimeModelState
  toolCall: AdvisorToolCapability
}

export type HarnessHostedProbePresentation = {
  provider: HostedAdvisorProbeResult['provider']
  available: boolean
  models: AdvisorHostedModel[]
  detail: string
  credentialState: HarnessHostedCredentialState
  reachability: HarnessProviderReachability
}

function stateLabel(value: string): string {
  return value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function modelStateLabel(value: HarnessRuntimeModelState): string {
  if (value === 'discovered') return 'Available'
  if (value === 'unverified') return 'Check pending'
  if (value === 'verified') return 'Verified'
  if (value === 'failed-conformance') return 'Check failed'
  if (value === 'unsupported') return 'Unavailable'
  if (value === 'limited') return 'Limited'
  return 'Unavailable'
}
function toolCapabilityLabel(value: AdvisorToolCapability): string {
  if (value === 'supported') return 'Available'
  if (value === 'unsupported') return 'Unavailable'
  if (value === 'failed-conformance') return 'Check failed'
  return 'Check pending'
}
function reachabilityLabel(value: HarnessProviderReachability): string { return stateLabel(value) }
function credentialStateLabel(value: HarnessHostedCredentialState): string { return stateLabel(value) }

function localRuntimeLabel(value: AdvisorLocalRuntimeId): string {
  if (value === 'lmstudio') return 'LM Studio'
  if (value === 'llama-server') return 'llama.cpp server'
  return 'Ollama'
}

export function hostedReachability(result: HostedAdvisorProbeResult): HarnessProviderReachability {
  if (result.available || result.credentialState === 'invalid') return 'reachable'
  if (result.credentialState === 'ready') return 'unavailable'
  return 'unknown'
}

export function presentHostedProbe(result: HostedAdvisorProbeResult): HarnessHostedProbePresentation {
  return { ...result, reachability: hostedReachability(result) }
}

export function createHostedProbeFailure(provider: HostedAdvisorProbeResult['provider']): HarnessHostedProbePresentation {
  return { provider, available: false, models: [], detail: 'Hosted runtime status is unavailable. The provider probe did not complete.', credentialState: 'unknown', reachability: 'unknown' }
}

export function createHostedProbeChecking(provider: HostedAdvisorProbeResult['provider'], previous: HarnessHostedProbePresentation | null = null): HarnessHostedProbePresentation {
  const preserveModels = previous?.provider === provider ? previous.models : []
  return { provider, available: false, models: preserveModels, detail: 'Checking the hosted provider…', credentialState: 'unknown', reachability: 'checking' }
}

function hostedRuntimeStatusKind(probe: HarnessHostedProbePresentation, model: AdvisorHostedModel | null): HarnessRuntimeStatusKind {
  if (probe.reachability === 'checking') return 'checking'
  if (probe.reachability === 'unknown') return probe.credentialState === 'unknown' ? 'unknown' : 'unavailable'
  if (probe.credentialState !== 'ready' || probe.reachability !== 'reachable' || !model || model.capabilities?.conversational === 'unavailable') return 'unavailable'
  if (model.state === 'verified') return 'ready'
  if (model.state === 'discovered' || model.state === 'unverified' || model.state === 'limited') return 'unknown'
  return 'unavailable'
}

function hostedAvailabilityLabel(probe: HarnessHostedProbePresentation, model: AdvisorHostedModel | null): string {
  if (probe.reachability === 'checking') return 'Checking provider'
  if (probe.credentialState !== 'ready' && probe.credentialState !== 'unknown') return 'Credential ' + credentialStateLabel(probe.credentialState).toLowerCase()
  if (probe.reachability === 'unknown') return probe.credentialState === 'unknown' ? 'Runtime status unavailable' : 'Credential ' + credentialStateLabel(probe.credentialState).toLowerCase()
  if (probe.reachability === 'unavailable') return 'Provider unavailable'
  if (!model) return 'No usable model discovered'
  if (model.state === 'unsupported') return 'Model unsupported'
  if (model.state === 'failed-conformance') return 'Model check failed'
  if (model.state === 'discovered' || model.state === 'unverified') return 'Checking model'
  if (model.state === 'limited') return 'Model limited'
  return 'Ready'
}

export type HarnessRuntimeControlsProps = {
  runtimeChoice: HarnessRuntimeChoice
  runtimeId: AdvisorLocalRuntimeId
  runtimeModel: string | null
  llamaServerPort: number
  runtimeState: HarnessRuntimeState
  hostedProvider: AdvisorHostedProviderId
  hostedModel: string | null
  hostedProbe: HarnessHostedProbePresentation
  hostedConsent: boolean
  reasoningEffort: AdvisorReasoningEffort
  reasoningEfforts: readonly AdvisorReasoningEffort[]
  hasHostedRuntime: boolean
  configureOpen: boolean
  credentialEntry: string
  credentialSaving: boolean
  onToggleConfigure: () => void
  onCheckHostedRuntime: () => void
  onActivateLocal: () => void
  onHostedProviderChange: (provider: AdvisorHostedProviderId) => void
  onHostedModelChange: (model: string) => void
  onHostedConsentChange: (consent: boolean) => void
  onReasoningEffortChange: (effort: AdvisorReasoningEffort) => void
  onCredentialEntryChange: (value: string) => void
  onSaveHostedCredential: () => void
  onClearHostedCredential: () => void
  onCheckLocalRuntime: () => void
  onLlamaServerPortChange: (value: number) => void
  onActivateHosted: () => void
  onLocalRuntimeChange: (runtime: AdvisorLocalRuntimeId) => void
  onLocalModelChange: (model: string) => void
}

function hostedProviderLabel(provider: AdvisorHostedProviderId): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'gemini') return 'Gemini'
  if (provider === 'openrouter') return 'OpenRouter'
  return 'OpenCode Zen'
}

export function HarnessRuntimePopover({
  runtimeChoice,
  runtimeId,
  runtimeModel,
  llamaServerPort,
  runtimeState,
  hostedProvider,
  hostedModel,
  hostedProbe,
  hostedConsent,
  reasoningEffort,
  reasoningEfforts,
  hasHostedRuntime,
  configureOpen,
  credentialEntry,
  credentialSaving,
  onToggleConfigure,
  onCheckHostedRuntime,
  onActivateLocal,
  onHostedProviderChange,
  onHostedModelChange,
  onHostedConsentChange,
  onReasoningEffortChange,
  onCredentialEntryChange,
  onSaveHostedCredential,
  onClearHostedCredential,
  onCheckLocalRuntime,
  onLlamaServerPortChange,
  onActivateHosted,
  onLocalRuntimeChange,
  onLocalModelChange,
}: HarnessRuntimeControlsProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const selectableHostedModels = hostedProbe.models.filter(model => model.state !== 'unsupported' && model.state !== 'failed-conformance')
  const selectedHostedModel = selectableHostedModels.find(model => model.id === hostedModel) ?? null
  const hostedModelForPresentation = selectedHostedModel ?? (hostedProbe.models.length === 1 ? hostedProbe.models[0]! : null)
  const hostedModelState: HarnessRuntimeModelState = hostedModelForPresentation?.state ?? 'unavailable'
  const runtimeStatusKind = runtimeChoice === 'hosted' ? hostedRuntimeStatusKind(hostedProbe, hostedModelForPresentation) : runtimeState.status
  const runtimeIdentity = runtimeChoice === 'hosted'
    ? hostedProviderLabel(hostedProvider) + (selectedHostedModel ? ' · ' + selectedHostedModel.label : '')
    : localRuntimeLabel(runtimeId) + (runtimeModel ? ' · ' + (runtimeState.modelLabels?.[runtimeModel] ?? runtimeModel) : '')
  const runtimeAvailability = runtimeChoice === 'hosted'
    ? hostedAvailabilityLabel(hostedProbe, hostedModelForPresentation)
    : runtimeState.status === 'checking' ? 'Checking runtime' : runtimeState.status === 'ready' ? 'Ready' : 'Runtime unavailable'
  const runtimeDescription = runtimeChoice === 'hosted'
    ? 'Hosted provider account · minimum evidence sent directly · no Metrora proxy'
    : runtimeState.status === 'ready'
      ? ({ ollama: 'Local Ollama model', lmstudio: 'Local LM Studio model', 'llama-server': 'Local llama.cpp server model' }[runtimeId]) + ' · read-only evidence tools · tool support varies by model'
    : 'Select or connect a model to continue'
  const runtimeDetail = runtimeChoice === 'hosted' ? hostedProbe.detail : runtimeState.detail
  const effectiveReasoningEffort = reasoningEfforts.includes(reasoningEffort) ? reasoningEffort : 'default'

  useEffect(() => {
    if (!configureOpen) return
    const onPointerDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) onToggleConfigure() }
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onToggleConfigure() } }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('mousedown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [configureOpen, onToggleConfigure])

  return (
    <div className="harness-v3-runtime-anchor" ref={rootRef}>
      <button type="button" className="harness-v3-runtime-trigger" aria-label={configureOpen ? 'Close runtime' : 'Configure runtime'} aria-haspopup="dialog" aria-expanded={configureOpen} aria-controls={configureOpen ? 'harness-runtime-config' : undefined} onClick={onToggleConfigure}>
        <span aria-hidden="true" className={'harness-v3-runtime-dot ' + runtimeStatusKind} />
        <strong>{runtimeIdentity}</strong>
        <span className={'harness-v3-runtime-trigger-status ' + runtimeStatusKind}>{runtimeState.status === 'unavailable' && runtimeChoice !== 'hosted' ? 'Runtime unavailable' : runtimeAvailability}</span>
        <span aria-hidden="true" className="harness-v3-chevron">⌄</span>
      </button>
      {configureOpen ? <div className="harness-v3-runtime-popover" id="harness-runtime-config" role="dialog" aria-label="Harness runtime configuration">
        <div className="harness-v3-popover-head"><strong>Runtime &amp; model</strong><p>Choose a runtime here; detailed provider state stays out of the conversation.</p></div>
        {runtimeChoice === 'hosted' ? <div className="harness-v3-runtime-controls">
          <div className="harness-v3-popover-actions"><button type="button" className="harness-v3-quiet-button" onClick={onCheckHostedRuntime}>{hostedProbe.available ? 'Refresh hosted models' : 'Check hosted provider'}</button><button type="button" className="harness-v3-quiet-button" onClick={onActivateLocal}>Use local runtime</button></div>
          <div className="harness-v3-picker-row"><label>Provider<select aria-label="Harness hosted provider" value={hostedProvider} onChange={event => onHostedProviderChange(event.target.value as AdvisorHostedProviderId)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="opencode-zen">OpenCode Zen</option></select></label>{selectableHostedModels.length ? <label>Hosted model<select aria-label="Harness hosted model" value={hostedModel ?? selectableHostedModels[0]!.id} onChange={event => onHostedModelChange(event.target.value)}>{selectableHostedModels.map(model => <option key={model.id} value={model.id}>{model.label} · {modelStateLabel(model.state)}</option>)}</select></label> : null}</div>
          <div className="harness-v3-runtime-state-grid" aria-label="Hosted runtime state"><span data-state="credential">Account: {credentialStateLabel(hostedProbe.credentialState)}</span><span data-state="reachability">Connection: {reachabilityLabel(hostedProbe.reachability)}</span><span data-state="model">Model: {modelStateLabel(hostedModelState)}</span><span data-state="tool-call">Tools: {toolCapabilityLabel(selectedHostedModel?.capabilities?.toolCall ?? 'unknown')}</span></div>
          <p className="harness-v3-runtime-detail">{runtimeDetail}</p>
          {hostedProbe.credentialState !== 'ready' ? <div className="harness-v3-credential-entry"><input type="password" aria-label="Harness provider key" autoComplete="off" placeholder="Provider key (not stored in this form)" value={credentialEntry} onChange={event => onCredentialEntryChange(event.target.value)} /><button type="button" className="harness-v3-quiet-button" onClick={onSaveHostedCredential} disabled={credentialSaving || !credentialEntry.trim()}>{credentialSaving ? 'Saving…' : 'Save key'}</button></div> : <button type="button" className="harness-v3-quiet-button" onClick={onClearHostedCredential}>Remove key</button>}
          {hasHostedRuntime ? <label className="harness-v3-hosted-consent"><input type="checkbox" checked={hostedConsent} onChange={event => onHostedConsentChange(event.target.checked)} /><span>Before the first hosted message, send this question and any minimum Metrora evidence directly to the selected provider using your account. Metrora does not proxy it; provider terms, privacy, and retention apply.</span></label> : <p className="harness-v3-runtime-detail">Consent appears after a usable hosted model is available. It starts unchecked.</p>}
        </div> : <div className="harness-v3-runtime-controls">
          <div className="harness-v3-popover-actions"><button type="button" className="harness-v3-quiet-button" onClick={onCheckLocalRuntime}>{runtimeState.status === 'checking' ? 'Checking…' : 'Check local model'}</button><button type="button" className="harness-v3-quiet-button" onClick={onActivateHosted}>Use hosted provider</button></div>
          <div className="harness-v3-picker-row"><label>Runtime<select aria-label="Harness runtime" value={runtimeId} onChange={event => onLocalRuntimeChange(event.target.value as AdvisorLocalRuntimeId)}><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="llama-server">llama.cpp server</option></select></label>{runtimeState.models.length ? <label>Local model<select aria-label="Harness local runtime model" value={runtimeModel ?? runtimeState.models[0]} onChange={event => onLocalModelChange(event.target.value)}>{runtimeState.models.map(model => <option key={model} value={model}>{runtimeState.modelLabels?.[model] ?? model}</option>)}</select></label> : null}{runtimeId === 'llama-server' ? <label>Port<input aria-label="llama-server port" type="number" min={1} max={65535} step={1} value={llamaServerPort} onChange={event => onLlamaServerPortChange(Number(event.target.value))} /></label> : null}</div>
          <div className="harness-v3-runtime-state-grid" aria-label="Local runtime state"><span data-state="runtime">Runtime: {stateLabel(runtimeState.status)}</span><span data-state="model">Model: {modelStateLabel(runtimeState.modelState)}</span><span data-state="tool-call">Tools: {toolCapabilityLabel(runtimeState.toolCall)}</span></div>
          <p className="harness-v3-runtime-detail">{runtimeDescription}</p><p className="harness-v3-runtime-detail">{runtimeDetail}</p>
        </div>}
        <div className="harness-v3-reasoning-control"><label>Reasoning<select aria-label="Harness reasoning effort" value={effectiveReasoningEffort} disabled={reasoningEfforts.length <= 1} onChange={event => onReasoningEffortChange(event.target.value as AdvisorReasoningEffort)}>{reasoningEfforts.map(effort => <option key={effort} value={effort}>{stateLabel(effort)}</option>)}</select></label></div>
      </div> : null}
    </div>
  )
}
