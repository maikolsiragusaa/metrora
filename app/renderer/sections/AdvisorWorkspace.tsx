import type { ComponentProps } from 'react'

import type { AdvisorContextualScopeMode } from '../advisor/context'
import type { AdvisorAnswer, AdvisorScope } from '../advisor/types'
import { PERIOD_OPTIONS } from '../components/TopBar'
import type { Period } from '../lib/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { AdvisorComposer } from './AdvisorComposer'
import { AdvisorRuntimeControls } from './AdvisorRuntimeControls'
import { AnswerCard, ToolActivity, type HarnessToolActivity } from './AdvisorAnswerCard'
import { SwarmWorkspace } from './SwarmWorkspace'

type AdvisorWorkspaceMessage = {
  id: string
  role: 'user' | 'assistant'
  text?: string
  answer?: AdvisorAnswer
}

type AdvisorWorkspaceConversation = {
  id: string
  title: string
  messages: AdvisorWorkspaceMessage[]
}

type AdvisorWorkspaceProps = {
  mode: 'chat' | 'swarm'
  swarmExperimentalEnabled: boolean
  onModeChange: (mode: 'chat' | 'swarm') => void
  swarm: ComponentProps<typeof SwarmWorkspace>
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
  runtimeControls: ComponentProps<typeof AdvisorRuntimeControls>
  filteredConversations: AdvisorWorkspaceConversation[]
  activeConversationId: string
  historyQuery: string
  onNewChat: () => void
  onConversationSelect: (id: string) => void
  onHistoryQueryChange: (value: string) => void
  messages: AdvisorWorkspaceMessage[]
  selectedAnswerId: string | null
  onSelectAnswer: (id: string) => void
  onFollowUp: (question: string) => void
  harnessActions: Record<string, MetroraHarnessActionEvent>
  harnessActionBusyId: string | null
  onConfirmHarnessAction: (actionId: string, digest: string) => void | Promise<void>
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
  latestAnswer: AdvisorAnswer | null
  onNextInvestigation: (question: string) => void
}

const PERIODS: Array<{ value: Period; label: string }> = PERIOD_OPTIONS.map(option => ({ value: option.value as Period, label: option.label }))
const PROMPTS = [
  { eyebrow: 'Spend changes', label: 'What changed in my spend recently?', question: 'What changed in my spend recently?' },
  { eyebrow: 'Model efficiency', label: 'Which model has the lowest observed cost per call?', question: 'Which model has the lowest observed cost per call?' },
  { eyebrow: 'Capacity', label: 'What quota remains and when does it reset?', question: 'What provider quota remains and when does it reset?' },
  { eyebrow: 'Projects', label: 'Which Project drove the most spend?', question: 'Which Project drove the most spend in this scope?' },
]

export function AdvisorWorkspace({
  mode,
  swarmExperimentalEnabled,
  onModeChange,
  swarm,
  projectOptions,
  modelOptions,
  providerOptions,
  scope,
  contextualScopeMode,
  contextualOrigin,
  scopeSummary,
  onScopeChange,
  runtimeUnavailable,
  onRetryRuntime,
  overviewError,
  runtimeControls,
  filteredConversations,
  activeConversationId,
  historyQuery,
  onNewChat,
  onConversationSelect,
  onHistoryQueryChange,
  messages,
  selectedAnswerId,
  onSelectAnswer,
  onFollowUp,
  harnessActions,
  harnessActionBusyId,
  onConfirmHarnessAction,
  onCancelHarnessAction,
  loadingQuestion,
  toolStatus,
  toolActivity,
  streamPreview,
  onCancel,
  error,
  onRetry,
  failedRequestPresent,
  notice,
  composer,
  hostedSubmitBlockReason,
  onComposerChange,
  onAsk,
  latestAnswer,
  onNextInvestigation,
}: AdvisorWorkspaceProps) {
  return (
    <section className="advisor-workspace" aria-label="Metrora Harness">
      <aside className="advisor-history" aria-label="Harness conversations">
        <div className="advisor-history-head">
          <div className="advisor-brand"><span className="advisor-orb">M</span><div><strong>Harness</strong><small>Evidence, in plain language</small></div></div>
          <button className="advisor-new-chat" type="button" onClick={onNewChat}>＋ New chat</button>
        </div>
        <label className="advisor-search"><span aria-hidden="true">⌕</span><input aria-label="Search Harness history" placeholder="Search this session" value={historyQuery} onChange={event => onHistoryQueryChange(event.target.value)} /></label>
        <div className="advisor-history-list">
          {filteredConversations.map(conversation => (
            <button key={conversation.id} type="button" className={conversation.id === activeConversationId ? 'advisor-history-item active' : 'advisor-history-item'} onClick={() => onConversationSelect(conversation.id)}>
              <span>{conversation.title}</span><small>{conversation.messages.length ? conversation.messages.length + ' messages' : 'Ready to explore'}</small>
            </button>
          ))}
        </div>
        <div className="advisor-history-foot">Session-local history · never synced</div>
      </aside>

      <main className="advisor-main">
        <header className="advisor-main-head">
          <div><p className="advisor-kicker">HARNESS · TOOLS READ-ONLY</p><h1>Ask Harness</h1><p className="advisor-subtitle">Talk naturally about Metrora evidence, your code, or anything you want to understand. Actions require confirmation.</p></div>
          <div className="advisor-main-head-actions">
            <div className="advisor-mode-switch" role="tablist" aria-label="Harness mode">
              <button type="button" role="tab" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'active' : ''} onClick={() => onModeChange('chat')}>Chat</button>
              <button type="button" role="tab" aria-selected={mode === 'swarm'} className={mode === 'swarm' ? 'active' : ''} disabled={!swarmExperimentalEnabled} onClick={() => onModeChange('swarm')}>Swarm - {swarmExperimentalEnabled ? 'Experimental' : 'Soon'}</button>
            </div>
            <AdvisorRuntimeControls {...runtimeControls} />
          </div>
        </header>
        <div className="advisor-scope-bar" aria-label="Harness context">
          <span className="advisor-scope-label">Context</span>
          {contextualOrigin ? <span className="advisor-contextual-origin">From {contextualOrigin}</span> : null}
          {contextualScopeMode === 'capacity' ? (
            <span className="advisor-contextual-authority">Provider-reported now · All providers; Project and history do not scope Capacity.</span>
          ) : (
            <>
              <label>Period<select aria-label="Harness period" value={scope.period} onChange={event => onScopeChange(current => ({ ...current, period: event.target.value as Period }))}>{PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {contextualScopeMode === 'compare' ? <span className="advisor-contextual-authority">Compare uses period + provider; custom dates and Project are not part of Compare.</span> : <label>Project<select aria-label="Harness Project" value={scope.projectId} onChange={event => { const id = event.target.value; onScopeChange(current => ({ ...current, projectId: id, projectName: id === 'all' ? 'All projects' : projectOptions.find(option => option.id === id)?.name ?? id })) }}><option value="all">All projects</option>{projectOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
              <label>Provider<select aria-label="Harness provider" value={scope.provider} onChange={event => onScopeChange(current => ({ ...current, provider: event.target.value }))}>{providerOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label>Model<select aria-label="Harness model" value={scope.model ?? ''} onChange={event => onScopeChange(current => ({ ...current, model: event.target.value || null }))}><option value="">All models</option>{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
            </>
          )}
          <span className="advisor-read-only">Facts read-only · actions require confirmation · {scopeSummary}</span>
        </div>
        {runtimeUnavailable ? <div className="advisor-runtime-note"><strong>No local model connected.</strong> You can still use the explicit offline evidence fallback; connect a supported local runtime to unlock free-form conversation and bounded evidence tools. <button type="button" onClick={onRetryRuntime}>Try again</button></div> : null}
        {overviewError ? <div className="advisor-runtime-note warning"><strong>Canonical Metrora data is unavailable.</strong> {overviewError}</div> : null}
        <div className="advisor-thread" aria-live="polite">
          {mode === 'swarm' ? <SwarmWorkspace {...swarm} /> : messages.length === 0 ? (
            <div className="advisor-welcome">
              <span className="advisor-welcome-mark">M</span>
              <p className="advisor-kicker">METRORA HARNESS</p>
              <h2>What would you like to talk about?</h2>
              <p>Ask naturally. Harness connects your question to Metrora factual evidence; a configured runtime can help explain it while verified details remain the authority.</p>
              <div className="advisor-prompt-grid">{PROMPTS.map(prompt => <button key={prompt.question} type="button" className="advisor-prompt" onClick={() => onAsk(prompt.question)}><small>{prompt.eyebrow}</small><span>{prompt.label}</span><i>↗</i></button>)}</div>
            </div>
          ) : (
            messages.map(message => message.role === 'user'
              ? <article key={message.id} className="advisor-message user-message"><div className="advisor-message-label">You</div><p>{message.text}</p></article>
              : <AnswerCard
                key={message.id}
                answer={message.answer!}
                selected={selectedAnswerId === message.id}
                onSelect={() => onSelectAnswer(message.id)}
                onFollowUp={onFollowUp}
                harnessAction={message.answer?.actionProposal?.harnessAction ? harnessActions[message.answer.actionProposal.harnessAction.actionId] ?? null : null}
                actionBusy={harnessActionBusyId === message.answer?.actionProposal?.harnessAction?.actionId}
                onConfirmHarnessAction={onConfirmHarnessAction}
                onCancelHarnessAction={onCancelHarnessAction}
              />
            )
          )}
          {loadingQuestion ? <article className="advisor-message assistant-message pending"><div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Harness</div><p className="advisor-tool-progress">{toolStatus ?? 'Thinking…'}</p><ToolActivity items={toolActivity} scope={scope} />{streamPreview ? <p className="advisor-stream-preview">{streamPreview}</p> : null}<button type="button" className="advisor-cancel" onClick={onCancel}>Cancel</button></article> : null}
          {error ? <div className="advisor-error" role="alert"><strong>Harness unavailable.</strong> {error}<button type="button" onClick={() => { if (failedRequestPresent) onRetry() }}>Retry</button></div> : null}
          {notice ? <div className="advisor-notice" role="status">{notice}</div> : null}
        </div>
        {mode === 'chat' ? <AdvisorComposer
          composer={composer} loadingQuestion={loadingQuestion} hostedSubmitBlockReason={hostedSubmitBlockReason}
          notice={notice} onChange={onComposerChange} onAsk={onAsk} onCancel={onCancel}
        /> : null}
      </main>

      <aside className="advisor-evidence" aria-label="Harness evidence">
        <div className="advisor-evidence-head"><p className="advisor-kicker">PROGRESSIVE DISCLOSURE</p><h2>Evidence</h2><span>Facts stay here. The model is not the authority.</span></div>
        {latestAnswer ? <div className="advisor-evidence-body"><div className={'advisor-coverage-card ' + latestAnswer.coverage.level}><span>{latestAnswer.coverage.label}</span><p>{latestAnswer.coverage.detail}</p></div><div className="advisor-evidence-section"><h3>Scope</h3><p>{latestAnswer.scopeLabel}</p><p>{latestAnswer.periodLabel}</p></div><div className="advisor-evidence-section"><h3>Sources</h3>{latestAnswer.evidence.map(ref => <div className="advisor-ref" key={ref.id}><i />{ref.label}</div>)}</div><div className="advisor-evidence-section"><h3>Assumptions</h3>{latestAnswer.assumptions.map((item, index) => <p className="advisor-muted-line" key={index}>{item}</p>)}</div><div className="advisor-evidence-section"><h3>Unknown</h3>{latestAnswer.unknown.map((item, index) => <p className="advisor-muted-line" key={index}>{item}</p>)}</div>{latestAnswer.nextInvestigations.length ? <div className="advisor-evidence-section"><h3>Related next step</h3>{latestAnswer.nextInvestigations.map(next => <button type="button" className="advisor-next-link" key={next} onClick={() => onNextInvestigation(next)}>{next} <span>↗</span></button>)}</div> : null}</div> : <div className="advisor-evidence-empty"><span>✦</span><p>Ask a question to pin its evidence, scope, coverage, and unknowns here.</p></div>}
      </aside>
    </section>
  )
}
