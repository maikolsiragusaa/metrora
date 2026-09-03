import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'

import { MetroraMark } from '../components/MetroraMark'
import {
  HarnessModePicker,
  HarnessModelPicker,
  HarnessRoutePicker,
  runtimeLabel,
} from './harness-pickers'
import { ConversationMessage, EmptyHarnessState, ProcessFold } from './harness-process'
import type {
  HarnessConversation,
  HarnessConversationSummary,
  HarnessHostedProvider,
  HarnessMode,
  HarnessProcessItem,
  HarnessReasoningEffort,
  HarnessRuntimeChoice,
  HarnessRuntimeProfileV1,
  HarnessWorkspace,
} from '../../electron/harness-runtime-types'

type PickerName = 'mode' | 'route' | 'model'

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

export type HarnessSurfaceProps = {
  activeTitle: string
  activeStatus: string | null
  statusState: string
  statusText: string
  routeReady: boolean
  makeConversation: () => void
  busy: boolean
  historyQuery: string
  setHistoryQuery: Dispatch<SetStateAction<string>>
  filteredConversations: HarnessConversationSummary[]
  activeId: string | null
  selectConversation: (id: string) => void
  workspace: HarnessWorkspace | null
  loadingWorkspace: boolean
  openWorkspace: () => void
  settingsOpen: boolean
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  settings: ReactNode
  conversation: HarnessConversation | null
  profile: HarnessRuntimeProfileV1
  liveText: string
  liveReasoning: string
  liveProcess: HarnessProcessItem[]
  error: string | null
  failedTurn: boolean
  retry: () => void
  notice: string | null
  composer: string
  setComposer: Dispatch<SetStateAction<string>>
  send: () => void
  stop: () => void
  pickerControlsRef: RefObject<HTMLDivElement | null>
  openPicker: PickerName | null
  setOpenPicker: Dispatch<SetStateAction<PickerName | null>>
  mode: HarnessMode
  changeMode: (mode: HarnessMode) => void
  runtime: HarnessRuntimeChoice
  hostedProvider: HarnessHostedProvider
  changeHostedProvider: (provider: HarnessHostedProvider) => void
  changeRuntime: (runtime: HarnessRuntimeChoice) => void
  model: string
  modelOptions: string[]
  reasoningEffort: HarnessReasoningEffort | null
  availableReasoningEfforts: HarnessReasoningEffort[]
  selectedConformance?: HarnessConversation['conformance']
  changeModel: (model: string) => void
  changeReasoning: (effort: string) => void
  verify: () => void
}

export function HarnessSurface({ activeTitle, activeStatus, statusState, statusText, routeReady, makeConversation, busy, historyQuery, setHistoryQuery, filteredConversations, activeId, selectConversation, workspace, loadingWorkspace, openWorkspace, settingsOpen, setSettingsOpen, settings, conversation, profile, liveText, liveReasoning, liveProcess, error, failedTurn, retry, notice, composer, setComposer, send, stop, pickerControlsRef, openPicker, setOpenPicker, mode, changeMode, runtime, hostedProvider, changeHostedProvider, changeRuntime, model, modelOptions, reasoningEffort, availableReasoningEfforts, selectedConformance, changeModel, changeReasoning, verify }: HarnessSurfaceProps) {
  return <section className="harness-shell" aria-label="Metrora Harness">
    <aside className="harness-session-rail" aria-label="Harness Sessions">
      <div className="harness-rail-brand"><MetroraMark size={24} /><div><strong>Metrora</strong><span>Harness</span></div></div>
      <button type="button" className="harness-new-session" onClick={makeConversation} disabled={!routeReady || busy}><span>＋</span> New Session</button>
      <label className="harness-session-search"><span aria-hidden="true">⌕</span><input aria-label="Search Harness Sessions" placeholder="Search Sessions" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} /></label>
      <div className="harness-session-list">{filteredConversations.length ? filteredConversations.map(item => <button type="button" key={item.id} className={`harness-session-item${item.id === activeId ? ' active' : ''}`} onClick={() => selectConversation(item.id)}><span>{item.title}</span><small>{formatTime(item.updatedAt)} · {item.messageCount} {item.messageCount === 1 ? 'message' : 'messages'}</small></button>) : <p className="harness-muted">No prior Sessions yet.</p>}</div>
      <div className="harness-rail-foot"><span className="harness-status-dot" /> Local-first · Sessions</div>
    </aside>
    <div className="harness-main">
      <header className="harness-header"><div className="harness-title"><MetroraMark size={22} /><div className="harness-title-copy"><h1>{activeTitle}</h1><p>{workspace ? `Workspace · ${workspace.displayName}` : 'No Workspace selected'}</p></div></div><div className="harness-header-actions"><div className="harness-header-status" data-state={statusState}><span className="harness-status-dot" />{activeStatus ? activeStatus.replaceAll('-', ' ') : statusText}</div><button type="button" className="harness-workspace-pill" onClick={openWorkspace} disabled={loadingWorkspace} title="Choose local Workspace"><span>⌂</span>{workspace?.displayName ?? 'Open Workspace'}</button><button type="button" className="harness-settings-button" onClick={() => setSettingsOpen(current => !current)} aria-expanded={settingsOpen}>Settings</button></div></header>
      <div className="harness-content">
        <main className="harness-thread" aria-live="polite">
          {conversation?.messages.length || busy ? <div className="harness-thread-inner">{conversation?.messages.map(message => <ConversationMessage key={message.id} message={message} showReasoning={profile.ui.showReasoning} />)}{busy && (liveText || liveReasoning || liveProcess.length > 0) && <div className="harness-live-turn"><div className="harness-live-label"><span className="harness-thinking-dots"><i /><i /><i /></span>{liveReasoning ? 'Reasoning…' : liveProcess.length ? 'Working…' : 'Thinking…'}</div>{liveReasoning && <div className="harness-reasoning-preview">{liveReasoning}</div>}{liveText && <p>{liveText}</p>}{liveProcess.length > 0 && <ProcessFold items={liveProcess} active onApprovalResolved={() => {}} />}</div>}{busy && !liveText && !liveReasoning && !liveProcess.length && <div className="harness-live-turn"><div className="harness-live-label"><span className="harness-thinking-dots"><i /><i /><i /></span>Thinking…</div></div>}</div> : <EmptyHarnessState workspace={workspace} />}
          {error && <div className="harness-error" role="alert"><div><strong>Harness request failed</strong><p>{error}</p></div>{failedTurn && <button type="button" onClick={retry} disabled={busy}>Retry</button>}</div>}
          {notice && !error && <div className="harness-notice" role="status">{notice}</div>}
        </main>
        {settingsOpen && settings}
      </div>
      <footer className="harness-composer-area"><div className="harness-composer-context" aria-live="polite"><span className="harness-context-chip">{runtimeLabel(runtime, runtime === 'hosted' ? hostedProvider : null)}</span><span className="harness-context-chip">{workspace ? workspace.displayName : 'No Workspace'}</span>{selectedConformance?.state === 'verified' && <span className="harness-verified">Verified</span>}</div><div className="harness-composer"><textarea aria-label="Ask Metrora Harness" placeholder={routeReady ? 'Ask the selected Agent to inspect, explain, edit, or build…' : 'Select an available model to begin…'} value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} disabled={busy || !routeReady} rows={3} /><div className="harness-composer-actions"><div className="harness-composer-controls" ref={pickerControlsRef}><HarnessModePicker value={mode} open={openPicker === 'mode'} onToggle={() => setOpenPicker(current => current === 'mode' ? null : 'mode')} onChange={changeMode} onClose={() => setOpenPicker(null)} /><HarnessRoutePicker runtime={runtime} provider={hostedProvider} open={openPicker === 'route'} onToggle={() => setOpenPicker(current => current === 'route' ? null : 'route')} onChange={(nextRuntime, nextProvider) => { if (nextRuntime === 'hosted' && nextProvider) changeHostedProvider(nextProvider); else changeRuntime(nextRuntime) }} onClose={() => setOpenPicker(null)} /></div><div className="harness-composer-actions-right"><HarnessModelPicker runtime={runtime} provider={hostedProvider} model={model} options={modelOptions} reasoningEffort={reasoningEffort} reasoningEfforts={availableReasoningEfforts} conformance={selectedConformance} open={openPicker === 'model'} onToggle={() => setOpenPicker(current => current === 'model' ? null : 'model')} onModel={changeModel} onReasoning={changeReasoning} onVerify={() => { setOpenPicker(null); setSettingsOpen(true); verify() }} onClose={() => setOpenPicker(null)} /><span className="harness-composer-hint">Enter to send · Shift+Enter for line break</span>{busy ? <button type="button" className="harness-stop-button" aria-label="Stop Harness turn" onClick={stop}>Stop</button> : <button type="button" className="harness-send-button" aria-label="Send message" onClick={send} disabled={!composer.trim() || !routeReady || !model}><span aria-hidden="true">↗</span></button>}</div></div></div></footer>
    </div>
  </section>
}
