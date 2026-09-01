import { useEffect, useRef } from 'react'
import type { AdvisorAnswer, AdvisorScope } from '../advisor/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { MetroraMark } from '../components/MetroraMark'
import { HarnessSwarmRun } from './HarnessSwarmRun'
import { HarnessTurn } from './HarnessTurn'
import { HarnessWorkTrace, type HarnessToolActivity } from './HarnessWorkTrace'
import type { SwarmRunState } from '../swarm/useSwarmRun'

export type HarnessThreadMessage = { id: string; role: 'user' | 'assistant'; text?: string; answer?: AdvisorAnswer }

const PROMPTS = [
  { eyebrow: 'Usage', label: 'What changed in my usage?', question: 'What changed in my spend recently?' },
  { eyebrow: 'Models', label: 'Which model was most efficient?', question: 'Which model has the lowest observed cost per call?' },
  { eyebrow: 'Capacity', label: 'What is using my quota?', question: 'What quota remains and when does it reset?' },
  { eyebrow: 'Projects', label: 'Which Project changed most?', question: 'Which Project drove the most spend?' },
]

export function HarnessThread({ mode, swarmExperimentalEnabled, swarm, scope, messages, selectedAnswerId, onSelectAnswer, onFollowUp, harnessActions, harnessActionBusyId, onConfirmHarnessAction, onCancelHarnessAction, loadingQuestion, toolStatus, toolActivity, streamPreview, onCancel, error, onRetry, failedRequestPresent, notice, onAsk, onNextInvestigation }: {
  mode: 'chat' | 'swarm'
  swarmExperimentalEnabled: boolean
  swarm: { enabled: boolean; runtimeLabel: string; modelLabel: string; state: SwarmRunState; onCancel: () => void }
  scope: AdvisorScope
  messages: HarnessThreadMessage[]
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
  onAsk: (question: string) => void
  onNextInvestigation: (question: string) => void
}) {
  const threadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, loadingQuestion, streamPreview, swarm.state.events.length, swarm.state.result])

  const showSwarm = mode === 'swarm' || swarm.state.running || swarm.state.events.length > 0 || swarm.state.result !== null

  return (
    <div className="harness-v3-thread" ref={threadRef} aria-live="polite">
      <div className="harness-v3-thread-inner">
        {messages.length === 0 ? <div className="harness-v3-welcome">
          <MetroraMark size={34} />
          <span className="harness-v3-eyebrow">METRORA HARNESS</span>
          <h2>{mode === 'swarm' ? 'Describe the work you want coordinated.' : 'What would you like to understand?'}</h2>
          <p>Ask about measured Metrora facts in plain language. Harness keeps scope and evidence visible, while your selected runtime remains replaceable.</p>
          <div className="harness-v3-prompts">{PROMPTS.map(prompt => <button key={prompt.question} type="button" onClick={() => onAsk(prompt.question)}><small>{prompt.eyebrow}</small><span>{prompt.label}</span><i aria-hidden="true">↗</i></button>)}</div>
        </div> : null}
        {messages.map(message => message.role === 'user'
          ? <article key={message.id} className="harness-v3-user-turn user-message"><span>You</span><p>{message.text}</p></article>
          : <HarnessTurn key={message.id} answer={message.answer!} selected={selectedAnswerId === message.id} onSelect={() => onSelectAnswer(message.id)} onFollowUp={onFollowUp} onNextInvestigation={onNextInvestigation} harnessAction={message.answer?.actionProposal?.harnessAction ? harnessActions[message.answer.actionProposal.harnessAction.actionId] ?? null : null} actionBusy={harnessActionBusyId === message.answer?.actionProposal?.harnessAction?.actionId} onConfirmHarnessAction={onConfirmHarnessAction} onCancelHarnessAction={onCancelHarnessAction} />
        )}
        {showSwarm ? <HarnessSwarmRun enabled={swarmExperimentalEnabled} runtimeLabel={swarm.runtimeLabel} modelLabel={swarm.modelLabel} state={swarm.state} onCancel={swarm.onCancel} /> : null}
        {loadingQuestion ? <article className="harness-v3-pending-turn assistant-message pending"><div className="harness-v3-turn-label"><MetroraMark size={20} /><span>Metrora Harness</span></div><p className="harness-v3-pending-status">{toolStatus ?? 'Thinking…'}</p><HarnessWorkTrace items={toolActivity} scope={scope} />{streamPreview ? <p className="harness-v3-stream-preview">{streamPreview}</p> : null}<button type="button" className="harness-v3-quiet-button" onClick={onCancel}>Cancel</button></article> : null}
        {error ? <div className="harness-v3-error" role="alert"><strong>Harness unavailable.</strong> {error}<button type="button" className="harness-v3-quiet-button" onClick={() => { if (failedRequestPresent) onRetry() }}>Retry</button></div> : null}
        {notice ? <div className="harness-v3-notice" role="status">{notice}</div> : null}
      </div>
    </div>
  )
}
