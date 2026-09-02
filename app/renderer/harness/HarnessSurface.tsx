import type { ComponentProps } from 'react'
import type { AdvisorContextualScopeMode } from '../advisor/context'
import type { AdvisorScope, AdvisorScopeConflictOptionV1, AdvisorScopeConflictV1 } from '../advisor/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { useState } from 'react'
import type { HarnessRuntimeControlsProps } from './HarnessRuntimePopover'
import { HarnessComposer } from './HarnessComposer'
import { HarnessContextPopover } from './HarnessContextPopover'
import { HarnessHeader } from './HarnessHeader'
import { HarnessHistoryDrawer, type HarnessHistoryConversation } from './HarnessHistoryDrawer'
import { HarnessRuntimePopover } from './HarnessRuntimePopover'
import { HarnessThread, type HarnessThreadMessage } from './HarnessThread'
import type { HarnessToolActivity } from './HarnessWorkTrace'
import type { SwarmRunState } from '../swarm/useSwarmRun'

export type HarnessSurfaceConversation = HarnessHistoryConversation & { messages: HarnessThreadMessage[] }

export type HarnessSurfaceProps = {
  mode: 'chat' | 'swarm'
  swarmExperimentalEnabled: boolean
  onModeChange: (mode: 'chat' | 'swarm') => void
  swarm: { enabled: boolean; runtimeLabel: string; modelLabel: string; state: SwarmRunState; onRun: (task: string, workerCount?: number) => boolean | void; onCancel: () => void }
  projectOptions: Array<{ id: string; name: string }>
  modelOptions: string[]
  providerOptions: Array<{ id: string; label: string }>
  scope: AdvisorScope
  contextualScopeMode: AdvisorContextualScopeMode | null
  contextualOrigin: string | null
  scopeSummary: string
  onScopeChange: (update: (current: AdvisorScope) => AdvisorScope) => void
  runtimeUnavailable: boolean
  onRetryRuntime: () => void
  overviewError: string | null
  runtimeControls: HarnessRuntimeControlsProps
  filteredConversations: HarnessSurfaceConversation[]
  activeConversationId: string
  historyQuery: string
  onNewChat: () => void
  onConversationSelect: (id: string) => void
  onHistoryQueryChange: (value: string) => void
  messages: HarnessThreadMessage[]
  selectedAnswerId: string | null
  onSelectAnswer: (id: string) => void
  onFollowUp: (question: string) => void
  onScopeConflictOption: (question: string, conflict: AdvisorScopeConflictV1, option: AdvisorScopeConflictOptionV1) => void
  harnessActions: Record<string, MetroraHarnessActionEvent>
  harnessActionBusyId: string | null
  onConfirmHarnessAction: (actionId: string, proposalDigest: string) => void | Promise<void>
  onCancelHarnessAction: (actionId: string) => void | Promise<void>
  loadingQuestion: string | null
  toolStatus: string | null
  toolActivity: HarnessToolActivity[]
  streamPreview: string
  onCancel: () => void
  error: string | null
  onRetry: () => void
  failedRequestPresent: boolean
  notice: string | null
  composer: string
  hostedSubmitBlockReason: string | null
  onComposerChange: (value: string) => void
  onAsk: (question: string) => void
  onNextInvestigation: (question: string) => void
}

export function HarnessSurface({ mode, swarmExperimentalEnabled, onModeChange, swarm, projectOptions, modelOptions, providerOptions, scope, contextualScopeMode, contextualOrigin, scopeSummary, onScopeChange, runtimeUnavailable, onRetryRuntime, overviewError, runtimeControls, filteredConversations, activeConversationId, historyQuery, onNewChat, onConversationSelect, onHistoryQueryChange, messages, selectedAnswerId, onSelectAnswer, onFollowUp, onScopeConflictOption, harnessActions, harnessActionBusyId, onConfirmHarnessAction, onCancelHarnessAction, loadingQuestion, toolStatus, toolActivity, streamPreview, onCancel, error, onRetry, failedRequestPresent, notice, composer, hostedSubmitBlockReason, onComposerChange, onAsk, onNextInvestigation }: HarnessSurfaceProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const contextProps: ComponentProps<typeof HarnessContextPopover> = { projectOptions, modelOptions, providerOptions, scope, contextualScopeMode, contextualOrigin, scopeSummary, onScopeChange }
  return (
    <section className="harness-v3-surface" aria-label="Metrora Harness">
      <HarnessHeader context={contextProps} runtimeControls={runtimeControls} historyOpen={historyOpen} onOpenHistory={() => setHistoryOpen(true)} />
      {runtimeUnavailable ? <div className="harness-v3-inline-notice"><strong>No local model connected.</strong> You can still use the explicit offline evidence fallback. <button type="button" onClick={onRetryRuntime}>Try again</button></div> : null}
      {overviewError ? <div className="harness-v3-inline-notice warning"><strong>Canonical Metrora data is unavailable.</strong> {overviewError}</div> : null}
      <div className="harness-v3-content">
        <HarnessThread mode={mode} swarmExperimentalEnabled={swarmExperimentalEnabled} swarm={swarm} scope={scope} messages={messages} selectedAnswerId={selectedAnswerId} onSelectAnswer={onSelectAnswer} onFollowUp={onFollowUp} onScopeConflictOption={onScopeConflictOption} harnessActions={harnessActions} harnessActionBusyId={harnessActionBusyId} onConfirmHarnessAction={onConfirmHarnessAction} onCancelHarnessAction={onCancelHarnessAction} loadingQuestion={loadingQuestion} toolStatus={toolStatus} toolActivity={toolActivity} streamPreview={streamPreview} onCancel={onCancel} error={error} onRetry={onRetry} failedRequestPresent={failedRequestPresent} notice={notice} onAsk={onAsk} onNextInvestigation={onNextInvestigation} />
        <HarnessComposer mode={mode} swarmExperimentalEnabled={swarmExperimentalEnabled} swarmRunning={swarm.state.running} loadingQuestion={loadingQuestion} hostedSubmitBlockReason={hostedSubmitBlockReason} notice={notice} composer={composer} onModeChange={onModeChange} onComposerChange={onComposerChange} onAsk={onAsk} onSwarmRun={swarm.onRun} onCancel={mode === 'swarm' && swarm.state.running ? swarm.onCancel : onCancel} />
      </div>
      {historyOpen ? <HarnessHistoryDrawer conversations={filteredConversations} activeConversationId={activeConversationId} historyQuery={historyQuery} onNewChat={onNewChat} onConversationSelect={onConversationSelect} onHistoryQueryChange={onHistoryQueryChange} onClose={() => setHistoryOpen(false)} /> : null}
    </section>
  )
}
