import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type {
  HarnessConversation,
  HarnessHostedProvider,
  HarnessMode,
  HarnessReasoningEffort,
  HarnessRuntimeChoice,
} from '../../electron/harness-runtime-types'

export const LOCAL_RUNTIMES: ReadonlyArray<{ id: 'ollama' | 'lmstudio' | 'llama-server'; label: string }> = [
  { id: 'ollama', label: 'Ollama' },
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'llama-server', label: 'llama.cpp' },
]

export const HOSTED_PROVIDERS: ReadonlyArray<{ id: HarnessHostedProvider; label: string }> = [
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

export function runtimeLabel(runtime: HarnessRuntimeChoice, provider: HarnessHostedProvider | null): string {
  if (runtime === 'hosted') return HOSTED_PROVIDERS.find(item => item.id === provider)?.label ?? 'Hosted provider'
  return LOCAL_RUNTIMES.find(item => item.id === runtime)?.label ?? runtime
}

export function movePickerFocus(event: ReactKeyboardEvent<HTMLDivElement>, close: () => void): void {
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

export function HarnessModePicker({ value, open, onToggle, onChange, onClose }: { value: HarnessMode; open: boolean; onToggle: () => void; onChange: (value: HarnessMode) => void; onClose: () => void }) {
  const selected = MODES.find(item => item.id === value) ?? MODES[0]!
  return <div className="harness-picker harness-mode-picker">
    <button type="button" className="harness-picker-button" aria-label="Harness mode" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}><span className="harness-picker-caption">Mode</span><strong>{selected.label}</strong><span className="harness-picker-chevron" aria-hidden="true">⌄</span></button>
    {open && <div className="harness-picker-menu harness-mode-menu" role="menu" aria-label="Harness mode menu" onKeyDown={event => movePickerFocus(event, onClose)}>
      <div className="harness-picker-menu-title">Session mode</div>
      {MODES.map(item => <button type="button" role="menuitemradio" aria-checked={item.id === value} className={`harness-picker-option${item.id === value ? ' selected' : ''}`} key={item.id} onClick={() => { onChange(item.id); onClose() }}><span className="harness-picker-check" aria-hidden="true">{item.id === value ? '✓' : ''}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
    </div>}
  </div>
}

export function HarnessRoutePicker({ runtime, provider, open, onToggle, onChange, onClose }: { runtime: HarnessRuntimeChoice; provider: HarnessHostedProvider; open: boolean; onToggle: () => void; onChange: (runtime: HarnessRuntimeChoice, provider: HarnessHostedProvider | null) => void; onClose: () => void }) {
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

export function HarnessModelPicker({ runtime, provider, model, options, reasoningEffort, reasoningEfforts, conformance, open, onToggle, onModel, onReasoning, onVerify, onClose }: { runtime: HarnessRuntimeChoice; provider: HarnessHostedProvider; model: string; options: string[]; reasoningEffort: HarnessReasoningEffort | null; reasoningEfforts: HarnessReasoningEffort[]; conformance?: HarnessConversation['conformance']; open: boolean; onToggle: () => void; onModel: (model: string) => void; onReasoning: (effort: string) => void; onVerify: () => void; onClose: () => void }) {
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
