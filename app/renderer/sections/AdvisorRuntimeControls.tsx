import type { HostedAdvisorProbeResult } from '../advisor/hosted'
import type { AdvisorCredentialState, AdvisorHostedModel, AdvisorHostedModelState, AdvisorLocalRuntimeId, AdvisorToolCapability, AdvisorHostedProviderId } from '../advisor/types'

export type AdvisorRuntimeChoice = AdvisorLocalRuntimeId | 'hosted'
export type AdvisorRuntimeModelState = AdvisorHostedModelState | 'unavailable'
export type AdvisorProviderReachability = 'checking' | 'reachable' | 'unavailable' | 'unknown'
export type AdvisorHostedCredentialState = AdvisorCredentialState | 'unknown'
export type AdvisorRuntimeStatusKind = 'checking' | 'ready' | 'unavailable' | 'unknown'

export type AdvisorRuntimeState = {
  runtime: AdvisorLocalRuntimeId
  status: 'checking' | 'ready' | 'unavailable'
  detail: string
  models: string[]
  modelLabels?: Record<string, string>
  modelState: AdvisorRuntimeModelState
  toolCall: AdvisorToolCapability
}

export type AdvisorHostedProbePresentation = {
  provider: HostedAdvisorProbeResult['provider']
  available: boolean
  models: AdvisorHostedModel[]
  detail: string
  credentialState: AdvisorHostedCredentialState
  reachability: AdvisorProviderReachability
}

function stateLabel(value: string): string {
  return value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function modelStateLabel(value: AdvisorRuntimeModelState): string {
  return stateLabel(value)
}

function reachabilityLabel(value: AdvisorProviderReachability): string {
  return stateLabel(value)
}

function credentialStateLabel(value: AdvisorHostedCredentialState): string {
  return stateLabel(value)
}

function localRuntimeLabel(value: AdvisorLocalRuntimeId): string {
  if (value === 'lmstudio') return 'LM Studio'
  if (value === 'llama-server') return 'llama.cpp server'
  return 'Ollama'
}

export function hostedReachability(result: HostedAdvisorProbeResult): AdvisorProviderReachability {
  // Invalid credentials are reported after the official endpoint has answered.
  // A ready credential with no available models does not prove literal network
  // reachability, so the weaker Unavailable state is the truthful presentation.
  if (result.available || result.credentialState === 'invalid') return 'reachable'
  if (result.credentialState === 'ready') return 'unavailable'
  return 'unknown'
}

export function presentHostedProbe(result: HostedAdvisorProbeResult): AdvisorHostedProbePresentation {
  return { ...result, reachability: hostedReachability(result) }
}

export function createHostedProbeFailure(provider: HostedAdvisorProbeResult['provider']): AdvisorHostedProbePresentation {
  return {
    provider,
    available: false,
    models: [],
    detail: 'Hosted runtime status is unavailable. The provider probe did not complete.',
    credentialState: 'unknown',
    reachability: 'unknown',
  }
}

export function createHostedProbeChecking(provider: HostedAdvisorProbeResult['provider'], previous: AdvisorHostedProbePresentation | null = null): AdvisorHostedProbePresentation {
  const preserveModels = previous?.provider === provider ? previous.models : []
  return {
    provider,
    available: false,
    models: preserveModels,
    detail: 'Checking the hosted provider…',
    credentialState: 'unknown',
    reachability: 'checking',
  }
}

function hostedRuntimeStatusKind(probe: AdvisorHostedProbePresentation, model: AdvisorHostedModel | null): AdvisorRuntimeStatusKind {
  if (probe.reachability === 'checking') return 'checking'
  if (probe.reachability === 'unknown') return probe.credentialState === 'unknown' ? 'unknown' : 'unavailable'
  if (probe.credentialState !== 'ready' || probe.reachability !== 'reachable' || !model || model.capabilities?.conversational === 'unavailable') return 'unavailable'
  if (model.state === 'verified') return 'ready'
  if (model.state === 'discovered' || model.state === 'unverified' || model.state === 'limited') return 'unknown'
  return 'unavailable'
}

function hostedAvailabilityLabel(probe: AdvisorHostedProbePresentation, model: AdvisorHostedModel | null): string {
  if (probe.reachability === 'checking') return 'Checking provider'
  if (probe.credentialState !== 'ready' && probe.credentialState !== 'unknown') return 'Credential ' + credentialStateLabel(probe.credentialState).toLowerCase()
  if (probe.reachability === 'unknown') return probe.credentialState === 'unknown' ? 'Runtime status unavailable' : 'Credential ' + credentialStateLabel(probe.credentialState).toLowerCase()
  if (probe.reachability === 'unavailable') return 'Provider unavailable'
  if (!model) return 'No usable model discovered'
  if (model.state === 'unsupported') return 'Model unsupported'
  if (model.state === 'failed-conformance') return 'Model failed conformance'
  if (model.state === 'discovered' || model.state === 'unverified') return 'Compatibility unverified'
  if (model.state === 'limited') return 'Model limited'
  return 'Ready'
}

export type AdvisorRuntimeControlsProps = {
  runtimeChoice: AdvisorRuntimeChoice
  runtimeId: AdvisorLocalRuntimeId
  runtimeModel: string | null
  runtimeState: AdvisorRuntimeState
  hostedProvider: AdvisorHostedProviderId
  hostedModel: string | null
  hostedProbe: AdvisorHostedProbePresentation
  hostedConsent: boolean
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
  onCredentialEntryChange: (value: string) => void
  onSaveHostedCredential: () => void
  onClearHostedCredential: () => void
  onCheckLocalRuntime: () => void
  onActivateHosted: () => void
  onLocalRuntimeChange: (runtime: AdvisorLocalRuntimeId) => void
  onLocalModelChange: (model: string) => void
}

export function AdvisorRuntimeControls({
  runtimeChoice,
  runtimeId,
  runtimeModel,
  runtimeState,
  hostedProvider,
  hostedModel,
  hostedProbe,
  hostedConsent,
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
  onCredentialEntryChange,
  onSaveHostedCredential,
  onClearHostedCredential,
  onCheckLocalRuntime,
  onActivateHosted,
  onLocalRuntimeChange,
  onLocalModelChange,
}: AdvisorRuntimeControlsProps) {
  const selectableHostedModels = hostedProbe.models.filter(model => model.state !== 'unsupported' && model.state !== 'failed-conformance')
  const selectedHostedModel = selectableHostedModels.find(model => model.id === hostedModel) ?? null
  const hostedModelForPresentation = selectedHostedModel ?? (hostedProbe.models.length === 1 ? hostedProbe.models[0]! : null)
  const hostedModelState: AdvisorRuntimeModelState = hostedModelForPresentation?.state ?? 'unavailable'
  const runtimeStatusKind = runtimeChoice === 'hosted' ? hostedRuntimeStatusKind(hostedProbe, hostedModelForPresentation) : runtimeState.status
  const runtimeIdentity = runtimeChoice === 'hosted'
    ? hostedProviderLabel(hostedProvider) + (selectedHostedModel ? ' · ' + selectedHostedModel.label : '')
    : localRuntimeLabel(runtimeId) + (runtimeModel ? ' · ' + (runtimeState.modelLabels?.[runtimeModel] ?? runtimeModel) : '')
  const runtimeAvailability = runtimeChoice === 'hosted'
    ? hostedAvailabilityLabel(hostedProbe, hostedModelForPresentation)
    : runtimeState.status === 'checking'
      ? 'Checking runtime'
      : runtimeState.status === 'ready'
        ? 'Ready'
        : 'Runtime unavailable'
  const runtimeDescription = runtimeChoice === 'hosted'
    ? 'Hosted provider account · minimum evidence sent directly · no Metrora proxy'
    : runtimeState.status === 'ready'
      ? ({ ollama: 'Local Ollama model', lmstudio: 'Local LM Studio model', 'llama-server': 'Local llama.cpp server model' }[runtimeId]) + ' · read-only evidence tools · tool support varies by model'
      : 'Offline evidence fallback'
  const runtimeDetail = runtimeChoice === 'hosted' ? hostedProbe.detail : runtimeState.detail

  return (
    <div className={'advisor-runtime-status ' + runtimeStatusKind} aria-label="Harness runtime status">
      <span className={'advisor-status-dot ' + runtimeStatusKind} aria-hidden="true" />
      <div className="advisor-runtime-summary-copy">
        <strong>{runtimeIdentity}</strong>
        <span className={'advisor-runtime-availability ' + runtimeStatusKind}>{runtimeAvailability}</span>
        <small className="advisor-runtime-description">{runtimeDescription}</small>
        <small className="advisor-runtime-detail">{runtimeDetail}</small>
      </div>
      <button type="button" className="advisor-configure-toggle" aria-expanded={configureOpen} aria-controls={configureOpen ? 'advisor-runtime-config' : undefined} onClick={onToggleConfigure}>{configureOpen ? 'Close runtime' : 'Configure runtime'}</button>
      {configureOpen ? <div className="advisor-runtime-config" id="advisor-runtime-config" aria-label="Harness runtime configuration">
        <div className="advisor-runtime-config-head"><strong>Runtime configuration</strong><span>Choose a local or hosted runtime. Technical state stays here while the conversation remains the focus.</span></div>
        {runtimeChoice === 'hosted' ? <div className="advisor-runtime-config-controls">
          <div className="advisor-runtime-config-actions">
            <button type="button" className="advisor-quiet-button" onClick={onCheckHostedRuntime}>{hostedProbe.available ? 'Refresh hosted models' : 'Check hosted provider'}</button>
            <button type="button" className="advisor-quiet-button" onClick={onActivateLocal}>Use local runtime</button>
          </div>
          <div className="advisor-runtime-picker-row">
            <label className="advisor-runtime-picker">Provider<select aria-label="Harness hosted provider" value={hostedProvider} onChange={event => onHostedProviderChange(event.target.value as AdvisorHostedProviderId)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="opencode-zen">OpenCode Zen</option></select></label>
            {selectableHostedModels.length ? <label className="advisor-runtime-picker">Hosted model<select aria-label="Harness hosted model" value={hostedModel ?? selectableHostedModels[0]!.id} onChange={event => onHostedModelChange(event.target.value)}>{selectableHostedModels.map(model => <option key={model.id} value={model.id}>{model.label} · {modelStateLabel(model.state)}</option>)}</select></label> : null}
          </div>
          <div className="advisor-runtime-state-grid" aria-label="Hosted runtime state">
            <span data-state="credential">Credential: {credentialStateLabel(hostedProbe.credentialState)}</span>
            <span data-state="reachability">Reachability: {reachabilityLabel(hostedProbe.reachability)}</span>
            <span data-state="model">Model: {modelStateLabel(hostedModelState)}</span>
            <span data-state="tool-call">Tool calls: {stateLabel(selectedHostedModel?.capabilities?.toolCall ?? 'unknown')}</span>
          </div>
          {hostedProbe.credentialState !== 'ready' ? <div className="advisor-credential-entry"><input type="password" aria-label="Harness provider key" autoComplete="off" placeholder="Provider key (not stored in this form)" value={credentialEntry} onChange={event => onCredentialEntryChange(event.target.value)} /><button type="button" className="advisor-quiet-button" onClick={onSaveHostedCredential} disabled={credentialSaving || !credentialEntry.trim()}>{credentialSaving ? 'Saving…' : 'Save key'}</button></div> : <button type="button" className="advisor-quiet-button" onClick={onClearHostedCredential}>Remove key</button>}
          {hasHostedRuntime ? <label className="advisor-hosted-consent"><input type="checkbox" checked={hostedConsent} onChange={event => onHostedConsentChange(event.target.checked)} /><span>Before the first hosted message, send this question and any minimum Metrora evidence directly to the selected provider using your account. Metrora does not proxy it; provider terms, privacy, and retention apply.</span></label> : <p className="advisor-consent-unavailable">Consent appears after a usable hosted model is available. It is always explicit and starts unchecked.</p>}
        </div> : <div className="advisor-runtime-config-controls">
          <div className="advisor-runtime-config-actions">
            <button type="button" className="advisor-quiet-button" onClick={onCheckLocalRuntime}>{runtimeState.status === 'checking' ? 'Checking…' : 'Check local model'}</button>
            <button type="button" className="advisor-quiet-button" onClick={onActivateHosted}>Use hosted provider</button>
          </div>
          <div className="advisor-runtime-picker-row">
            <label className="advisor-runtime-picker">Runtime<select aria-label="Harness runtime" value={runtimeId} onChange={event => onLocalRuntimeChange(event.target.value as AdvisorLocalRuntimeId)}><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="llama-server">llama.cpp server</option></select></label>
            {runtimeState.models.length ? <label className="advisor-runtime-picker">Local model<select aria-label="Harness local runtime model" value={runtimeModel ?? runtimeState.models[0]} onChange={event => onLocalModelChange(event.target.value)}>{runtimeState.models.map(model => <option key={model} value={model}>{runtimeState.modelLabels?.[model] ?? model}</option>)}</select></label> : null}
          </div>
          <div className="advisor-runtime-state-grid" aria-label="Local runtime state">
            <span data-state="runtime">Runtime: {stateLabel(runtimeState.status)}</span>
            <span data-state="model">Model: {modelStateLabel(runtimeState.modelState)}</span>
            <span data-state="tool-call">Tool calls: {stateLabel(runtimeState.toolCall)}</span>
          </div>
        </div>}
      </div> : null}
    </div>
  )
}

function hostedProviderLabel(provider: AdvisorHostedProviderId): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'gemini') return 'Gemini'
  if (provider === 'openrouter') return 'OpenRouter'
  return 'OpenCode Zen'
}
